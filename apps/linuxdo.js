import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import chokidar from 'chokidar'
import { fetchRSS, parseRSS, CookieRefreshedError } from '../models/rss.js'
import { screenshotPost } from '../models/screenshot.js'
import { connectBrowser, disconnectBrowser, refreshCookie } from '../models/cookie.js'

const PLUGIN_PATH = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const DATA_PATH = path.join(PLUGIN_PATH, '..', 'data')
const CONFIG_DEFAULT_PATH = path.join(PLUGIN_PATH, '..', 'config_default')
const CONFIG_PATH = path.join(DATA_PATH, 'config.yaml')
const PUSH_PATH = path.join(DATA_PATH, 'push.yaml')

/**
 * 确保配置文件存在（首次启动时从 config_default 复制）
 */
function ensureConfigFiles() {
  // 确保 data 目录存在
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true })
  }

  // 如果用户配置不存在，从 config_default 复制
  const defaultConfigPath = path.join(CONFIG_DEFAULT_PATH, 'config.yaml')
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(defaultConfigPath)) {
    fs.copyFileSync(defaultConfigPath, CONFIG_PATH)
    logger.info('[linuxdo-plugin] 已从 config_default 复制默认配置')
  }
}

// 默认配置
const DEFAULT_CONFIG = {
  pushStatus: true,
  checkInterval: '*/30 * * * *',
  cookie: '',
  proxy: {
    enable: false,
    host: '127.0.0.1',
    port: 7890
  }
}

// 配置缓存
let configCache = null
let pushCache = null

// 监听器
let configWatcher = null
let pushWatcher = null

/**
 * 读取配置（带缓存和热加载）
 */
function getConfig() {
  if (configCache) return configCache

  // 确保配置文件存在
  ensureConfigFiles()

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, YAML.stringify(DEFAULT_CONFIG))
    configCache = DEFAULT_CONFIG
  } else {
    configCache = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) || DEFAULT_CONFIG
  }

  // 监听配置文件变化
  if (!configWatcher) {
    configWatcher = chokidar.watch(CONFIG_PATH)
    configWatcher.on('change', () => {
      configCache = null
      logger.mark('[linuxdo-plugin] 配置文件已更新')
    })
  }

  return configCache
}

/**
 * 读取订阅数据（带缓存和热加载）
 */
function getPushData() {
  if (pushCache) return pushCache

  if (!fs.existsSync(PUSH_PATH)) {
    const defaultData = { group: {}, private: {} }
    fs.writeFileSync(PUSH_PATH, YAML.stringify(defaultData))
    pushCache = defaultData
  } else {
    pushCache = YAML.parse(fs.readFileSync(PUSH_PATH, 'utf-8')) || { group: {}, private: {} }
  }

  // 监听订阅文件变化
  if (!pushWatcher) {
    pushWatcher = chokidar.watch(PUSH_PATH)
    pushWatcher.on('change', () => {
      pushCache = null
      logger.mark('[linuxdo-plugin] 订阅数据已更新')
    })
  }

  return pushCache
}

/**
 * 保存订阅数据
 */
function savePushData(data) {
  fs.writeFileSync(PUSH_PATH, YAML.stringify(data))
  pushCache = data // 更新缓存
}

/**
 * 格式化时间
 */
function formatTime(dateStr) {
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export default class LinuxDoApp extends plugin {
  constructor() {
    const config = getConfig()

    super({
      name: 'LinuxDo订阅推送',
      dsc: 'Linux.do 社区用户帖子订阅推送',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#订阅linuxdo\\s*.+$',
          fnc: 'addSub',
          permission: 'master'
        },
        {
          reg: '^#取消订阅linuxdo\\s*.+$',
          fnc: 'delSub',
          permission: 'master'
        },
        {
          reg: '^#linuxdo列表$',
          fnc: 'listSub'
        },
        {
          reg: '^#测试linuxdo推送(\\s+\\d+)?$',
          fnc: 'testPush',
          permission: 'master'
        },
        {
          reg: '^#重置linuxdo推送(\\s+.+)?$',
          fnc: 'resetPush',
          permission: 'master'
        },
        {
          reg: '^#linuxdo标记已推送\\s+.+$',
          fnc: 'markPushed',
          permission: 'master'
        },
        {
          reg: '^#linuxdo清除全部推送$',
          fnc: 'clearAllPush',
          permission: 'master'
        },
        {
          reg: '^#linuxdo连接浏览器$',
          fnc: 'connectBrowserCmd',
          permission: 'master'
        },
        {
          reg: '^#linuxdo断开浏览器$',
          fnc: 'disconnectBrowserCmd',
          permission: 'master'
        },
        {
          reg: '^#linuxdo刷新cookie$',
          fnc: 'refreshCookieCmd',
          permission: 'master'
        }
      ],
      task: config.pushStatus
        ? {
          cron: config.checkInterval,
          name: 'LinuxDo订阅推送定时任务',
          fnc: () => this.pushTask()
        }
        : null
    })
  }

  /** 获取最新配置 */
  get config() {
    return getConfig()
  }

  /**
   * 添加订阅
   */
  async addSub() {
    const username = this.e.msg.replace(/^#订阅linuxdo\s*/i, '').trim()
    if (!username) {
      this.reply('请指定用户名，例如：#订阅linuxdo kingsword09')
      return true
    }

    // 验证用户名是否有效并获取最新帖子
    let items = []
    try {
      const xml = await fetchRSS(username, this.config.proxy, this.config.maxRetries || 20, this.config.cookie, this.config.userAgent)
      const result = parseRSS(xml)
      items = result.items
    } catch (err) {
      this.reply(`获取用户 ${username} 的信息失败，请检查用户名是否正确或代理配置`)
      return true
    }

    const pushData = getPushData()
    const chatType = this.e.isGroup ? 'group' : 'private'
    const chatId = this.e.isGroup ? this.e.group_id : this.e.user_id

    if (!pushData[chatType]) {
      pushData[chatType] = {}
    }
    if (!pushData[chatType][chatId]) {
      pushData[chatType][chatId] = []
    }

    // 检查是否已订阅
    const existing = pushData[chatType][chatId].find(item => item.username === username)
    if (existing) {
      this.reply(`已订阅用户 ${username}，无需重复订阅`)
      return true
    }

    pushData[chatType][chatId].push({
      username,
      bot_id: this.e.self_id
    })

    savePushData(pushData)

    // 将最新帖子标记为已推送，避免订阅后立即推送旧帖子
    if (items.length > 0) {
      const latestItem = items[0]
      const redisKey = `linuxdo:pushed:${chatType}:${chatId}:${latestItem.guid}`
      await redis.set(redisKey, '1', { EX: 3600 * 72 })
    }

    this.reply(`订阅 Linux.do 用户 ${username} 成功`)
    return true
  }

  /**
   * 取消订阅
   */
  async delSub() {
    const username = this.e.msg.replace(/^#取消订阅linuxdo\s*/i, '').trim()
    if (!username) {
      this.reply('请指定用户名，例如：#取消订阅linuxdo neo')
      return true
    }

    const pushData = getPushData()
    const chatType = this.e.isGroup ? 'group' : 'private'
    const chatId = this.e.isGroup ? this.e.group_id : this.e.user_id

    if (!pushData[chatType][chatId]) {
      this.reply('当前没有任何订阅')
      return true
    }

    const index = pushData[chatType][chatId].findIndex(item => item.username === username)
    if (index === -1) {
      this.reply(`未订阅用户 ${username}`)
      return true
    }

    pushData[chatType][chatId].splice(index, 1)
    savePushData(pushData)
    this.reply(`已取消订阅 Linux.do 用户 ${username}`)
    return true
  }

  /**
   * 查看订阅列表
   */
  async listSub() {
    const pushData = getPushData()
    const chatType = this.e.isGroup ? 'group' : 'private'
    const chatId = this.e.isGroup ? this.e.group_id : this.e.user_id

    const subs = pushData[chatType][chatId] || []
    if (subs.length === 0) {
      this.reply('当前没有任何 Linux.do 订阅')
      return true
    }

    const list = subs.map((item, i) => `${i + 1}. ${item.username}`).join('\n')
    this.reply(`Linux.do 订阅列表：\n${list}`)
    return true
  }

  /**
   * 测试推送
   */
  async testPush() {
    // 解析帖子 ID 参数
    const topicId = this.e.msg.replace(/^#测试linuxdo推送\s*/i, '').trim()

    // 如果传入了帖子 ID，直接测试该帖子
    if (topicId) {
      try {
        this.reply(`正在获取帖子 ${topicId} 并截图，请稍候...`)
        const url = `https://linux.do/t/topic/${topicId}`
        const { screenshot: imgBuffer, cdkUrl, title, creator, pubDate } = await screenshotPost(url, this.config.proxy, this.config.cookie)
        const pubTime = pubDate ? formatTime(pubDate) : ''

        const msg = [
          segment.image(imgBuffer),
          `\nLinux do社区订阅推送:\n`,
          `用户：${creator || '未知'}\n`,
          `标题：${title || '未知'}\n`,
          pubTime ? `发帖时间：${pubTime}\n` : '',
          `原帖：${url}`
        ]

        if (cdkUrl) {
          msg.push(`\n---检测到存在CDK链接---\nCDK链接：${cdkUrl}`)
        }

        this.reply(msg)
      } catch (err) {
        this.reply(`测试失败: ${err.message}`)
        logger.error(`[linuxdo-plugin] 测试推送失败:`, err)
      }
      return true
    }

    // 没有传入帖子 ID，使用订阅用户的最新帖子
    const pushData = getPushData()
    const chatType = this.e.isGroup ? 'group' : 'private'
    const chatId = this.e.isGroup ? this.e.group_id : this.e.user_id

    const subs = pushData[chatType][chatId] || []
    if (subs.length === 0) {
      this.reply('当前没有任何订阅，无法测试\n提示：可以使用 #测试linuxdo推送 帖子ID 直接测试指定帖子')
      return true
    }

    const username = subs[0].username
    try {
      this.reply('正在获取数据并截图，请稍候...')

      const xml = await fetchRSS(username, this.config.proxy, this.config.maxRetries || 20, this.config.cookie, this.config.userAgent)
      const { items } = parseRSS(xml)

      if (items.length === 0) {
        this.reply(`用户 ${username} 暂无帖子`)
        return true
      }

      const item = items[0]
      const { screenshot: imgBuffer, cdkUrl } = await screenshotPost(item.link, this.config.proxy, this.config.cookie)
      const pubTime = formatTime(item.pubDate)
      const msg = [
        segment.image(imgBuffer),
        `\nLinux do社区订阅推送:\n`,
        `用户：${item.creator.replace('@', '')}\n`,
        `标题：${item.title}\n`,
        `发帖时间：${pubTime}\n`,
        `原帖：${item.link}`
      ]

      // 如果有 CDK 链接，添加到消息中
      if (cdkUrl) {
        msg.push(`\n---检测到存在CDK链接---\nCDK链接：${cdkUrl}`)
      }

      this.reply(msg)
    } catch (err) {
      this.reply(`测试失败: ${err.message}`)
      logger.error(`[linuxdo-plugin] 测试推送失败:`, err)
    }

    return true
  }

  /**
   * 定时推送任务
   */
  async pushTask() {
    // 检查当前时间，凌晨 3:00-5:59 不执行
    const hour = new Date().getHours()
    if (hour >= 3 && hour < 6) {
      logger.info('[linuxdo-plugin] 当前为休眠时段(03:00-05:59)，跳过推送')
      return
    }

    const pushData = getPushData()
    const config = getConfig()

    // 1. 收集所有订阅的用户名（去重）
    const allUsernames = new Set()
    for (const chatType of ['group', 'private']) {
      const chats = pushData[chatType] || {}
      for (const subs of Object.values(chats)) {
        for (const sub of subs) {
          allUsernames.add(sub.username)
        }
      }
    }

    if (allUsernames.size === 0) return

    // 2. 统一请求每个用户的 RSS 数据
    const rssCache = new Map() // username -> items
    const usernameArray = Array.from(allUsernames)
    let allCanCreateTopicFalse = true  // 跟踪是否所有用户的 canCreateTopic 都为 false

    for (let i = 0; i < usernameArray.length; i++) {
      const username = usernameArray[i]
      try {
        const xml = await fetchRSS(username, config.proxy, config.maxRetries || 20, config.cookie, config.userAgent)
        const { items, canCreateTopic } = parseRSS(xml)

        // can_create_topic 为 false 或空时，数据不是最新的，跳过此用户
        if (!canCreateTopic) {
          logger.warn(`[linuxdo-plugin] ${username} 数据非最新(can_create_topic=false)，跳过`)
          rssCache.set(username, [])
        } else {
          allCanCreateTopicFalse = false  // 至少有一个用户数据是最新的
          rssCache.set(username, items)
          logger.info(`[linuxdo-plugin] 获取 ${username} RSS 成功`)
        }
      } catch (err) {
        // Cookie 已刷新，终止当前任务
        if (err instanceof CookieRefreshedError) {
          logger.info('[linuxdo-plugin] Cookie 已刷新，终止当前定时任务')
          return
        }
        logger.error(`[linuxdo-plugin] 获取 ${username} RSS 失败: ${err.message}`)
        rssCache.set(username, []) // 失败时设为空数组
      }
      // 请求间隔 15-20 秒（最后一个不等待）
      if (i < usernameArray.length - 1) {
        await this.sleep(15000 + Math.random() * 5000)
      }
    }

    // 如果所有用户的 canCreateTopic 都为 false，刷新 Cookie 并结束任务
    if (allCanCreateTopicFalse && usernameArray.length > 0) {
      logger.warn('[linuxdo-plugin] 所有用户数据都非最新，尝试刷新 Cookie...')
      await refreshCookie(true)
      logger.info('[linuxdo-plugin] Cookie 已刷新，终止当前定时任务')
      return
    }

    // 3. 遍历各群/私聊，使用缓存数据推送
    for (const chatType of ['group', 'private']) {
      const chats = pushData[chatType] || {}

      for (const [chatId, subs] of Object.entries(chats)) {
        for (const sub of subs) {
          const items = rssCache.get(sub.username) || []
          if (items.length === 0) continue

          try {
            await this.checkAndPush(chatType, chatId, sub, config, items)
          } catch (err) {
            logger.error(`[linuxdo-plugin] 推送失败 ${sub.username}: ${err.message}`)
          }
        }
      }
    }
  }

  /**
   * 检查并推送新帖子
   * @param {Array} items 已解析的帖子列表（可选，不传则自动获取）
   */
  async checkAndPush(chatType, chatId, sub, config, items = null) {
    // 兼容直接调用的情况
    if (!items) {
      const xml = await fetchRSS(sub.username, config.proxy, config.maxRetries || 20, config.cookie, config.userAgent)
      const result = parseRSS(xml)
      items = result.items
    }

    if (items.length === 0) return

    // 只检查最新的一条帖子
    const item = items[0]
    const redisKey = `linuxdo:pushed:${chatType}:${chatId}:${item.guid}`

    // 检查是否已推送
    const pushed = await redis.get(redisKey)
    if (pushed) return

    // 截图并构建消息
    try {
      const { screenshot: imgBuffer, cdkUrl } = await screenshotPost(item.link, config.proxy, config.cookie)
      const pubTime = formatTime(item.pubDate)

      const msg = [
        segment.image(imgBuffer),
        `\nLinux do社区订阅推送:\n`,
        `用户：${item.creator.replace('@', '')}\n`,
        `标题：${item.title}\n`,
        `发帖时间：${pubTime}\n`,
        `原帖：${item.link}`
      ]

      // 如果有 CDK 链接，添加到消息中
      if (cdkUrl) {
        msg.push(`\n---检测到存在CDK链接---\nCDK链接：${cdkUrl}`)
      }

      await this.sendMsg(chatType, chatId, sub.bot_id, msg)
      // 标记为已推送，避免重复推送
      await redis.set(redisKey, '1', { EX: 3600 * 72 })
      logger.info(`[linuxdo-plugin] 推送成功: ${item.title}`)

      // 推送间隔
      await this.sleep(2000 + Math.random() * 3000)
    } catch (err) {
      // 截图或发送失败，删除标记以便下次重试（最多重试3次）
      const retryKey = `linuxdo:retry:${chatType}:${chatId}:${item.guid}`
      const retryCount = parseInt(await redis.get(retryKey) || '0')

      if (retryCount < 3) {
        await redis.del(redisKey)
        await redis.set(retryKey, String(retryCount + 1), { EX: 3600 * 24 })
        logger.error(`[linuxdo-plugin] 推送失败(第${retryCount + 1}次): ${err.message}`)
      } else {
        logger.error(`[linuxdo-plugin] 推送失败已达上限，跳过: ${item.title}`)
      }
    }
  }

  /**
   * 发送消息
   */
  async sendMsg(chatType, chatId, botId, msg) {
    const bot = Bot[botId] ?? Bot

    if (chatType === 'group') {
      await bot.pickGroup(String(chatId)).sendMsg(msg)
    } else {
      await bot.pickFriend(String(chatId)).sendMsg(msg)
    }
  }

  /**
   * 延迟
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 重置推送状态
   */
  async resetPush() {
    const username = this.e.msg.replace(/^#重置linuxdo推送\s*/i, '').trim()
    const chatType = this.e.isGroup ? 'group' : 'private'
    const chatId = this.e.isGroup ? this.e.group_id : this.e.user_id

    if (username) {
      // 重置指定用户的推送状态
      try {
        const xml = await fetchRSS(username, this.config.proxy, this.config.maxRetries || 20, this.config.cookie, this.config.userAgent)
        const { items } = parseRSS(xml)

        if (items.length === 0) {
          this.reply(`用户 ${username} 暂无帖子`)
          return true
        }

        let count = 0
        for (const item of items) {
          const redisKey = `linuxdo:pushed:${chatType}:${chatId}:${item.guid}`
          const retryKey = `linuxdo:retry:${chatType}:${chatId}:${item.guid}`
          if (await redis.get(redisKey)) {
            await redis.del(redisKey)
            await redis.del(retryKey)
            count++
          }
        }

        this.reply(`已重置用户 ${username} 的 ${count} 条推送记录`)
      } catch (err) {
        this.reply(`获取用户 ${username} 的帖子失败: ${err.message}`)
      }
    } else {
      // 重置全部推送状态
      const pattern = `linuxdo:pushed:${chatType}:${chatId}:*`
      const retryPattern = `linuxdo:retry:${chatType}:${chatId}:*`

      const keys = await redis.keys(pattern)
      const retryKeys = await redis.keys(retryPattern)

      if (keys.length === 0 && retryKeys.length === 0) {
        this.reply('当前没有任何推送记录')
        return true
      }

      for (const key of [...keys, ...retryKeys]) {
        await redis.del(key)
      }

      this.reply(`已重置 ${keys.length} 条推送记录`)
    }

    return true
  }

  /**
   * 标记帖子为已推送
   * 用法: #linuxdo标记已推送 帖子ID/用户名 [群号]
   */
  async markPushed() {
    const params = this.e.msg.replace(/^#linuxdo标记已推送\s*/i, '').trim().split(/\s+/)
    const param = params[0]
    const targetGroupId = params[1]

    if (!param) {
      this.reply('请指定帖子ID或用户名，例如：\n#linuxdo标记已推送 1436129\n#linuxdo标记已推送 ouyangqiqi\n#linuxdo标记已推送 1436129 123456789')
      return true
    }

    // 确定目标群号
    let chatType, chatId
    if (targetGroupId) {
      chatType = 'group'
      chatId = targetGroupId
    } else {
      chatType = this.e.isGroup ? 'group' : 'private'
      chatId = this.e.isGroup ? this.e.group_id : this.e.user_id
    }

    // 判断是帖子ID还是用户名
    if (/^\d+$/.test(param)) {
      // 帖子ID
      const topicId = param
      const redisKey = `linuxdo:pushed:${chatType}:${chatId}:linux.do-topic-${topicId}`
      await redis.set(redisKey, '1', { EX: 3600 * 72 })
      this.reply(`已将帖子 ${topicId} 标记为已推送${targetGroupId ? `（群 ${targetGroupId}）` : ''}`)
    } else {
      // 用户名，标记该用户最新帖子
      try {
        const xml = await fetchRSS(param, this.config.proxy, this.config.maxRetries || 20, this.config.cookie, this.config.userAgent)
        const { items } = parseRSS(xml)

        if (items.length === 0) {
          this.reply(`用户 ${param} 暂无帖子`)
          return true
        }

        const latestItem = items[0]
        const redisKey = `linuxdo:pushed:${chatType}:${chatId}:${latestItem.guid}`
        await redis.set(redisKey, '1', { EX: 3600 * 72 })
        this.reply(`已将用户 ${param} 的最新帖子「${latestItem.title}」标记为已推送${targetGroupId ? `（群 ${targetGroupId}）` : ''}`)
      } catch (err) {
        this.reply(`获取用户 ${param} 的帖子失败: ${err.message}`)
      }
    }

    return true
  }

  /**
   * 清除全部群聊的全部推送数据
   */
  async clearAllPush() {
    const pattern = 'linuxdo:pushed:*'
    const retryPattern = 'linuxdo:retry:*'

    const keys = await redis.keys(pattern)
    const retryKeys = await redis.keys(retryPattern)

    if (keys.length === 0 && retryKeys.length === 0) {
      this.reply('没有任何推送记录')
      return true
    }

    for (const key of [...keys, ...retryKeys]) {
      await redis.del(key)
    }

    this.reply(`已清除全部推送记录：${keys.length} 条推送记录，${retryKeys.length} 条重试记录`)
    return true
  }

  /**
   * 连接浏览器
   */
  async connectBrowserCmd() {
    this.reply('正在连接浏览器...')
    const success = await connectBrowser()
    if (success) {
      this.reply('浏览器连接成功！可以使用 #linuxdo刷新cookie 获取最新 Cookie')
    } else {
      this.reply('浏览器连接失败，请确保 Edge 以调试模式启动：\nmsedge.exe --remote-debugging-port=9222')
    }
    return true
  }

  /**
   * 断开浏览器连接
   */
  async disconnectBrowserCmd() {
    await disconnectBrowser()
    this.reply('已断开浏览器连接')
    return true
  }

  /**
   * 刷新 Cookie
   */
  async refreshCookieCmd() {
    this.reply('正在刷新页面并获取 Cookie...')
    const success = await refreshCookie(true)  // true = 先刷新页面
    if (success) {
      this.reply('Cookie 已更新到配置文件！')
    } else {
      this.reply('Cookie 获取失败，请确保：\n1. 浏览器已连接（#linuxdo连接浏览器）\n2. 浏览器中已登录 linux.do')
    }
    return true
  }
}

import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import chokidar from 'chokidar'
import { screenshotPost } from '../models/screenshot.js'
import { connectBrowser, disconnectBrowser, refreshCookie } from '../models/cookie.js'

const PLUGIN_PATH = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const DATA_PATH = path.join(PLUGIN_PATH, '..', 'data')
const CONFIG_DEFAULT_PATH = path.join(PLUGIN_PATH, '..', 'config_default')
const CONFIG_PATH = path.join(DATA_PATH, 'config.yaml')

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
  linkParseStatus: true,
  showLogo: true,
  cookie: '',
  userAgent: '',
  proxy: {
    enable: false,
    host: '127.0.0.1',
    port: 7890
  }
}

// 配置缓存
let configCache = null

// 监听器
let configWatcher = null

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
 * 格式化时间
 */
function formatTime(dateStr) {
  if (!dateStr) return ''
  // 处理纯数字时间戳
  let date
  if (/^\d+$/.test(dateStr)) {
    date = new Date(Number(dateStr))
  } else {
    date = new Date(dateStr)
  }
  if (isNaN(date.getTime())) return dateStr // 无法解析时返回原字符串
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

/**
 * 格式化文件链接列表
 */
function formatFiles(files) {
  if (!files || files.length === 0) return ''
  const list = files.map((f, i) => `${i + 1}.${f.name}: ${f.url}`).join('\n')
  return `\n---检测到存在${files.length}个文件链接---\n${list}`
}

export default class LinuxDoApp extends plugin {
  constructor() {
    super({
      name: 'LinuxDo帖子解析',
      dsc: 'Linux.do 社区帖子链接解析',
      event: 'message',
      priority: 5000,
      rule: [
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
        },
        {
          reg: 'linux\\.do/t/topic/\\d+',
          fnc: 'parseLink'
        }
      ]
    })
  }

  /** 获取最新配置 */
  get config() {
    return getConfig()
  }

  /**
   * 以转发消息格式回复当前消息
   */
  async replyForward(msg) {
    const forwardMsg = [{ message: msg, nickname: 'Linux.do', user_id: Bot.uin }]
    this.reply(Bot.makeForwardMsg(forwardMsg))
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

  /**
   * 监听群聊中的 linux.do 帖子链接并解析
   */
  async parseLink() {
    if (!this.config.linkParseStatus) return false

    const urlReg = /https?:\/\/linux\.do\/t\/topic\/(\d+)/
    const match = urlReg.exec(this.e.msg)
    if (!match) return false

    const topicId = match[1]
    const url = `https://linux.do/t/topic/${topicId}`

    try {
      this.reply('检测到Linux.do社区帖子,正在解析 ...')
      const { screenshot: imgBuffer, cdkUrl, title, creator, pubDate, files } = await screenshotPost(url, this.config.proxy, this.config.cookie, this.config.userAgent, this.config.showLogo ?? true)
      const pubTime = pubDate ? formatTime(pubDate) : ''

      const msg = [
        segment.image(imgBuffer),
        `\nLinux do社区帖子解析:\n`,
        `用户：${creator || '未知'}\n`,
        `标题：${title || '未知'}\n`,
        pubTime ? `发帖时间：${pubTime}\n` : '',
        `原帖：${url}`
      ]

      if (cdkUrl) {
        msg.push(`\n---检测到存在CDK链接---\nCDK链接：${cdkUrl}`)
      }

      const filesText = formatFiles(files)
      if (filesText) {
        msg.push(filesText)
      }

      if (files && files.length > 0) {
        await this.replyForward(msg)
      } else {
        this.reply(msg)
      }
    } catch (err) {
      this.reply(`解析失败: ${err.message}`)
      logger.error(`[linuxdo-plugin] 链接解析失败:`, err)
    }

    return true
  }
}

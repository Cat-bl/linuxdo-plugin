/**
 * Linux.do 数据获取模块
 */
import https from 'https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { refreshCookie } from './cookie.js'

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

// Cookie 已刷新错误，用于终止当前任务
export class CookieRefreshedError extends Error {
  constructor(message = 'Cookie 已刷新，终止当前任务') {
    super(message)
    this.name = 'CookieRefreshedError'
  }
}

/**
 * 获取用户帖子数据（带重试）
 * @param {string} username 用户名
 * @param {Object} proxy 代理配置 { enable, host, port }
 * @param {number} maxRetries 最大重试次数
 * @param {string} cookie Cookie 字符串
 * @param {string} userAgent User-Agent 字符串
 * @returns {Promise<string>} JSON 字符串
 */
export async function fetchRSS(username, proxy = null, maxRetries = 3, cookie = '', userAgent = '') {
  const url = `https://linux.do/topics/created-by/${username}.json`

  const headers = {
    'User-Agent': userAgent || DEFAULT_UA,
    'Accept': 'application/json'
  }

  if (cookie) {
    headers['Cookie'] = cookie
  }

  const options = {
    headers,
    timeout: 30000
  }

  // 配置代理
  if (proxy?.enable && proxy.host && proxy.port) {
    const proxyUrl = `http://${proxy.host}:${proxy.port}`
    options.agent = new HttpsProxyAgent(proxyUrl)
    logger.info(`[linuxdo-plugin] 使用代理: ${proxyUrl}`)
  }

  let lastError
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await doFetch(url, options)
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        logger.warn(`[linuxdo-plugin] 请求失败(第${attempt}次), 2秒后重试: ${err.message}`)
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }

  // 所有重试失败后，尝试刷新 Cookie 并终止任务
  logger.warn('[linuxdo-plugin] 请求失败次数已达上限，尝试刷新 Cookie...')
  const refreshed = await refreshCookie(true)
  if (refreshed) {
    logger.info('[linuxdo-plugin] Cookie 已刷新，终止当前任务，等待下次定时任务使用新 Cookie')
    throw new CookieRefreshedError()
  }

  throw lastError
}

/**
 * 执行 HTTP 请求
 */
function doFetch(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`请求失败: ${res.statusCode}`))
        return
      }

      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}

/**
 * 解析帖子数据
 * @param {string} jsonStr JSON 字符串
 * @returns {Object} { items: 帖子列表, canCreateTopic: 是否为最新数据 }
 */
export function parseRSS(jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    let topics = data.topic_list?.topics || []
    const users = data.users || []
    const canCreateTopic = data.topic_list?.can_create_topic === true

    // 构建用户名映射
    const userMap = new Map()
    for (const user of users) {
      userMap.set(user.id, user.username)
    }

    // 订阅用户（users 第一个就是）
    const subscribedUser = users[0]?.username || ''

    // 按 created_at 降序排序（最新的在前面）
    topics = topics.sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at)
    })

    const items = topics.map(topic => {
      return {
        title: topic.title || '',
        link: `https://linux.do/t/${topic.slug}/${topic.id}`,
        pubDate: topic.created_at || '',
        guid: `linux.do-topic-${topic.id}`,
        description: topic.excerpt || '',
        // 优先使用 posters 中的原始发帖人，否则用订阅用户
        creator: userMap.get(topic.posters?.[0]?.user_id) || subscribedUser,
        topicId: topic.id,
        slug: topic.slug
      }
    })

    return { items, canCreateTopic }
  } catch (err) {
    logger.error(`[linuxdo-plugin] 解析数据失败: ${err.message}`)
    return { items: [], canCreateTopic: false }
  }
}

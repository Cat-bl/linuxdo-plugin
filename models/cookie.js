/**
 * Cookie 自动更新模块
 * 连接已打开的浏览器，定时获取 linux.do 的 Cookie 并更新配置文件
 */
import puppeteer from 'puppeteer'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import YAML from 'yaml'

const PLUGIN_PATH = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const DATA_PATH = path.join(PLUGIN_PATH, '..', 'data')
const CONFIG_PATH = path.join(DATA_PATH, 'config.yaml')
const USER_DATA_DIR = path.join(DATA_PATH, 'browser-data')  // 独立的浏览器数据目录
const DEFAULT_PAGE = 'https://linux.do/u/Cat-bl/activity/topics'  // 默认打开的页面

// 浏览器连接
let browser = null
let browserProcess = null
let linuxDoPage = null

/**
 * 启动浏览器（调试模式）
 * @param {string} browserPath 浏览器路径
 * @param {number} port 调试端口
 */
export async function launchBrowser(browserPath, port = 9222) {
  // 先尝试连接已有的浏览器
  try {
    const connected = await connectBrowser(`http://127.0.0.1:${port}`)
    if (connected) {
      logger.info('[linuxdo-plugin] 已连接到现有浏览器')
      return true
    }
  } catch (e) {
    // 连接失败，启动新浏览器
  }

  // 确保用户数据目录存在
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true })
  }

  // 启动新浏览器（使用独立的用户数据目录）
  try {
    logger.info(`[linuxdo-plugin] 正在启动浏览器: ${browserPath}`)
    browserProcess = spawn(browserPath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${USER_DATA_DIR}`,  // 使用独立目录，避免与现有浏览器冲突
      '--no-first-run',
      '--no-default-browser-check',
      'https://linux.do/u/Cat-bl/activity/topics'
    ], {
      detached: true,
      stdio: 'ignore'
    })
    browserProcess.unref()

    // 等待浏览器启动
    logger.info('[linuxdo-plugin] 等待浏览器启动...')
    await new Promise(r => setTimeout(r, 8000))

    // 多次尝试连接浏览器
    for (let i = 0; i < 5; i++) {
      try {
        const connected = await connectBrowser(`http://127.0.0.1:${port}`)
        if (connected) {
          logger.info('[linuxdo-plugin] 浏览器启动并连接成功')
          return true
        }
      } catch (e) {
        logger.info(`[linuxdo-plugin] 连接尝试 ${i + 1}/5 失败，2秒后重试...`)
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    return false
  } catch (err) {
    logger.error(`[linuxdo-plugin] 启动浏览器失败: ${err.message}`)
    return false
  }
}

/**
 * 连接到已打开的浏览器
 * @param {string} debuggingUrl 调试地址，默认 http://127.0.0.1:9222
 */
export async function connectBrowser(debuggingUrl = 'http://127.0.0.1:9222') {
  try {
    browser = await puppeteer.connect({
      browserURL: debuggingUrl,
      defaultViewport: null
    })
    logger.info('[linuxdo-plugin] 已连接到浏览器')
    return true
  } catch (err) {
    logger.error(`[linuxdo-plugin] 连接浏览器失败: ${err.message}`)
    return false
  }
}

/**
 * 断开浏览器连接
 */
export async function disconnectBrowser() {
  linuxDoPage = null
  if (browser) {
    browser.disconnect()
    browser = null
    logger.info('[linuxdo-plugin] 已断开浏览器连接')
  }
}

/**
 * 获取或创建 linux.do 页面
 */
async function getLinuxDoPage() {
  if (!browser) return null

  try {
    // 查找已打开的 linux.do 页面
    const pages = await browser.pages()
    for (const page of pages) {
      const url = page.url()
      if (url.includes('linux.do')) {
        linuxDoPage = page
        return linuxDoPage
      }
    }

    // 没有找到，打开新页面
    linuxDoPage = await browser.newPage()
    await linuxDoPage.goto('https://linux.do/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise(r => setTimeout(r, 5000))
    logger.info('[linuxdo-plugin] 已打开 linux.do 页面')
    return linuxDoPage
  } catch (err) {
    logger.error(`[linuxdo-plugin] 获取页面失败: ${err.message}`)
    linuxDoPage = null
    return null
  }
}

/**
 * 检测是否已登录
 * @param {Object} page Puppeteer 页面对象
 */
async function isLoggedIn(page) {
  try {
    // 检查 Cookie 中是否有 _t（登录凭证）
    const cookies = await page.cookies()
    const hasToken = cookies.some(c => c.name === '_t' && c.domain.includes('linux.do'))
    if (hasToken) return true

    // 检查页面是否有登录按钮（未登录状态）
    const loginBtn = await page.$('.login-button, .header-buttons .btn-primary')
    if (loginBtn) return false

    return true // 默认认为已登录
  } catch (err) {
    logger.error(`[linuxdo-plugin] 检测登录状态失败: ${err.message}`)
    return true // 出错时默认已登录，避免误触发登录
  }
}

/**
 * 自动登录
 * @param {Object} page Puppeteer 页面对象
 * @param {string} username 用户名或邮箱
 * @param {string} password 密码
 */
async function autoLogin(page, username, password) {
  try {
    logger.info('[linuxdo-plugin] 开始自动登录...')

    // 先跳转到首页
    await page.goto('https://linux.do/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise(r => setTimeout(r, 3000))

    // 点击登录按钮
    const loginBtn = await page.$('.login-button, .header-buttons .btn-primary')
    if (!loginBtn) {
      logger.warn('[linuxdo-plugin] 未找到登录按钮')
      return false
    }
    await loginBtn.click()

    // 等待登录表单出现
    await page.waitForSelector('#login-account-name', { timeout: 10000 })
    await new Promise(r => setTimeout(r, 1000))

    // 输入账号密码
    await page.type('#login-account-name', username, { delay: 50 })
    await page.type('#login-account-password', password, { delay: 50 })

    // 点击登录按钮
    await page.click('#login-button')

    // 等待登录完成（增加等待时间）
    logger.info('[linuxdo-plugin] 等待登录完成...')
    await new Promise(r => setTimeout(r, 8000))

    // 检查是否登录成功
    const loggedIn = await isLoggedIn(page)
    if (loggedIn) {
      logger.info('[linuxdo-plugin] 自动登录成功')

      // 登录成功后跳转到配置的页面
      logger.info(`[linuxdo-plugin] 跳转到配置页面: ${DEFAULT_PAGE}`)
      await page.goto(DEFAULT_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await new Promise(r => setTimeout(r, 5000))

      return true
    } else {
      logger.error('[linuxdo-plugin] 自动登录失败，请检查账号密码')
      return false
    }
  } catch (err) {
    logger.error(`[linuxdo-plugin] 自动登录失败: ${err.message}`)
    return false
  }
}

/**
 * 从浏览器获取 linux.do 的 Cookie
 * @param {boolean} refresh 是否刷新页面
 */
export async function fetchCookieFromBrowser(refresh = false) {
  if (!browser) {
    logger.warn('[linuxdo-plugin] 浏览器未连接')
    return null
  }

  try {
    const page = await getLinuxDoPage()
    if (!page) return null

    // 刷新页面获取最新 Cookie
    if (refresh) {
      logger.info('[linuxdo-plugin] 刷新页面获取最新 Cookie...')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // 获取 Cookie
    const cookies = await page.cookies()
    const cookieStr = cookies
      .filter(c => c.domain.includes('linux.do'))
      .map(c => `${c.name}=${c.value}`)
      .join('; ')

    if (!cookieStr) {
      logger.warn('[linuxdo-plugin] 未获取到 Cookie，请确保已登录 linux.do')
      return null
    }

    logger.info(`[linuxdo-plugin] 获取 Cookie 成功，长度: ${cookieStr.length}`)
    return cookieStr
  } catch (err) {
    logger.error(`[linuxdo-plugin] 获取 Cookie 失败: ${err.message}`)
    // 连接可能已断开，重置
    linuxDoPage = null
    browser = null
    return null
  }
}

/**
 * 更新配置文件中的 Cookie
 * @param {string} cookie 新的 Cookie 字符串
 */
export function updateConfigCookie(cookie) {
  try {
    const configContent = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const lines = configContent.split('\n')
    const newLines = []
    let inCookie = false

    for (const line of lines) {
      if (line.startsWith('cookie:')) {
        inCookie = true
        newLines.push('cookie: >-')
        newLines.push(`  ${cookie}`)
        continue
      }

      if (inCookie) {
        // 跳过旧的 cookie 内容行（以空格开头的行）
        if (line.match(/^\s+\S/) && !line.includes(':')) {
          continue
        }
        // 遇到新的配置项或空行，结束 cookie 区域
        if (line.trim() === '' || (line.trim() && !line.startsWith(' '))) {
          inCookie = false
        }
      }

      if (!inCookie) {
        newLines.push(line)
      }
    }

    fs.writeFileSync(CONFIG_PATH, newLines.join('\n'))
    logger.info('[linuxdo-plugin] Cookie 已更新到配置文件')
    return true
  } catch (err) {
    logger.error(`[linuxdo-plugin] 更新配置文件失败: ${err.message}`)
    return false
  }
}

/**
 * 自动刷新 Cookie（获取并更新）
 * @param {boolean} refresh 是否刷新页面
 */
export async function refreshCookie(refresh = false) {
  if (!browser) {
    logger.warn('[linuxdo-plugin] 浏览器未连接')
    return false
  }

  try {
    const page = await getLinuxDoPage()
    if (!page) return false

    // 刷新页面
    if (refresh) {
      logger.info('[linuxdo-plugin] 刷新页面获取最新 Cookie...')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await new Promise(r => setTimeout(r, 3000))
    }

    // 检测登录状态
    const loggedIn = await isLoggedIn(page)
    if (!loggedIn) {
      // 读取配置获取账号密码
      const config = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      const { username, password } = config.autoCookie || {}

      if (username && password) {
        logger.info('[linuxdo-plugin] 登录状态失效，尝试自动登录...')
        const loginSuccess = await autoLogin(page, username, password)
        if (!loginSuccess) {
          return false
        }
        logger.info('[linuxdo-plugin] 登录成功，正在获取新 Cookie...')
      } else {
        logger.warn('[linuxdo-plugin] 登录状态失效，但未配置账号密码')
        return false
      }
    }

    // 获取并更新 Cookie
    logger.info('[linuxdo-plugin] 正在从浏览器获取 Cookie...')
    const cookie = await fetchCookieFromBrowser(false)
    if (cookie) {
      const result = updateConfigCookie(cookie)
      if (result) {
        logger.info('[linuxdo-plugin] Cookie 更新完成')
      }
      return result
    }
    logger.warn('[linuxdo-plugin] 未能获取到 Cookie')
    return false
  } catch (err) {
    logger.error(`[linuxdo-plugin] 刷新 Cookie 失败: ${err.message}`)
    return false
  }
}

/**
 * 初始化自动 Cookie 刷新
 * @param {Object} config 配置对象
 */
export async function initAutoCookie(config) {
  if (!config?.autoCookie?.enable) {
    logger.info('[linuxdo-plugin] 自动 Cookie 刷新未启用')
    return false
  }

  const { browserPath, debuggingPort } = config.autoCookie

  // 启动/连接浏览器
  const success = await launchBrowser(browserPath, debuggingPort)
  if (!success) {
    logger.error('[linuxdo-plugin] 自动 Cookie 初始化失败：无法连接浏览器')
    return false
  }

  // 获取初始 Cookie
  await refreshCookie(false)

  logger.info('[linuxdo-plugin] 自动 Cookie 刷新已初始化')
  return true
}

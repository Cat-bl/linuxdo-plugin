import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import LinuxDoApp from './apps/linuxdo.js'
import { initAutoCookie, refreshCookie } from './models/cookie.js'

const apps = { LinuxDoApp }

logger.info(chalk.rgb(100, 200, 100)(`[linuxdo-plugin] Linux.do 订阅推送插件加载完成`))

// 启动时初始化自动 Cookie 刷新
const PLUGIN_PATH = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const CONFIG_PATH = path.join(PLUGIN_PATH, 'data', 'config.yaml')

let cookieRefreshTimer = null

setTimeout(async () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      const success = await initAutoCookie(config)

      // 启动定时刷新 Cookie
      if (success && config?.autoCookie?.enable) {
        const minutes = config.autoCookie.refreshInterval || 20
        const interval = minutes * 60 * 1000
        cookieRefreshTimer = setInterval(async () => {
          logger.info('[linuxdo-plugin] 定时刷新 Cookie...')
          await refreshCookie(true) // true = 刷新页面
        }, interval)
        logger.info(`[linuxdo-plugin] Cookie 定时刷新已启动（每${minutes}分钟）`)
      }
    }
  } catch (err) {
    logger.error(`[linuxdo-plugin] 自动 Cookie 初始化失败: ${err.message}`)
  }
}, 5000) // 延迟 5 秒等待机器人完全启动

export { apps }

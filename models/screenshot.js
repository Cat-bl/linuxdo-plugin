/**
 * Linux.do 页面截图模块
 */
import puppeteer from 'puppeteer'

/**
 * 截图帖子页面
 * @param {string} url 帖子链接
 * @param {Object} proxy 代理配置
 * @param {string} cookie Linux.do 的 _t cookie 值
 * @returns {Promise<{screenshot: Buffer, cdkUrl: string|null}>} 图片 Buffer 和 CDK 链接
 */
export async function screenshotPost(url, proxy = null, cookie = '') {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled'
  ]

  // 配置代理
  if (proxy?.enable && proxy.host && proxy.port) {
    args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`)
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args
  })

  try {
    const page = await browser.newPage()

    // 设置 User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    // 设置 Cookie 绕过 Cloudflare
    if (cookie) {
      // 解析 cookie 字符串为数组
      const cookies = cookie.split(';').map(pair => {
        const [name, ...valueParts] = pair.trim().split('=')
        return {
          name: name.trim(),
          value: valueParts.join('='), // 值可能包含 =
          domain: 'linux.do',
          path: '/'
        }
      }).filter(c => c.name && c.value)

      if (cookies.length > 0) {
        await page.setCookie(...cookies)
      }
    }

    await page.setViewport({
      width: 800,
      height: 2000,
      deviceScaleFactor: 2
    })

    // 设置超时
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    })

    // 等待主要内容加载
    await page.waitForSelector('.topic-body, .post-stream, #main-outlet', { timeout: 10000 }).catch(() => {})

    // 多次滚动页面加载评论
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, 1000)
        await new Promise(r => setTimeout(r, 800))
      }
      // 回到顶部
      window.scrollTo(0, 0)
      await new Promise(r => setTimeout(r, 500))
    })

    // 额外等待渲染
    await new Promise(r => setTimeout(r, 5000))

    // 隐藏不需要的元素
    await page.evaluate(() => {
      // 隐藏顶部横幅
      const banner = document.querySelector('.custom-banner, .global-notice')
      if (banner) banner.style.display = 'none'

      // 隐藏侧边栏
      const sidebar = document.querySelector('.sidebar-wrapper, #d-sidebar')
      if (sidebar) sidebar.style.display = 'none'

      // 隐藏底部回复框
      const replyArea = document.querySelector('.reply-area, #reply-control')
      if (replyArea) replyArea.style.display = 'none'

      // 隐藏页脚
      const footer = document.querySelector('footer, .footer-links')
      if (footer) footer.style.display = 'none'

      // 隐藏 Cloudflare 验证框（如果有）
      const cf = document.querySelector('#challenge-running, .cf-browser-verification')
      if (cf) cf.style.display = 'none'

      // 隐藏顶部导航
      const header = document.querySelector('.d-header-wrap, header.d-header')
      if (header) header.style.display = 'none'
    })

    // 计算主帖 + 5条评论的区域
    const clipArea = await page.evaluate(() => {
      const posts = document.querySelectorAll('.topic-post')
      if (posts.length === 0) return null

      // 取主帖 + 最多5条评论
      const count = Math.min(posts.length, 6)
      const firstPost = posts[0]
      const lastPost = posts[count - 1]

      const firstRect = firstPost.getBoundingClientRect()
      const lastRect = lastPost.getBoundingClientRect()

      // 计算总区域
      return {
        x: firstRect.x,
        y: firstRect.y + window.scrollY,
        width: firstRect.width,
        height: (lastRect.y + lastRect.height) - firstRect.y
      }
    })

    const logoHeight = 45
    const padding = 20

    let finalClip
    if (clipArea) {
      finalClip = {
        x: Math.max(0, clipArea.x - padding),
        y: clipArea.y,
        width: clipArea.width + padding * 2,
        height: clipArea.height
      }
    } else {
      finalClip = { x: 0, y: 0, width: 840, height: 800 }
    }

    // 在截图区域底部添加 logo
    await page.evaluate((clip, logoH) => {
      const logo = document.createElement('div')
      logo.id = 'linuxdo-plugin-logo'
      logo.style.cssText = `
        position: absolute;
        left: ${clip.x}px;
        top: ${clip.y + clip.height}px;
        width: ${clip.width}px;
        height: ${logoH}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: #888;
        background: linear-gradient(to right, #f8f9fa, #e9ecef, #f8f9fa);
        border-top: 1px solid #dee2e6;
        z-index: 99999;
      `
      logo.textContent = 'TRSS yunzai & linuxdo-plugin by 冰凉到通透'
      document.body.appendChild(logo)
    }, finalClip, logoHeight)

    // 截图（包含 logo）
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: finalClip.x,
        y: finalClip.y,
        width: finalClip.width,
        height: finalClip.height + logoHeight
      }
    })

    // 从主帖内容中提取 CDK 链接和帖子信息
    const postInfo = await page.evaluate(() => {
      // 获取主帖内容区域
      const firstPost = document.querySelector('.topic-post .cooked, .topic-post .post-body')
      let cdkUrl = null
      if (firstPost) {
        const content = firstPost.innerHTML || ''
        const cdkRegex = /https:\/\/cdk\.linux\.do\/[^\s<>"']+/g
        const matches = content.match(cdkRegex)
        cdkUrl = matches ? matches[0] : null
      }

      // 获取帖子标题
      const titleEl = document.querySelector('.fancy-title, #topic-title .fancy-title, h1')
      const title = titleEl ? titleEl.textContent.trim() : ''

      // 获取发帖用户
      const userEl = document.querySelector('.topic-post .username a, .topic-post .names .username')
      const creator = userEl ? userEl.textContent.trim() : ''

      // 获取发帖时间
      const timeEl = document.querySelector('.topic-post .post-date, .topic-post time')
      const pubDate = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : ''

      return { cdkUrl, title, creator, pubDate }
    })

    return {
      screenshot,
      cdkUrl: postInfo.cdkUrl,
      title: postInfo.title,
      creator: postInfo.creator,
      pubDate: postInfo.pubDate
    }
  } finally {
    await browser.close()
  }
}

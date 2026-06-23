/**
 * Linux.do 页面截图模块
 */
import puppeteer from 'puppeteer'

/**
 * 安全执行 page.evaluate：页面若在执行期间发生导航（如 Cloudflare 自动刷新）
 * 导致上下文销毁，则等待页面重新稳定后重试，避免整个流程崩溃
 */
async function safeEvaluate(page, fn, ...args) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.evaluate(fn, ...args)
    } catch (e) {
      const msg = String(e?.message || '')
      if (msg.includes('Execution context was destroyed') || msg.includes('Cannot find context')) {
        // 页面发生了导航，等它重新稳定后重试
        await page.waitForSelector('.topic-post, .post-stream, #main-outlet', { timeout: 15000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      throw e
    }
  }
  // 最后再尝试一次，仍失败则抛出
  return await page.evaluate(fn, ...args)
}

/**
 * 截图帖子页面
 * @param {string} url 帖子链接
 * @param {Object} proxy 代理配置
 * @param {string} cookie Linux.do 的 _t cookie 值
 * @param {string} userAgent User-Agent
 * @param {boolean} showLogo 是否显示底部 logo
 * @returns {Promise<{screenshot: Buffer, cdkUrl: string|null}>} 图片 Buffer 和 CDK 链接
 */
export async function screenshotPost(url, proxy = null, cookie = '', userAgent = '', showLogo = true) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    // linux.do(Discourse) 帖子布局依赖 CSS 容器查询(@container)，
    // puppeteer 自带的旧版 Chromium 默认不支持，会丢弃这些规则导致布局错乱，
    // 用 flag 强制开启容器查询及实验性 Web 特性
    '--enable-blink-features=CSSContainerQueries',
    '--enable-experimental-web-platform-features'
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
    await page.setUserAgent(userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

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
      height: 6000,
      deviceScaleFactor: 2
    })

    // 等待整页加载完成
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    })

    // 等待页面稳定：轮询直到不再是 Cloudflare "稍候" 页、且帖子内容出现、URL 不再变化
    // （Cloudflare 会在加载后自动 reload 校验 cf_clearance，必须等它彻底跑完再操作 DOM）
    let lastUrl = ''
    let stableCount = 0
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000))
      let title = ''
      let curUrl = ''
      let hasPost = false
      try {
        title = await page.title()
        curUrl = page.url()
        hasPost = await page.evaluate(() => !!document.querySelector('.topic-post'))
      } catch {
        // 正在导航，上下文暂时不可用，继续等
        continue
      }
      const inChallenge = title.includes('稍候') || title.includes('Just a moment')
      if (!inChallenge && hasPost && curUrl === lastUrl) {
        stableCount++
        if (stableCount >= 2) break  // 连续 2 秒 URL 未变且内容就绪，判定稳定
      } else {
        stableCount = 0
      }
      lastUrl = curUrl
    }

    // 从根上阻止页面内链接点击触发整页导航（捕获阶段 preventDefault）
    await safeEvaluate(page, () => {
      document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a[href]')
        if (a) e.preventDefault()
      }, true)
    })

    // 分多次滚动加载评论（由 Node 驱动，每步是短 evaluate，避免长时间占用上下文撞上导航）
    for (let i = 0; i < 6; i++) {
      await safeEvaluate(page, () => window.scrollBy(0, 1000))
      await new Promise(r => setTimeout(r, 800))
    }
    await safeEvaluate(page, () => window.scrollTo(0, 0))
    await new Promise(r => setTimeout(r, 500))

    // 展开剧透/折叠内容（不点击链接，避免导航；图片模糊由注入的 CSS 持续去除）
    await safeEvaluate(page, () => {
      // 去除剧透模糊（移除类名 + 内联样式，不触发点击）
      document.querySelectorAll('.spoiled, .spoiler-blurred, [data-spoiler-state="blurred"]').forEach(el => {
        el.classList.remove('spoiler-blurred', 'blurred', 'spoiled')
        el.removeAttribute('data-spoiler-state')
        el.style.filter = 'none'
      })
      // 移除图片模糊样式
      document.querySelectorAll('img').forEach(img => {
        img.style.filter = 'none'
      })
      // 展开所有 <details> 折叠内容 (Summary)
      document.querySelectorAll('details').forEach(el => {
        el.setAttribute('open', '')
      })
    })
    await new Promise(r => setTimeout(r, 500))

    // 额外等待渲染
    await new Promise(r => setTimeout(r, 5000))

    // 隐藏不需要的元素
    await safeEvaluate(page, () => {
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

      // 隐藏"上次访问"红线
      const lastVisit = document.querySelector('.topic-post-visited-line, .post-stream .topic-post-visited')
      if (lastVisit) lastVisit.style.display = 'none'

      // 移除弹窗（error/403 等对话框）和遮罩层
      document.querySelectorAll(
        '.modal, .modal-backdrop, .d-modal, .modal-container, ' +
        '#dialog-holder, .dialog-container, .dialog-overlay, .dialog-content, ' +
        '.bootbox, .fade.in, .ember-modal-wrapper, .modal-overlay'
      ).forEach(el => el.remove())

      // 移除 body 上因弹窗添加的滚动锁定样式
      document.body.classList.remove('modal-open', 'dialog-open')
      document.body.style.overflow = ''

      // 隐藏用户名水印 + 修正帖子布局（容器查询不生效时用扁平 CSS 兜底）
      const styleEl = document.createElement('style')
      styleEl.textContent = `
        div[style*="position: fixed"][style*="z-index: 999999"][style*="pointer-events: none"],
        div[style*="position:fixed"][style*="z-index:999999"][style*="pointer-events:none"],
        div[style*="background-image"][style*="z-index: 999999"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }

        /* 头像列与正文横向排列（替代失效的 @container 布局） */
        .topic-post .post__row {
          display: flex !important;
          flex-direction: row !important;
          align-items: flex-start !important;
        }
        .topic-post .topic-avatar {
          flex: 0 0 auto !important;
        }
        .topic-post .post__body,
        .topic-post .topic-body {
          flex: 1 1 auto !important;
          min-width: 0 !important;
        }
        /* 头像角标(flair)定位回头像右下角 */
        .topic-post .post-avatar {
          position: relative !important;
        }
        .topic-post .avatar-flair {
          position: absolute !important;
          bottom: 0 !important;
          right: 0 !important;
          top: auto !important;
          left: auto !important;
        }
        /* 用户名与时间同一行 */
        .topic-post .topic-meta-data {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          flex-wrap: nowrap !important;
          margin-bottom: 12px !important;
        }
        .topic-post .topic-meta-data .names {
          margin-right: auto !important;
        }
        /* 增加间距，避免布局过于拥挤 */
        .topic-post .post__row {
          padding: 14px 0 !important;
          column-gap: 14px !important;
        }
        .topic-post .topic-avatar {
          padding-right: 4px !important;
        }
        .topic-post .cooked {
          line-height: 1.6 !important;
          margin-bottom: 10px !important;
        }
        .topic-post .cooked p {
          margin: 0 0 10px 0 !important;
        }
        .topic-post .post-menu-area,
        .topic-post .post__actions,
        .topic-post .actions {
          margin-top: 8px !important;
        }
        /* 持续去除图片/剧透模糊（对懒加载后才出现的图片同样生效） */
        .topic-post img,
        .topic-post .cooked img,
        .lightbox-wrapper img {
          filter: none !important;
        }
        .spoiled, .spoiler-blurred, .blurred,
        [data-spoiler-state="blurred"] {
          filter: none !important;
        }
        .spoiler-blurred, .blurred, .spoiled {
          opacity: 1 !important;
        }
      `
      document.head.appendChild(styleEl)

      // 额外遍历移除水印元素
      document.querySelectorAll('div').forEach(el => {
        const s = el.getAttribute('style') || ''
        if (s.includes('z-index') && s.includes('999999') && s.includes('pointer-events')) {
          el.remove()
        }
      })
    })

    // 截图前再次展开剧透/折叠并去模糊（处理等待期间懒加载进来的图片）
    await safeEvaluate(page, () => {
      document.querySelectorAll('.spoiled, .spoiler-blurred, [data-spoiler-state="blurred"]').forEach(el => {
        el.classList.remove('spoiler-blurred', 'blurred', 'spoiled')
        el.removeAttribute('data-spoiler-state')
        el.style.filter = 'none'
      })
      document.querySelectorAll('img').forEach(img => {
        img.style.filter = 'none'
      })
      document.querySelectorAll('details').forEach(el => {
        el.setAttribute('open', '')
      })
    })
    await new Promise(r => setTimeout(r, 300))

    // 计算主帖 + 5条评论的区域
    const clipArea = await safeEvaluate(page, () => {
      const posts = document.querySelectorAll('.topic-post')
      if (posts.length === 0) return null

      // 取主帖 + 最多5条评论
      const count = Math.min(posts.length, 6)
      const firstPost = posts[0]
      const lastPost = posts[count - 1]

      // 使用 offsetTop 和 offsetHeight 获取绝对位置，避免视口问题
      const getAbsoluteTop = (el) => {
        let top = 0
        while (el) {
          top += el.offsetTop
          el = el.offsetParent
        }
        return top
      }

      const firstTop = getAbsoluteTop(firstPost)
      const lastTop = getAbsoluteTop(lastPost)
      const lastHeight = lastPost.offsetHeight

      // 计算总区域
      return {
        x: firstPost.getBoundingClientRect().x,
        y: firstTop,
        width: firstPost.offsetWidth,
        height: (lastTop + lastHeight) - firstTop
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

    // 在截图区域底部添加 logo（如果启用）
    if (showLogo) {
      await safeEvaluate(page, (clip, logoH) => {
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
        logo.textContent = 'TRSS yunzai & linuxdo-plugin'
        document.body.appendChild(logo)
      }, finalClip, logoHeight)
    }

    // 截图前再次移除水印
    await safeEvaluate(page, () => {
      // 移除所有 fixed 定位的全屏覆盖层（水印特征）
      document.querySelectorAll('body > div, body > *').forEach(el => {
        const style = getComputedStyle(el)
        const isFixed = style.position === 'fixed'
        const isFullScreen = (style.width === '100vw' || parseInt(style.width) >= window.innerWidth) &&
                            (style.height === '100vh' || parseInt(style.height) >= window.innerHeight)
        const hasHighZIndex = parseInt(style.zIndex) > 9999
        const noPointerEvents = style.pointerEvents === 'none'

        if (isFixed && isFullScreen && hasHighZIndex && noPointerEvents) {
          el.remove()
        }
      })
    })

    // 截图（根据配置决定是否包含 logo）
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: finalClip.x,
        y: finalClip.y,
        width: finalClip.width,
        height: finalClip.height + (showLogo ? logoHeight : 0)
      }
    })

    // 从主帖内容中提取 CDK 链接和帖子信息
    const postInfo = await safeEvaluate(page, () => {
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
      const timeEl = document.querySelector('.topic-post time[datetime], .topic-post .relative-date')
      let pubDate = ''
      if (timeEl) {
        pubDate = timeEl.getAttribute('datetime') || timeEl.getAttribute('data-time') || timeEl.title || ''
      }

      // 获取附件文件链接
      const files = []
      const firstPostContent = document.querySelector('.topic-post .cooked, .topic-post .post-body')
      if (firstPostContent) {
        firstPostContent.querySelectorAll('a.attachment').forEach(a => {
          const name = a.textContent.trim()
          const href = a.getAttribute('href')
          if (name && href) {
            const fullUrl = href.startsWith('http') ? href : `https://linux.do${href}`
            files.push({ name, url: fullUrl })
          }
        })
      }

      return { cdkUrl, title, creator, pubDate, files }
    })

    return {
      screenshot,
      cdkUrl: postInfo.cdkUrl,
      title: postInfo.title,
      creator: postInfo.creator,
      pubDate: postInfo.pubDate,
      files: postInfo.files || []
    }
  } finally {
    await browser.close()
  }
}

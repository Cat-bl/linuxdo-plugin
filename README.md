# linuxdo-plugin (dev 分支)

> 本分支（dev）为**无推送、无自动登录**版本，仅保留 Linux.do 帖子链接解析功能。
> linux.do 登录已加入图像识别人机验证，无法自动登录，故移除订阅推送与自动登录相关功能。

自用 Linux.do 社区帖子解析插件，适用于 TRSS-Yunzai / Miao-Yunzai。

## 功能

- 自动检测群聊/私聊中的 linux.do 帖子链接并解析
- 解析内容包含帖子截图、用户名、标题、发帖时间、原帖链接
- 自动检测帖子中的 CDK 链接并在解析结果中显示
- 自动检测帖子中的附件文件链接并显示（包含文件时以转发消息格式发送避免刷屏）
- 支持代理配置（适用于需要科学上网访问的情况）
- 自动 Cookie 刷新：连接浏览器自动获取和更新 Cookie 和 User-Agent
- 登录失效时恢复浏览器窗口并通知主人手动登录
- 配置文件热加载，修改后无需重启机器人

## 安装

1. 在 Yunzai 根目录下执行：
```
git clone --depth=1 https://github.com/Cat-bl/linuxdo-plugin plugins/linuxdo-plugin
```
2. 重启机器人

## 配置

配置文件位于 `plugins/linuxdo-plugin/data/config.yaml`，修改后自动生效。

首次启动时会自动从 `config_default/config.yaml` 复制默认配置到 `data/config.yaml`。

```yaml
# 是否启用群聊链接解析
# 自动检测群聊中的 linux.do/t/topic/xxx 链接并解析
linkParseStatus: true

# 是否在截图底部显示 logo
showLogo: true

# 自动刷新 Cookie 配置
autoCookie:
  enable: true                    # 是否启用自动刷新 Cookie
  refreshInterval: 20              # Cookie 刷新间隔（分钟），为0时禁用定时刷新
  browserPath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"  # 浏览器路径
  debuggingPort: 9222             # 调试端口

# User-Agent（启用 autoCookie 时会自动从浏览器获取）
userAgent: ""

# Linux.do Cookie（启用 autoCookie 时会自动更新）
cookie: >-
  你的cookie内容

# 代理配置
proxy:
  enable: true          # 是否启用代理
  host: "127.0.0.1"     # 代理地址
  port: 7897            # 代理端口
```

### 自动 Cookie 刷新

启用 `autoCookie` 后，插件会：
1. 启动时自动打开浏览器并连接
2. 定时刷新页面获取最新 Cookie 和 User-Agent
3. 检测到登录失效时恢复浏览器窗口并通知主人手动登录
4. 自动同步浏览器的 User-Agent，确保与 Cookie 一致（避免 Cloudflare 403）
5. 自动检测并处理 Cloudflare Turnstile 人机验证
6. 浏览器被手动关闭后自动重新启动并连接

**注意**：linux.do 登录已加入图像识别人机验证，无法自动登录。需要手动在浏览器中登录 linux.do，登录后使用 `#linuxdo刷新cookie` 更新 Cookie。

### Cookie 和 User-Agent 手动获取方法

如果不使用 `autoCookie` 自动刷新功能，需要手动获取：

1. 浏览器登录 https://linux.do
2. 按 F12 打开开发者工具
3. 切换到 Network（网络）标签
4. 刷新页面，点击任意请求
5. 在 Request Headers 中找到 `Cookie` 和 `User-Agent`
6. 复制到配置文件对应字段

**注意**：
- Cookie 使用 `>-` 多行语法，可直接粘贴，无需引号
- Cookie 和 User-Agent 必须来自同一浏览器，否则可能触发 Cloudflare 403
- 启用 `autoCookie` 后会自动获取，无需手动配置

## 指令

| 指令 | 权限 | 说明 |
|------|------|------|
| `#linuxdo连接浏览器` | 主人 | 手动连接浏览器 |
| `#linuxdo断开浏览器` | 主人 | 断开浏览器连接 |
| `#linuxdo刷新cookie` | 主人 | 手动刷新 Cookie |

### 链接解析

在群聊/私聊中发送包含 `https://linux.do/t/topic/xxx` 格式的链接时，会自动触发帖子解析（需要 `linkParseStatus: true`）。

## 解析效果

```
[帖子页面截图（含主帖+评论）]

Linux do社区帖子解析:
用户：neo
标题：帖子标题
发帖时间：2026-01-13 12:30
原帖：https://linux.do/t/topic/xxx

---检测到存在CDK链接---
CDK链接：https://cdk.linux.do/xxx/xxx
```

截图包含：
- 帖子标题
- 主帖内容
- 最多 5 条评论
- 底部 Logo 水印

当帖子包含附件文件时，额外显示：
```
---检测到存在2个文件链接---
1.g.7z: https://linux.do/uploads/short-url/xxx
2.api_solver.7z: https://linux.do/uploads/short-url/xxx
```
且消息以 QQ 转发格式发送，避免刷屏。

## 数据存储

- **默认配置**: `config_default/config.yaml` - 配置模板（提交到 Git）
- **用户配置**: `data/config.yaml` - 用户配置（不提交到 Git，首次启动自动复制）
- **浏览器数据**: `data/browser-data/` - 独立的浏览器用户数据目录

## 常见问题

### 1. 解析失败

- 检查网络是否能访问 linux.do
- 如需代理，确保配置正确且代理软件已启动
- 检查 Cookie 和 User-Agent 是否正确配置
- 尝试使用 `#linuxdo刷新cookie` 更新 Cookie

### 2. 截图显示 Cloudflare 验证

- 配置完整的 `cookie` 字段
- Cookie 过期后需重新获取或启用自动刷新

### 3. 修改配置后需要重启吗

不需要，配置文件支持热加载，修改后自动生效。

### 4. 自动 Cookie 刷新不工作

- 确保 `autoCookie.enable` 为 `true`
- 检查 `browserPath` 是否正确指向浏览器可执行文件
- 确保没有其他程序占用 `debuggingPort` 端口
- 首次使用需要在浏览器中手动登录

### 5. 登录失效了怎么办

linux.do 登录已加入图像识别人机验证，无法自动登录。检测到登录失效时插件会恢复浏览器窗口并通知主人，请在浏览器窗口中手动登录，登录后使用 `#linuxdo刷新cookie` 更新 Cookie。

## 技术实现

- Puppeteer 截图，支持代理和 Cookie
- Puppeteer 连接浏览器实现 Cookie 自动刷新
- chokidar 监听配置文件变化实现热加载

```
plugins/
└── linuxdo-plugin/
    ├── index.js          # 插件入口
    ├── package.json      # 依赖配置
    ├── README.md
    ├── apps/
    │   └── linuxdo.js    # 主逻辑（帖子解析）
    ├── models/
    │   ├── screenshot.js # 页面截图
    │   └── cookie.js     # Cookie 自动刷新
    ├── config_default/   # 默认配置模板（提交到 Git）
    │   └── config.yaml
    └── data/             # 运行时数据（不提交到 Git）
        ├── config.yaml   # 用户配置
        └── browser-data/ # 浏览器数据
```

## License

MIT

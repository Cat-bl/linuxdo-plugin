# linuxdo-plugin

自用Linux.do 社区用户订阅推送插件，适用于 TRSS-Yunzai / Miao-Yunzai。

## 功能

- 订阅 Linux.do 社区用户，当用户发布新帖子时自动推送到群聊/私聊
- 推送内容包含帖子截图、用户名、标题、发帖时间、原帖链接
- 自动检测帖子中的 CDK 链接并在推送中显示
- 支持多群/多用户订阅，各群推送独立互不影响
- 支持代理配置（适用于需要科学上网访问的情况）
- 自动 Cookie 刷新：连接浏览器自动获取和更新 Cookie 和 User-Agent
- 自动登录：Cookie 失效时自动使用配置的账号密码登录
- 配置文件热加载，修改后无需重启机器人
- 凌晨 3:00-5:59 休眠时段不执行推送

## 安装

1. 将 `linuxdo-plugin` 文件夹放入 `plugins` 目录
2. 安装依赖：`pnpm install --filter=linuxdo-plugin`
3. 重启机器人

```
plugins/
└── linuxdo-plugin/
    ├── index.js          # 插件入口
    ├── package.json      # 依赖配置
    ├── README.md
    ├── apps/
    │   └── linuxdo.js    # 主逻辑
    ├── models/
    │   ├── rss.js        # 数据获取与解析
    │   ├── screenshot.js # 页面截图
    │   └── cookie.js     # Cookie 自动刷新
    ├── config_default/   # 默认配置模板（提交到 Git）
    │   └── config.yaml
    └── data/             # 运行时数据（不提交到 Git）
        ├── config.yaml   # 用户配置
        ├── push.yaml     # 订阅数据
        └── browser-data/ # 浏览器数据
```

## 依赖

- `https-proxy-agent` - 代理支持
- `yaml` - 配置文件解析
- `chokidar` - 配置热加载
- `puppeteer` - 页面截图和浏览器自动化

## 配置

配置文件位于 `plugins/linuxdo-plugin/data/config.yaml`，修改后自动生效。

首次启动时会自动从 `config_default/config.yaml` 复制默认配置到 `data/config.yaml`。

```yaml
# 是否启用推送
pushStatus: true

# 检测间隔 (Cron 表达式)
checkInterval: "*/5 * * * *"

# 请求重试次数
maxRetries: 20

# 请求延迟（秒），多用户时每个用户请求之间的间隔
# 设为 0 则无延迟，默认 15-20 秒随机延迟
requestDelay: 15

# 自动刷新 Cookie 配置
autoCookie:
  enable: true                    # 是否启用自动刷新 Cookie
  refreshInterval: 20             # Cookie 刷新间隔（分钟）,为0时禁用定时刷新
  browserPath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"  # 浏览器路径
  debuggingPort: 9222             # 调试端口
  # 自动登录配置（登录失效时自动登录）
  username: ""                    # linux.do 用户名或邮箱
  password: ""                    # linux.do 密码

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
3. 请求失败达到 `maxRetries` 次数后自动刷新 Cookie
4. 检测到登录失效时自动使用配置的账号密码登录
5. 自动同步浏览器的 User-Agent，确保与 Cookie 一致（避免 Cloudflare 403）

**注意**：首次使用需要手动在浏览器中登录 linux.do，或配置 `username` 和 `password` 实现自动登录。

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

### Cron 表达式示例

| 表达式 | 说明 |
|--------|------|
| `*/5 * * * *` | 每 5 分钟 |
| `*/30 * * * *` | 每 30 分钟 |
| `0 * * * *` | 每小时整点 |
| `0 */2 * * *` | 每 2 小时 |

## 指令

| 指令 | 权限 | 说明 |
|------|------|------|
| `#订阅linuxdo 用户名` | 主人 | 订阅用户 |
| `#取消订阅linuxdo 用户名` | 主人 | 取消订阅 |
| `#linuxdo列表` | 所有人 | 查看当前订阅列表 |
| `#测试linuxdo推送` | 主人 | 测试推送功能（订阅用户最新帖子） |
| `#测试linuxdo推送 帖子ID` | 主人 | 测试指定帖子的推送 |
| `#重置linuxdo推送` | 主人 | 重置当前群全部推送记录 |
| `#重置linuxdo推送 用户名` | 主人 | 重置指定用户的推送记录 |
| `#linuxdo标记已推送 帖子ID/用户名 [群号]` | 主人 | 标记帖子为已推送 |
| `#linuxdo清除全部推送` | 主人 | 清除所有群的推送记录 |
| `#linuxdo连接浏览器` | 主人 | 手动连接浏览器 |
| `#linuxdo断开浏览器` | 主人 | 断开浏览器连接 |
| `#linuxdo刷新cookie` | 主人 | 手动刷新 Cookie |

### 使用示例

```
#订阅linuxdo neo
#订阅linuxdo Cat-bl
#linuxdo列表
#取消订阅linuxdo neo
#测试linuxdo推送
#测试linuxdo推送 1420507
#重置linuxdo推送
#重置linuxdo推送 neo
#linuxdo标记已推送 1436129
#linuxdo标记已推送 Cat-bl
#linuxdo标记已推送 1436129 123456789
#linuxdo清除全部推送
#linuxdo连接浏览器
#linuxdo刷新cookie
```

## 推送效果

```
[帖子页面截图（含主帖+评论）]

Linux do社区订阅推送:
用户：neo
标题：帖子标题
发帖时间：2026-01-13 12:30
原帖：https://linux.do/t/topic/xxx

---检测到存在CDK链接---
CDK链接：https://cdk.linux.do/xxx/xxx
```

截图包含：
- 主帖内容
- 最多 5 条评论
- 底部 Logo 水印

## 数据存储

- **默认配置**: `config_default/config.yaml` - 配置模板（提交到 Git）
- **用户配置**: `data/config.yaml` - 用户配置（不提交到 Git，首次启动自动复制）
- **订阅数据**: `data/push.yaml` - 存储群/私聊的订阅列表
- **浏览器数据**: `data/browser-data/` - 独立的浏览器用户数据目录
- **去重缓存**: Redis
  - 已推送记录：72 小时过期
  - 重试计数：24 小时过期，最多重试 3 次

## 推送机制

- 每次定时任务只检查用户最新的 1 条帖子（按发布时间排序）
- 使用帖子 ID + 群号作为去重键，各群推送独立
- 多群订阅同一用户时，只请求一次 API，避免重复请求
- 请求间隔 15-20 秒，避免触发限流
- 截图或发送失败时自动重试（最多 3 次）
- 凌晨 3:00-5:59 为休眠时段，不执行推送
- 请求失败达到 `maxRetries` 次数后自动刷新 Cookie
- 检测到数据非最新（`can_create_topic=false`）时自动刷新 Cookie
- 可使用 `#重置linuxdo推送` 清除推送记录，触发重新推送

## 常见问题

### 1. 获取数据失败

- 检查网络是否能访问 linux.do
- 如需代理，确保配置正确且代理软件已启动
- 检查 Cookie 和 User-Agent 是否正确配置
- 检查用户名是否正确（区分大小写）
- 尝试使用 `#linuxdo刷新cookie` 更新 Cookie

### 2. 截图显示 Cloudflare 验证

- 配置完整的 `cookie` 字段
- Cookie 过期后需重新获取或启用自动刷新

### 3. 没有收到推送

- 确认 `pushStatus` 为 `true`
- 检查 Redis 是否正常运行
- 查看机器人日志是否有报错
- 使用 `#测试linuxdo推送` 测试
- 注意凌晨 3:00-5:59 为休眠时段

### 4. 如何获取用户名

访问用户主页，URL 中 `/u/` 后面的部分即为用户名：
```
https://linux.do/u/neo  →  用户名: neo
```

### 5. 修改配置后需要重启吗

不需要，配置文件支持热加载，修改后自动生效。

### 6. 自动 Cookie 刷新不工作

- 确保 `autoCookie.enable` 为 `true`
- 检查 `browserPath` 是否正确指向浏览器可执行文件
- 确保没有其他程序占用 `debuggingPort` 端口
- 首次使用需要在浏览器中手动登录，或配置账号密码

### 7. 自动登录失败

- 检查 `username` 和 `password` 是否正确
- 确保账号没有开启二次验证
- 查看日志中的具体错误信息

## 技术实现

- JSON API: `https://linux.do/topics/created-by/{username}.json`
- Node.js 原生 `https` 模块 + `https-proxy-agent` 代理
- Puppeteer 截图，支持代理和 Cookie
- Puppeteer 连接浏览器实现 Cookie 自动刷新
- chokidar 监听配置文件变化实现热加载
- Redis 存储推送记录和重试计数

## License

MIT

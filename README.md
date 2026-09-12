#    hunderbird Mail Tracker MVP

一个不依赖前端框架的 Thunderbird Manifest V3 邮件追踪原型。用户在 HTML 写信窗口中明确开启追踪后，扩展会在发送前创建记录并向正文末尾加入 1×1 透明图片。FastAPI 服务在该图片被请求时记录检测事件。

> “检测到打开”只表示 tracking pixel URL 被请求，不等同于收件人真实阅读了邮件。

## 项目结构

```text
MailExtension/
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── compose.js
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── options.html
│   ├── options.css
│   ├── options.js
│   └── icons/tracker.svg
├── server/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── requirements.txt
│   ├── Dockerfile
│   └── docker-compose.yml
└── README.md
```

## API 与 Thunderbird 实现说明

- `compose_action` 在写信工具栏提供 **Track Email** 开关。
- `messenger.compose.onBeforeSend` 读取官方 `ComposeDetails.body` 并通过返回 `details.body` 修改 HTML 正文。
- `messenger.compose.onAfterSend` 在发送成功后读取 `headerMessageId`；该值仅在 Thunderbird 能可靠提供时保存。
- `messenger.storage.local` 保存扩展记录、设置及写信窗口状态。
- MV3 后台使用 Thunderbird 支持的 Limited Event Page 形式：`background.scripts`。事件监听器均在脚本顶层注册。
- 不使用 Firefox 网页专属能力，也不使用 Thunderbird Experiment API。

MVP 只允许一名收件人（To、Cc、Bcc 合计恰好一人），且只追踪 HTML 邮件。纯文本邮件无法包含图片；Thunderbird 官方 API 也不允许把已经打开的纯文本写信窗口转换为 HTML，因此这种情况会取消发送。

## A. 使用 uv 运行 FastAPI 后端

Python 环境与依赖统一由 [uv](https://docs.astral.sh/uv/) 管理。项目要求 Python 3.11 或更高版本；如果本机没有合适版本，uv 可以自动安装。

首次同步依赖：

```bash
cd ~/code/MailExtension/server
uv sync --locked
```

启动开发服务器：

```bash
uv run --locked uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

检查服务：

```bash
curl http://localhost:8000/health
```

SQLite 数据默认写入 `server/data/tracker.db`。添加或删除依赖时使用 `uv add <package>`、`uv remove <package>`，提交 `pyproject.toml` 和 `uv.lock`。`requirements.txt` 仅作为兼容清单，不用于本项目环境同步。

## B. 使用 Docker Compose 启动

```bash
cd ~/code/MailExtension/server
docker compose up --build
```

服务监听 `http://localhost:8000`，SQLite 文件存放在命名 volume `tracker_data` 中。停止服务：

```bash
docker compose down
```

不要添加 `-v`，除非确实希望删除持久化数据库。

## C. 在 Thunderbird 中临时加载扩展

推荐 Thunderbird 128 ESR 或更高版本：

1. 打开 **Settings**。
2. 进入 **Add-ons and Themes**。
3. 点击齿轮菜单并选择 **Debug Add-ons**。
4. 点击 **Load Temporary Add-on**。
5. 选择 `C:\Users\jjboy\code\MailExtension\extension\manifest.json`。

修改扩展代码后，在 Debug Add-ons 页面点击该扩展的 **Reload**。

## D. 设置 Tracking Server URL

1. 在 Add-ons Manager 中打开本扩展的 Preferences/Options。
2. 输入 `https://tracker.775772.xyz`（当前公网开发服务器默认值）。
3. 点击 **Save**。

不要在 URL 末尾填写 `/api/tracks`。

MVP manifest 默认只授权：

- `http://localhost:8000/*`
- `http://127.0.0.1:8000/*`
- `https://tracker.775772.xyz/*`

若改为其他域名，需要把对应匹配规则加入 `extension/manifest.json` 的 `host_permissions` 后重新加载扩展。正式部署应使用 HTTPS。

## E. 发送一封测试邮件

1. 确认后端正在运行。
2. 在 Thunderbird 新建一封 **HTML** 邮件。
3. 只填写一个收件人。
4. 点击写信工具栏中的 **Track Email**；按钮 badge 显示 `ON`。
5. 填写主题与正文并发送。

发送前，扩展会：

1. 生成 UUID `tracking_id`。
2. 调用 `POST /api/tracks`。
3. 在 HTML 末尾插入类似内容：

```html
<img src="http://localhost:8000/open/UUID.png" width="1" height="1" alt="" />
```

4. 发送成功后，在本地保存记录及可用的 `Message-ID`。

如果后端不可访问、邮件是纯文本或收件人不止一人，扩展会取消发送，并在 Track Email 按钮上显示红色 `!`；将鼠标停在按钮上可查看原因。

## F. 验证 pixel 是否被请求

先列出记录并复制 `tracking_id`：

```powershell
Invoke-RestMethod http://localhost:8000/api/tracks
```

模拟收件端加载图片：

```powershell
Invoke-WebRequest http://localhost:8000/open/替换为TRACKING_ID.png -OutFile pixel.png
```

再次查询该记录：

```powershell
Invoke-RestMethod http://localhost:8000/api/tracks/替换为TRACKING_ID
```

应看到：

- `first_opened_at` 首次被写入
- `last_opened_at` 每次请求都会更新
- `open_count` 每次请求增加 1

也可以观察 uvicorn 或 Docker 日志中的 `GET /open/...png` 请求。

重要：`localhost` 指向加载图片的那台机器。如果收件端在另一台电脑或手机上，它无法访问发件电脑的 `localhost`。跨设备测试需要部署一个收件端可访问的 HTTPS 服务，并更新扩展 URL 和 `host_permissions`。

## G. 查看追踪状态

点击 Thunderbird 主工具栏中的扩展图标。popup 会显示本扩展成功发送的记录，并逐条查询：

```text
GET /api/tracks/{tracking_id}
```

状态用语为：

- `Opened detected / 检测到打开`
- `No open detected`

同时显示主题、收件人、tracking ID、发送时间、首次检测时间、最后检测时间与检测次数。

FastAPI 也提供全部记录接口：

```text
GET http://localhost:8000/api/tracks
```

交互式 API 文档位于 `http://localhost:8000/docs`。

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/tracks` | 创建 tracking 记录；相同 ID 的重试是幂等的 |
| `GET` | `/open/{tracking_id}.png` | 记录一次图片加载并返回透明 PNG |
| `GET` | `/api/tracks/{tracking_id}` | 查询单条状态 |
| `GET` | `/api/tracks` | 查询全部状态 |

## 管理员和多用户 Token

管理员界面位于：

```text
https://tracker.775772.xyz/admin
```

当前管理员用户名为部署环境配置中的 `jjboy`。登录后可以创建普通用户；每个用户创建成功时会显示一次 API Token。请立即复制用户名和 Token，并在 Thunderbird 扩展 Options 的 **Username / 用户名** 与 **API Token** 字段中保存。后端只保存 Token 的 SHA-256 hash，之后无法从管理界面再次查看明文 Token。

API Token 会隔离 `/api/tracks` 的创建、列表和单条查询；用户只能看到自己创建的追踪记录。`/open/{tracking_id}.png` 不要求 Token，因为收件人的邮件客户端不会携带发件人的认证信息。

管理员可以在用户列表中点击 **Disable** 停用用户。停用是软删除：Token 立即失效，历史 tracking 数据保留但不再对该用户 API 返回。

部署时将 `server/.env.example` 复制为 `server/.env`，设置 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`，再运行 `docker compose up -d --build`。`.env` 不应提交到 Git。

Pixel 响应包含：

```text
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Expires: 0
```

服务不会记录 IP 地址、User-Agent、设备指纹或地理位置。

## 隐私和准确性限制

远程图片请求不是可靠的“已读回执”：

- Gmail 图片代理可能缓存或代替用户请求图片，造成时间和次数失真。
- Apple Mail Privacy Protection 可能预加载图片，导致误报。
- 企业邮箱安全扫描器可能主动请求图片，导致误报。
- 收件人禁用远程图片、离线阅读或客户端拦截图片时，会产生漏报。
- 邮件被转发后，后续加载仍会计入同一个 tracking ID。

因此 UI 始终使用“检测到打开”，不会声称收件人已经阅读邮件。使用前应确认符合适用的隐私、通信和数据保护要求。

## MVP 范围外

本版本不实现链接点击追踪、多收件人分别追踪、邮件列表自定义列、账号系统、登录、OAuth、推送通知、位置、IP、User-Agent、设备分析或图表统计。

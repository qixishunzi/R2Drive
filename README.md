# R2Drive

`R2Drive` 是一个基于 Cloudflare R2 和 Workers 的私人网盘项目。

当前版本特性：

- 单 Worker、单域名部署
- 账号密码登录，使用 `HttpOnly Cookie` 维持会话
- 文件夹和文件混合列表展示
- 点击文件夹进入目录，支持返回上一层
- 上传文件到当前目录
- 新建文件夹、删除文件、删除文件夹
- 拖拽文件到页面后直接上传到当前目录
- 拖拽文件夹到页面后自动创建同名目录并递归上传
- 生成可管理的直链，支持自定义有效期和永久有效
- 单独的直链管理页面，可修改或删除直链
- 基础文件预览

## 项目结构

```text
frontend/        由 Worker 直接托管的静态前端
worker/          Worker API、R2 逻辑和静态资源入口
package.json     本地开发与部署脚本
```

## 当前界面逻辑

项目当前采用接近网盘产品的列表模式：

- 文件夹和文件显示在同一个列表中
- 点击文件夹进入该目录
- 使用 `上一层` 返回父目录
- `上传文件` 会把所选文件直接上传到当前目录
- `新建文件夹` 可以在当前目录下创建空文件夹
- 将文件拖进页面，会直接上传到当前目录
- 将文件夹拖进页面，会自动在当前目录创建同名文件夹并递归上传内容

为了支持空文件夹，Worker 会在 R2 中写入一个隐藏标记对象：

```text
<folder-path>/.r2drive-folder
```

这个对象仅用于目录存在性标记，前端不会把它展示成普通文件。

## 路由设计

同一个域名下：

- `/` 前端页面
- `/styles.css` 前端样式
- `/app.js` 前端脚本
- `/api/health` 健康检查
- `/api/login` 登录
- `/api/logout` 退出登录
- `/api/session` 当前会话
- `/api/files` 获取文件和文件夹列表
- `/api/folders` 创建文件夹
- `/api/upload?key=...` 上传文件
- `/api/direct-link` 生成签名直链
- `/api/preview-link` 生成预览临时链接
- `/api/links` 获取直链列表
- `/api/files/:key` 删除文件
- `/api/links/:id` 修改或删除直链
- `/api/folders/:key` 删除文件夹及其全部内容
- `/d/:key?expires=...&sig=...` 签名下载链接
- `/s/:id` 持久直链访问地址

## 直链有效期

项目现在有两类链接：

- 预览链接：临时生成，只给预览功能使用，不进入管理页
- 直链：持久保存，可以在管理页查看、修改和删除

后端允许的有效期范围：

- 最短：`60` 秒
- 最长：`604800` 秒，也就是 `7 天`
- 也支持 `永久有效`

当前前端默认值：

- 文件预览使用 `1800` 秒，也就是 `30 分钟`
- 创建直链时前端可选：`1 小时`、`1 天`、`7 天`、`永久有效`

直链管理页地址：

```text
/links.html
```

在那里可以：

- 查看对应文件
- 查看直链剩余时长
- 修改时长
- 删除直链

## 本地开发

安装依赖：

```bash
npm install
```

启动本地 Worker：

```bash
npm run dev
```

启动后：

- 页面由 Worker 直接返回
- 前端与 API 使用同一个本地地址

## Cloudflare 配置

### 1. 创建 R2 Bucket

在 Cloudflare 后台创建一个名为 `r2drive` 的 R2 Bucket。

如果你想使用其他 bucket 名称，修改 `worker/wrangler.toml`：

```toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "your-bucket-name"
```

### 2. 配置 Worker 变量与机密

普通变量：

- `ALLOWED_ORIGIN=https://your-domain.example`
- `MAX_UPLOAD_SIZE=104857600`

机密：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SIGNING_KEY`

说明：

- `ALLOWED_ORIGIN` 填你最终访问前端的域名
- `MAX_UPLOAD_SIZE` 单位是字节，默认示例值约等于 `100MB`
- `SIGNING_KEY` 用于生成登录会话签名和下载签名

### 3. 绑定 R2 Bucket

在 Worker 设置中添加 R2 绑定：

- Binding name: `BUCKET`
- Bucket: `r2drive`

### 4. 部署 Worker

```bash
npm run deploy
```

如果是 Cloudflare 导入 GitHub 项目，部署命令建议使用：

```bash
npx wrangler deploy --config worker/wrangler.toml
```

### 5. 绑定自定义域名

部署后，把你的自定义域名直接绑定到这个 Worker。

例如：

```text
https://drive.555681.xyz
```

同时把：

```text
ALLOWED_ORIGIN=https://drive.555681.xyz
```

配置到 Worker 变量中。

## 生产环境推荐配置

如果你的最终域名是：

```text
https://drive.555681.xyz
```

那么推荐配置：

- Worker 自定义域：`drive.555681.xyz`
- `ALLOWED_ORIGIN=https://drive.555681.xyz`
- 使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录

## API 概览

### `GET /api/health`

检查 Worker 状态和登录状态。

### `POST /api/login`

账号密码登录，请求体示例：

```json
{
  "username": "admin",
  "password": "your-password"
}
```

### `GET /api/session`

获取当前会话信息。

### `POST /api/logout`

退出登录并清除会话 Cookie。

### `GET /api/files`

返回当前对象列表，包含：

- `files`
- `folders`

### `POST /api/folders`

创建空文件夹，请求体示例：

```json
{
  "path": "docs/manuals"
}
```

### `DELETE /api/folders/:key`

递归删除文件夹及其全部内容。

### `POST /api/upload?key=path/to/file.ext`

上传文件到指定 key。

### `DELETE /api/files/:key`

删除单个文件。

### `POST /api/direct-link`

生成可管理直链，请求体示例：

```json
{
  "key": "docs/manual.pdf",
  "ttlSeconds": 3600
}
```

永久直链示例：

```json
{
  "key": "docs/manual.pdf",
  "permanent": true
}
```

### `POST /api/preview-link`

生成仅供预览使用的临时链接。

### `GET /api/links`

返回直链列表，包含：

- 对应文件 `key`
- 剩余秒数 `remainingSeconds`
- 是否永久有效 `permanent`
- 可访问地址 `url`

### `PATCH /api/links/:id`

修改直链有效期，支持重新设置秒数或改成永久有效。

### `DELETE /api/links/:id`

删除指定直链。

返回结果包含：

- `url`
- `expiresAt`
- `ttlSeconds`

## 当前部署结论

当前版本不需要单独创建 Pages 项目。

你只需要：

1. 一个 Worker 项目
2. 一个绑定到 Worker 的自定义域名
3. 一个 R2 Bucket

这就是当前 `R2Drive` 的推荐部署方式。

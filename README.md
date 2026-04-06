# R2Drive

`R2Drive` 是一个基于 Cloudflare R2 和 Workers 的私人网盘项目，当前版本已经收敛为单项目、单域名部署，并使用账号密码登录进入后台。

支持能力：

- 上传文件到 R2
- 拖拽上传和批量上传
- 目录浏览、删除和基础预览
- 生成带有效期的签名直链
- 同一个 Worker 同时提供前端页面和 API
- 账号密码登录，浏览器使用 HttpOnly Cookie 保存会话

## 项目结构

```text
frontend/        由 Worker 直接托管的静态前端
worker/          Worker API、下载签名和静态资源入口
package.json     本地开发与部署脚本
```

## 路由设计

同一个域名下：

- `/` 前端页面
- `/styles.css` 前端样式
- `/app.js` 前端脚本
- `/api/health` 健康检查
- `/api/files` 文件列表
- `/api/upload?key=...` 上传文件
- `/api/direct-link` 生成签名直链
- `/api/files/:key` 删除文件
- `/d/:key?expires=...&sig=...` 受控下载

## 本地开发

安装依赖：

```bash
npm install
```

启动 Worker：

```bash
npm run dev
```

访问本地地址后：

- 页面直接由 Worker 返回
- 页面里的 API 地址可以留空，默认使用当前域名

## Cloudflare 配置

### 1. 创建 R2 Bucket

在 Cloudflare 后台创建一个名为 `r2drive` 的 R2 Bucket。

如果你想使用其他 bucket 名称，修改 `worker/wrangler.toml`：

```toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "your-bucket-name"
```

### 2. Worker 变量与机密

普通变量：

- `ALLOWED_ORIGIN=https://drive.example.com`
- `MAX_UPLOAD_SIZE=104857600`

机密：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SIGNING_KEY`

说明：

- `ALLOWED_ORIGIN` 填你最终访问前端的域名
- 现在已经是单域名部署，所以通常就是同一个 Worker 自定义域

### 3. 绑定 R2 Bucket

在 Worker 设置中添加 R2 绑定：

- Binding name: `BUCKET`
- Bucket: `r2drive`

### 4. 部署 Worker

```bash
npm run deploy
```

部署后，把你的自定义域名直接绑定到这个 Worker 即可。

## 生产环境推荐配置

如果你的最终域名是：

```text
https://drive.555681.xyz
```

那么 Worker 推荐配置为：

- 自定义域：`drive.555681.xyz`
- `ALLOWED_ORIGIN=https://drive.555681.xyz`

前端页面里：

- 不再需要填写 API 地址
- 直接使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录

## API 概览

### `GET /api/health`

检查 Worker 状态。

### `GET /api/files`

列出文件，需要管理员令牌。

### `POST /api/upload?key=path/to/file.ext`

上传文件内容到指定 key，需要管理员令牌。

### `DELETE /api/files/:key`

删除文件，需要管理员令牌。

### `POST /api/direct-link`

生成签名直链，请求体示例：

```json
{
  "key": "docs/manual.pdf",
  "ttlSeconds": 3600
}
```

## 当前部署结论

这个版本不再要求单独创建 Pages 项目。

你只需要：

1. 一个 Worker 项目
2. 一个绑定到 Worker 的自定义域名
3. 一个 R2 Bucket

适合你当前想要的单项目、单域名部署方式。

# DeepSeek Chat

> 仓库名：`67-CPU-vue-deepseek-chat`

一个基于 **Vue 3 + Vite + Express** 构建的 DeepSeek 流式对话应用。支持实时天气查询、Markdown 渲染、多模型切换、可中断生成等功能，开箱即用，方便持续扩展新功能。

> 本项目仍在持续开发中，欢迎通过 Issue / PR 提出新功能建议。

## ✨ 功能特性

- **流式对话**：基于 SSE（Server-Sent Events）逐字输出，体验接近官方对话界面
- **DeepSeek 接入**：通过后端代理调用 DeepSeek API，密钥不暴露在前端
- **多模型切换**：支持 `DeepSeek-V3`（deepseek-chat）与 `DeepSeek-R1`（deepseek-reasoner）
- **智能天气注入**：当对话包含天气相关关键词时，自动获取实时天气并注入系统提示词
  - 优先从用户输入中识别城市（支持 40+ 国内城市中文名与拼音）
  - 其次使用浏览器地理定位（Open-Meteo 反向地理编码）
  - 最后通过请求 IP 兜底定位（ip-api.com）
  - 数据来源：[wttr.in](https://wttr.in) 免费天气 API
- **Markdown 渲染**：助手回复支持 Markdown 格式展示（`marked`）
- **可中断生成**：对话过程中可随时点击「停止生成」中止请求
- **自定义系统提示词**：可设置 System Prompt 控制助手行为
- **API 状态检测**：启动时自动检查 Key 配置，未配置时页面给出提示

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3（`script setup`）、Vite 8 |
| 后端 | Express 5、Node.js |
| AI | DeepSeek API（通过 `openai` SDK，自定义 `baseURL`） |
| 其他 | `cors`、`dotenv`、`marked`、`concurrently` |

## 📁 项目结构

```
.
├── index.html            # 前端入口
├── server.js             # Express 后端（聊天 / 天气 / 健康检查接口）
├── vite.config.js        # Vite 配置（含 /api 代理到 3001）
├── public/               # 静态资源（favicon 等）
└── src/
    ├── App.vue           # 聊天主界面
    ├── main.js           # Vue 应用入口
    ├── style.css         # 全局样式
    └── components/       # 可复用组件（预留）
```

## 🚀 快速开始

### 前置要求

- Node.js 18+（建议使用最新的 LTS 版本）
- 一个 [DeepSeek API Key](https://platform.deepseek.com/)

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件，填入你的 API Key：

```env
DEEPSEEK_API_KEY=你的_api_key_这里
# 可选：自定义后端端口（默认 3001）
PORT=3001
```

> ⚠️ `.env` 已被 `.gitignore` 忽略，请勿提交密钥。

### 3. 启动开发服务器

```bash
npm run dev
```

该命令会通过 `concurrently` 同时启动后端（:3001）与前端（:5173）：

- 前端访问：http://localhost:5173
- 后端访问：http://localhost:3001

### 4. 生产构建

```bash
# 构建前端静态资源
npm run build

# 本地预览构建产物
npm run preview
```

## 📡 API 说明

所有接口均挂在后端（默认 `http://localhost:3001`）。

### `POST /api/chat`

流式对话接口（SSE）。

请求体：

```json
{
  "messages": [{ "role": "user", "content": "北京今天天气怎么样？" }],
  "model": "deepseek-chat",        // 可选，默认 deepseek-chat
  "max_tokens": 4096,              // 可选
  "system": "你是一个友好的助手",  // 可选，自定义系统提示词
  "userCity": "北京"               // 可选，前端定位到的城市名
}
```

响应（`text/event-stream`，每行一条 `data:` 消息）：

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `weather_status` | `status`, `city` | 天气查询状态：`fetching` / `done` / `failed` |
| `delta` | `text` | 流式输出的增量文本片段 |
| `done` | — | 生成完成 |
| `error` | `message` | 错误信息 |

### `GET /api/health`

健康检查，返回 API Key 是否已配置：

```json
{ "status": "ok", "api_configured": true, "provider": "deepseek" }
```

## 🗺️ 天气功能说明

天气查询触发逻辑：用户最新消息包含天气相关关键词（天气、气温、下雨、紫外线等）时激活。

城市识别优先级：

1. **文本提取** — 直接匹配内置中文城市名
2. **前端定位** — 浏览器 `geolocation` → Open-Meteo 反向编码为中文城市名
3. **IP 兜底** — 依据请求 IP 通过 ip-api.com 定位城市

天气数据由 [wttr.in](https://wttr.in) 提供，免费、无需密钥。

## 🔧 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前端与后端（开发模式） |
| `npm run client` | 仅启动前端（Vite） |
| `npm run server` | 仅启动后端（Express） |
| `npm run build` | 构建前端生产包 |
| `npm run preview` | 预览构建产物 |

## 🤝 贡献与持续更新

本项目计划持续添加新功能。如果你希望参与：

1. Fork 本仓库并创建分支（`git checkout -b feature/your-feature`）
2. 提交改动（`git commit -m "feat: add your feature"`）
3. 推送分支并发起 Pull Request

欢迎在 Issues 中提出 bug 反馈或功能建议。

## 📄 License

本项目仅供学习与交流使用。请遵守 DeepSeek 及第三方 API 的使用条款。

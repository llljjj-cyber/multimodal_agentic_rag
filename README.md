# Meridian · Agentic RAG

个人资料仓库 + 伴读助手。支持文本 / 网页 / PDF·MD·TXT 入库，BGE-M3 向量检索，Google ADK Agent 流式对话。

**线上演示：** [http://8.138.96.81:8080](http://8.138.96.81:8080)  


## 技术栈


| 层     | 技术                                              |
| ----- | ----------------------------------------------- |
| 前端    | React + Vite + TypeScript，Nginx 静态托管            |
| 后端    | FastAPI + Uvicorn，SQLAlchemy async              |
| 数据    | PostgreSQL + pgvector                           |
| RAG   | BGE-M3、父子分块、dense 检索                            |
| Agent | Google ADK + LiteLLM（可接 DeepSeek 等）             |
| 部署    | Docker Compose、GitHub Actions → 阿里云 ECS、GHCR 镜像 |


## 架构

```
浏览器 → Nginx(frontend:8080) → FastAPI(backend:8897)
                              ↘ Postgres(pgvector)
                              ↘ 本机挂载 BGE-M3 模型
```

## 本地启动

### 前置

- Docker + Docker Compose
- 本机已下载 BGE-M3，并在根 `.env` 配置 `BGE_MODEL_PATH_HOST`
- 复制环境变量：

bash
cp .env.example .env
cp backend/.env.example backend/.env

# 编辑上述文件，填入真实密钥与路径



### 启动

bash
docker compose up -d --build


打开：[http://localhost:8080](http://localhost:8080)

### 仅前端开发（可选）

bash
cd frontend && npm ci && npm run dev


后端需已在跑，并配置 `frontend/.env` 的 `VITE_API_URL`。

## 主要功能

- 注册 / 登录（JWT）
- 入库：文本、URL、PDF / Markdown / TXT
- 立体空间 / 资料卡片浏览与阅读
- Meridian 流式对话（检索工具 + LLM）
- 会话与资料删除

## 已知限制

- 单机 CPU 跑 BGE-M3，适合演示与小流量（约 1～3 人）
- 上传 / embedding 较慢；重任务已放入 threadpool，避免整站假死
- 资料重命名等小功能仍可能未全开
- 生产密钥仅放在服务器 `backend/.env`，不入库

## CI/CD

Push 到 `newfrontend` → GitHub Actions 构建镜像推到 GHCR → SSH 到 ECS `docker compose pull && up -d`。
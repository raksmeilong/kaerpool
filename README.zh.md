<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo.svg">
  <img src="brand/logo-light.svg" width="440" alt="kaerpool">
</picture>

**批量 Kaer API 账户 → API 密钥 → 单一 OpenAI 兼容端点 → 9Router。零依赖。**

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?style=flat-square)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#环境要求)
[![9Router](https://img.shields.io/badge/9Router-ready-1d9a63?style=flat-square)](https://9router.com)
[![OpenAI](https://img.shields.io/badge/API-OpenAI--compatible-412991?style=flat-square)](#像-openai-一样使用)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-1f6feb?style=flat-square)](#环境要求)
[![License](https://img.shields.io/badge/license-MIT-e2551f?style=flat-square)](LICENSE)
[![Zero Config](https://img.shields.io/badge/config-env%20only-8957e5?style=flat-square)](#配置)

[English](README.md) · [Indonesia](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

**kaerpool** 把 Kaer API 账户变成可自愈的网关。它用临时邮箱注册账户、验证
邮件中的 6 位验证码、为每个账户签发 `kaer_live_...` 密钥，把这些密钥放进轮询池，
再把整个池注册为 [9Router](https://9router.com) 里的一个供应商。

无需 `npm install`，无需 puppeteer，只需 `node`。

```
 注册 ──► 邮箱 ──► 验证 ──► API 密钥 ──► 池 :8791 ──► 9Router ──► 你的客户端
```

## 为什么

每个新建的 Kaer API 账户都有 **$10 免费额度**。一个账户只是演示，账户池才是
可用的网关：余额耗尽、限流或上游故障时仍能继续工作。kaerpool 帮你处理这些琐事：

- **一条命令** — `kaerpool create 5` 完成五个账户的全流程。
- **真正的 API 密钥，而不是 Cookie** — 网页会话 Cookie 无法调用 `/v1`；
  kaerpool 签发真正可用的 `kaer_live_...` 密钥。
- **自愈账户池** — 轮询、指数退避、故障转移，并在收到 402 时自动剔除空账户。
- **原生支持 9Router** — 创建供应商节点、挂载每个密钥、逐个测试并返回路由密钥。
- **零依赖** — 一个 `node` 可执行文件，约 1.6k 行，MIT 许可。

## 环境要求

- Node.js **18+**（仅使用全局 `fetch` 与 `node:` 模块）。
- 一个 9Router 实例 — 自托管（`PORT=20128`）或托管版。
- 可访问 `api.kaer.ai`、`app.kaer.ai` 与 `api.mail.tm` 的 HTTPS 出网。

## 安装

```bash
git clone https://codeberg.org/0xgetz/kaerpool.git
cd kaerpool
node bin/kaerpool.js --help      # 或：npm link → kaerpool --help
```

## 快速开始

```bash
# 1. 创建账户
kaerpool create 3

# 2. 查看结果
kaerpool list
kaerpool balance

# 3. 启动 OpenAI 兼容适配器
kaerpool serve --port 8791 &

# 4. 注册到 9Router（写入 data/router.json）
kaerpool connect --base http://127.0.0.1:8791/v1 \
                 --router http://127.0.0.1:20128 \
                 --router-password <你的 9Router 密码>

# 5. 端到端验证
kaerpool test --model kaer/janus-1-flash
# ✔ model kaer/janus-1-flash
# → KAER_OK
```

## 像 OpenAI 一样使用

通过 9Router：

```bash
curl http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer $NINE_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kaer/janus-1-flash",
       "messages":[{"role":"user","content":"你好"}]}'
```

或直接连接池适配器：

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8791/v1", api_key="任意")
print(client.chat.completions.create(
    model="kaer/janus-1-pro",
    messages=[{"role": "user", "content": "用一句话解释 SSE"}],
).choices[0].message.content)
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `create [n]` | 创建 n 个账户、签发密钥并自测 |
| `list` | 列出已保存账户 |
| `show <email>` | 查看单个账户详情 |
| `balance` | 查看每个密钥的额度与消耗 |
| `refresh` | 重新检查 `/v1/me`，刷新额度与模型数 |
| `remove <email>` | 从存储中删除账户 |
| `export [--out f]` | 导出存储为 JSON（含密钥） |
| `models` | 从第一个可用密钥列出模型 |
| `chat <prompt>` | 单次对话，`--model` 选择模型 |
| `serve` | 运行 OpenAI 兼容账户池适配器 |
| `connect` | 把账户池和密钥注册到 9Router |
| `test` | 通过 9Router 做端到端测试 |
| `doctor` | 检查邮箱、Kaer、9Router 与存储 |

## 配置

一切都有默认值；可逐次调用或用环境变量覆盖：

| 参数 | 环境变量 | 默认值 |
| --- | --- | --- |
| `--store` | `KAER_STORE` | `./data/accounts.json` |
| `--router` | `NINE_ROUTER_BASE` | `http://127.0.0.1:20128` |
| `--router-password` | `NINE_ROUTER_PASSWORD` | `changeme9router` |
| `--port` | — | `8791` |
| `--prefix` | — | `kaer` |

存储文件以 `0600` 权限写入，始终留在你自己的机器上。

## 工作原理

1. `src/mail.js` 在 mail.tm 上创建临时邮箱。
2. `src/kaer.js` 调用 `/api/apiplat/auth/code`，等待 6 位验证码，再调用
   `/api/apiplat/auth/verify` 获取门户会话 Cookie。
3. 同一个客户端在 `/api/apiplat/keys` 签发 `kaer_live_...` 密钥，并用
   `/v1/me` 验证。
4. `src/store.js` 持久化记录；`src/adapter.js` 轮询密钥；`src/router.js`
   把账户池挂进 9Router。

完整示意图见 [STRUCTURE.md](STRUCTURE.md)。

## 说明

- Kaer 的 $10 启动额度 **每个网络只发放一次**；之后的账户会返回
  `402 insufficient_credits`。`kaerpool balance` 会标出哪些账户有额度，池会
  自动跳过其余账户。
- 一旦达到网络配额，`create` 会立即停止队列，不会继续浪费邮箱。
- 适配器只公布你的密钥真正能访问的模型。

## 测试

```bash
node test/smoke.js
```

七项离线检查：参数解析、存储、池计算与适配器路由。测试不访问网络。

## 许可证

MIT — 见 [LICENSE](LICENSE)。

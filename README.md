<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo.svg">
  <img src="brand/logo-light.svg" width="440" alt="kaerpool">
</picture>

**Bulk Kaer API accounts → API keys → one OpenAI-compatible endpoint → 9Router. Zero dependencies.**

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?style=flat-square)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#requirements)
[![9Router](https://img.shields.io/badge/9Router-ready-1d9a63?style=flat-square)](https://9router.com)
[![OpenAI](https://img.shields.io/badge/API-OpenAI--compatible-412991?style=flat-square)](#use-it-like-openai)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-1f6feb?style=flat-square)](#requirements)
[![License](https://img.shields.io/badge/license-MIT-e2551f?style=flat-square)](LICENSE)
[![Zero Config](https://img.shields.io/badge/config-env%20only-8957e5?style=flat-square)](#configuration)

[English](README.md) · [Indonesia](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

**kaerpool** turns Kaer API accounts into a self-healing gateway. It creates
accounts with a disposable inbox, verifies the emailed code, mints a
`kaer_live_...` key for each one, keeps the keys in a rotation pool and
registers that pool as a single provider inside [9Router](https://9router.com).

No npm install. No puppeteer. Just `node`.

```
 register ──► inbox ──► verify ──► API key ──► pool :8791 ──► 9Router ──► your client
```

## Why

Every new Kaer API account starts with **$10 of free credit**. One account is a
demo; a pool is a usable gateway that survives a drained balance, a 429 or a
dead upstream. kaerpool keeps the bookkeeping out of your way:

- **One command** — `kaerpool create 5` provisions five accounts end to end.
- **Real API keys, not cookies** — the web session cookie cannot call `/v1`;
  kaerpool mints the `kaer_live_...` key that can.
- **Self-healing pool** — round-robin, exponential cooldown, failover, and
  402-aware eviction so an empty balance never stalls a request.
- **9Router native** — creates the provider node, attaches every key as a
  connection, verifies it, and hands you the router key.
- **Zero dependencies** — one `node` binary, ~1.6k lines, MIT.

## Requirements

- Node.js **18+** (uses global `fetch`, `node:` modules only).
- A 9Router instance — self-hosted (`PORT=20128`) or hosted.
- Outbound HTTPS to `api.kaer.ai`, `app.kaer.ai` and `api.mail.tm`.

## Install

```bash
git clone https://codeberg.org/0xgetz/kaerpool.git
cd kaerpool
node bin/kaerpool.js --help      # or: npm link → kaerpool --help
```

## Quickstart

```bash
# 1. accounts (one per call, or many at once)
kaerpool create 3

# 2. see what you have
kaerpool list
kaerpool balance

# 3. serve OpenAI-compatible endpoints
kaerpool serve --port 8791 &

# 4. register it in 9Router (writes data/router.json)
kaerpool connect --base http://127.0.0.1:8791/v1 \
                 --router http://127.0.0.1:20128 \
                 --router-password <your-9router-password>

# 5. prove it end to end
kaerpool test --model kaer/janus-1-flash
# ✔ model kaer/janus-1-flash
# → KAER_OK
```

## Use it like OpenAI

Through 9Router:

```bash
curl http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer $NINE_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kaer/janus-1-flash",
       "messages":[{"role":"user","content":"Hello"}]}'
```

Or straight from the pool adapter:

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8791/v1", api_key="anything")
print(client.chat.completions.create(
    model="kaer/janus-1-pro",
    messages=[{"role": "user", "content": "Explain SSE in one line"}],
).choices[0].message.content)
```

## Commands

| Command | What it does |
| --- | --- |
| `create [n]` | provision n accounts, mint keys, self-test |
| `list` | stored accounts |
| `show <email>` | full record for one account |
| `balance` | live credit and spend for every key |
| `refresh` | re-check `/v1/me`, refresh credit and model counts |
| `remove <email>` | delete an account from the store |
| `export [--out f]` | dump the store to JSON (keys included) |
| `models` | list models from the first healthy key |
| `chat <prompt>` | one-shot chat, `--model` to choose |
| `serve` | run the OpenAI-compatible pool adapter |
| `connect` | register the pool and keys into 9Router |
| `test` | end-to-end check through 9Router |
| `doctor` | sanity-check mail, Kaer, 9Router and the store |

## Available models

38 models, served by `api.kaer.ai` and all paid for by the free credit. Through 9Router or the pool adapter, prefix the id with `kaer/` — e.g. `kaer/janus-1-flash`.

**Kaer**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `janus-1-flash` | Janus 1.0 Flash | 0.25 | 0.5 |
| `janus-1-pro` | Janus 1.0 Pro | 0.26 | 0.78 |
| `kaer-x2` | Kaer-X2 | 0.25 | 0.8 |
| `x1-kaer` | X1-Kaer | 0.1 | 0.4 |

**DeepSeek**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `deepseek-v4-flash` | DeepSeek V4 Flash | 0.4 | 1.6 |
| `deepseek-v4-flash-0731` | DeepSeek V4 Flash (0731 GA) | 0.4 | 1.6 |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 0.4 | 1.6 |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | 0.4 | 1.6 |

**Alibaba / Qwen**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `qwen3.7-flash` | Qwen 3.7 Flash | 0.06 | 0.22 |
| `qwen3.7-plus` | Qwen 3.7 Plus | 0.56 | 2.22 |
| `qwen3.8-flash` | Qwen 3.8 Flash | 0.24 | 0.78 |
| `qwen3.8-max` | Qwen 3.8 Max | 3.3 | 9.92 |
| `qwen-mt-flash` | Qwen MT Flash | 0.22 | 0.56 |
| `qwen-mt-lite` | Qwen MT Lite | 0.18 | 0.46 |
| `qwen-mt-plus` | Qwen MT Plus | 0.52 | 1.56 |
| `qwen3-vl-flash` | Qwen3 VL Flash | 0.1 | 0.8 |
| `qwen3-vl-plus` | Qwen3 VL Plus | 0.3 | 2.88 |

**Zhipu / GLM**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `glm-5-turbo` | GLM 5 Turbo | 2.4 | 8 |
| `glm-5.2` | GLM 5.2 | 2.8 | 8.8 |
| `glm-5.3` | GLM 5.3 | 2.8 | 8.8 |
| `glm-5.3-flash` | GLM 5.3 Flash | 2.8 | 8.8 |

**Moonshot / Kimi**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `kimi-k2.6` | Kimi K2.6 | 0.4 | 1.6 |
| `kimi-k2.7-code` | Kimi K2.7 Code | 0.4 | 1.6 |
| `kimi-k3` | Kimi K3 | 0.4 | 1.6 |
| `kimi-k3.1-pro` | Kimi K3.1 Pro | 2.5 | 12.5 |

**Tencent / Hunyuan**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `hy3` | Hunyuan 3 | 0.4 | 1.6 |
| `hy4-preview` | Hunyuan 4 Preview | 0.4 | 1.6 |
| `hy-mt2-lite` | Hunyuan MT2 Lite | 0.4 | 1.6 |
| `hy-mt2-plus` | Hunyuan MT2 Plus | 0.4 | 1.6 |
| `hy-mt2-pro` | Hunyuan MT2 Pro | 0.4 | 1.6 |

**MiniMax**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `minimax-m3` | MiniMax M3 | 0.6 | 2.4 |

**Meituan / LongCat**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `longcat-2.0` | LongCat 2.0 | 0.6 | 2.4 |

**StepFun**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `step-3.5-flash` | Step 3.5 Flash | 0.13 | 0.39 |
| `step-3.5-flash-2603` | Step 3.5 Flash 2603 | 0.13 | 0.39 |
| `step-3.7-flash` | Step 3.7 Flash | 0.26 | 1.5 |
| `step-5-preview` | Step 5 Preview | 1.3 | 3.51 |

**Poolside / Laguna**

| Model | Label | In $/M | Out $/M |
| --- | --- | ---: | ---: |
| `laguna-s-2.1` | Laguna S 2.1 | 0.5 | 3 |
| `laguna-xs-2.1` | Laguna XS 2.1 | 0.5 | 3 |

> Prices are USD per million tokens, read live from `/v1/models`. The cheapest everyday picks are `step-3.7-flash`, `qwen3.7-flash` and `janus-1-flash`.

## Configuration

Everything runs on defaults; override per call or through env:

| Flag | Env | Default |
| --- | --- | --- |
| `--store` | `KAER_STORE` | `./data/accounts.json` |
| `--router` | `NINE_ROUTER_BASE` | `http://127.0.0.1:20128` |
| `--router-password` | `NINE_ROUTER_PASSWORD` | `changeme9router` |
| `--port` | — | `8791` |
| `--prefix` | — | `kaer` |

The store is written with `0600` permissions and never leaves your machine.

## How it works

1. `src/mail.js` creates a disposable inbox on mail.tm.
2. `src/kaer.js` calls `/api/apiplat/auth/code`, waits for the 6-digit code and
   calls `/api/apiplat/auth/verify`, which sets the portal session cookie.
3. The same client mints a `kaer_live_...` key from `/api/apiplat/keys` and
   checks it against `/v1/me`.
4. `src/store.js` persists the record; `src/adapter.js` rotates keys; and
   `src/router.js` wires the pool into 9Router as one provider.

See [STRUCTURE.md](STRUCTURE.md) for the full diagram.

## Notes

- Kaer awards the $10 starter credit **once per network**; accounts created
  after the limit answer `402 insufficient_credits`. `kaerpool balance` shows
  which accounts have credit, and the pool skips the rest automatically.
- `create` stops the queue as soon as the network quota is hit instead of
  burning mailboxes.
- Only models your key can actually reach are advertised by the adapter.

## Tests

```bash
node test/smoke.js
```

Seven offline checks cover flag parsing, the store, pool maths and the adapter
routes. Nothing in the test suite touches the network.

## License

MIT — see [LICENSE](LICENSE).

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

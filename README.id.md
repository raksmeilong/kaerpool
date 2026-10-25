<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo.svg">
  <img src="brand/logo-light.svg" width="440" alt="kaerpool">
</picture>

**Akun Kaer API massal → API key → satu endpoint OpenAI-compatible → 9Router. Tanpa dependensi.**

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?style=flat-square)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#kebutuhan)
[![9Router](https://img.shields.io/badge/9Router-ready-1d9a63?style=flat-square)](https://9router.com)
[![OpenAI](https://img.shields.io/badge/API-OpenAI--compatible-412991?style=flat-square)](#pakai-seperti-openai)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-1f6feb?style=flat-square)](#kebutuhan)
[![License](https://img.shields.io/badge/license-MIT-e2551f?style=flat-square)](LICENSE)
[![Zero Config](https://img.shields.io/badge/config-env%20only-8957e5?style=flat-square)](#konfigurasi)

[English](README.md) · [Indonesia](README.id.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md)

</div>

---

**kaerpool** mengubah akun Kaer API menjadi gateway yang bisa pulih sendiri.
Script membuat akun dengan inbox sementara, memverifikasi kode dari email,
menerbitkan API key `kaer_live_...` untuk setiap akun, menyimpannya dalam pool
rotasi, lalu mendaftarkan pool itu sebagai satu provider di
[9Router](https://9router.com).

Tanpa `npm install`. Tanpa puppeteer. Cukup `node`.

```
 daftar ──► inbox ──► verifikasi ──► API key ──► pool :8791 ──► 9Router ──► client kamu
```

## Kenapa

Setiap akun Kaer API baru mendapat **kredit gratis $10**. Satu akun hanya demo;
pool baru berguna: tahan terhadap saldo habis, rate limit, dan upstream mati.
kaerpool mengurus pembukuannya untuk Anda:

- **Satu perintah** — `kaerpool create 5` membuat lima akun sampai selesai.
- **API key asli, bukan cookie** — cookie sesi web tidak bisa memanggil `/v1`;
  kaerpool menerbitkan key `kaer_live_...` yang memang bisa.
- **Pool self-healing** — round-robin, cooldown eksponensial, failover, dan
  evakuasi otomatis saat saldo 402 agar request tidak macet.
- **Native 9Router** — membuat provider node, memasang setiap key sebagai
  connection, mengujinya, lalu memberi Anda router key.
- **Tanpa dependensi** — satu binary `node`, ~1.6k baris, lisensi MIT.

## Kebutuhan

- Node.js **18+** (memakai `fetch` global dan modul `node:` saja).
- Instance 9Router — self-hosted (`PORT=20128`) atau hosted.
- Akses HTTPS keluar ke `api.kaer.ai`, `app.kaer.ai` dan `api.mail.tm`.

## Instalasi

```bash
git clone https://codeberg.org/0xgetz/kaerpool.git
cd kaerpool
node bin/kaerpool.js --help      # atau: npm link → kaerpool --help
```

## Mulai cepat

```bash
# 1. buat akun
kaerpool create 3

# 2. lihat hasilnya
kaerpool list
kaerpool balance

# 3. jalankan adapter OpenAI-compatible
kaerpool serve --port 8791 &

# 4. daftarkan ke 9Router (menulis data/router.json)
kaerpool connect --base http://127.0.0.1:8791/v1 \
                 --router http://127.0.0.1:20128 \
                 --router-password <password-9router-anda>

# 5. buktikan end to end
kaerpool test --model kaer/janus-1-flash
# ✔ model kaer/janus-1-flash
# → KAER_OK
```

## Pakai seperti OpenAI

Lewat 9Router:

```bash
curl http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer $NINE_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kaer/janus-1-flash",
       "messages":[{"role":"user","content":"Halo"}]}'
```

Atau langsung ke adapter pool:

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8791/v1", api_key="terserah")
print(client.chat.completions.create(
    model="kaer/janus-1-pro",
    messages=[{"role": "user", "content": "Jelaskan SSE dalam satu baris"}],
).choices[0].message.content)
```

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `create [n]` | buat n akun, terbitkan key, uji sendiri |
| `list` | daftar akun tersimpan |
| `show <email>` | detail satu akun |
| `balance` | kredit dan pemakaian setiap key |
| `refresh` | cek ulang `/v1/me`, segarkan kredit dan jumlah model |
| `remove <email>` | hapus akun dari store |
| `export [--out f]` | ekspor store ke JSON (termasuk key) |
| `models` | daftar model dari key pertama yang sehat |
| `chat <prompt>` | chat sekali jalan, `--model` untuk memilih model |
| `serve` | jalankan adapter pool OpenAI-compatible |
| `connect` | daftarkan pool dan key ke 9Router |
| `test` | uji end-to-end lewat 9Router |
| `doctor` | periksa mail, Kaer, 9Router dan store |

## Konfigurasi

Semua sudah punya default; ubah per panggilan atau lewat env:

| Flag | Env | Default |
| --- | --- | --- |
| `--store` | `KAER_STORE` | `./data/accounts.json` |
| `--router` | `NINE_ROUTER_BASE` | `http://127.0.0.1:20128` |
| `--router-password` | `NINE_ROUTER_PASSWORD` | `changeme9router` |
| `--port` | — | `8791` |
| `--prefix` | — | `kaer` |

File store ditulis dengan izin `0600` dan tidak pernah meninggalkan mesin Anda.

## Cara kerja

1. `src/mail.js` membuat inbox sementara di mail.tm.
2. `src/kaer.js` memanggil `/api/apiplat/auth/code`, menunggu kode 6 digit, lalu
   `/api/apiplat/auth/verify` yang menyetel cookie sesi portal.
3. Client yang sama menerbitkan key `kaer_live_...` dari `/api/apiplat/keys` dan
   mengujinya ke `/v1/me`.
4. `src/store.js` menyimpan catatan; `src/adapter.js` merotasi key; dan
   `src/router.js` memasang pool ke 9Router sebagai satu provider.

Diagram lengkap ada di [STRUCTURE.md](STRUCTURE.md).

## Catatan

- Kaer memberi kredit awal $10 **sekali per jaringan**; akun berikutnya menjawab
  `402 insufficient_credits`. `kaerpool balance` menunjukkan akun mana yang
  punya kredit, dan pool otomatis melewati yang kosong.
- `create` menghentikan antrean begitu kuota jaringan tercapai, bukan
  menghabiskan mailbox.
- Hanya model yang benar-benar bisa diakses key Anda yang diiklankan adapter.

## Tes

```bash
node test/smoke.js
```

Tujuh pemeriksaan offline untuk parsing flag, store, logika pool dan route
adapter. Tidak ada tes yang menyentuh jaringan.

## Lisensi

MIT — lihat [LICENSE](LICENSE).

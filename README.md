# crypton

> **Token-rotation digital document security.** Protect documents not with crackable encryption, but with a server-controlled **rotating token** required to open them — so only one valid copy can be viewed at any moment, and uncontrolled redistribution is neutralized.

Implements KR patent application **2024-0302KR** — *디지털 도큐먼트 보안 서비스 제공 방법 및 이를 위한 서버* (Method for providing digital document security service and server for the same). Inventors **위관우 · 류지성**. Filed **2024-06-24**, 10 claims.

## The core idea (from the patent)
- Each document carries an **immutable unique value (고유값, a hash)** + a **token**.
- On **every open attempt**, the **viewer** sends the current token to the **security server**; the server authenticates it, then **issues a new token and invalidates the old one** (rotation), and returns a *view-start* command.
- Because only **one live token** exists per document at a time: if a holder shares the file and the recipient opens it, the recipient's open **rotates the token**, and the original holder's now-stale token **fails to authenticate**. → Redistribution *transfers* access instead of multiplying it.
- No heavy DRM needed · works **offline** after a token update · supports a **payment/marketplace (전자서점)** model and **cloud single-session** use.

📄 **개발 기획안 → [`docs/기획안.md`](docs/기획안.md)**  ·  특허 요약 → [`docs/특허-요약.md`](docs/특허-요약.md)

## Layout (monorepo)
```
crypton/
  packages/
    server/     # security server — token authority, auth, rotation, payment, notify
    viewer/     # custom viewer — token protocol on open; renders only on view-start
    platform/   # 전자서점 — web/app marketplace (list, buy, download)
    core/       # shared — token model, crypto, document container, types
  docs/         # 기획안, 특허 요약
```

## Honest scope (threat model)
crypton controls **authorized viewing and redistribution** — a large step up from PDF passwords (which fail permanently once cracked). It is **not** absolute anti-copy DRM: a determined viewer can still screen-capture rendered content. Mitigations (per-user watermark, hardened viewer) raise the bar but do not make it impossible. See [`docs/기획안.md`](docs/기획안.md) §6.

## Status
Planning / scaffold. Architecture, stack, threat model, and roadmap in `docs/기획안.md`.

---
*Patent pending (KR 2024-0302KR). All rights reserved.*

# @crypton/viewer — 전용 뷰어

Enforces the token protocol (claims 1·4). On an open attempt it sends the current token to the server via API, and **renders only after** receiving a *view-start command + new token*, then updates the embedded token. Opens `.crypton` containers **only**.

**Targets:** desktop = **Electron + PDF.js** · mobile = **React Native**. (Web/PDF.js possible but weakest protection.)

⚠️ **Trust boundary** — the viewer is thin-trust; all authorization is server-side. A determined user can still screen-capture. Add per-user **forensic watermarking** (P2) and consider a hardened native viewer for high-security tiers. See `../../docs/기획안.md` §6.

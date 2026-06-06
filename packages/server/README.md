# @crypton/server — 보안 서비스 제공 서버

The **authority** (patent claims 8–10). Per document, holds an immutable **고유값(hash)** + the **current valid token**; authenticates tokens on open and **rotates** them atomically (single-live-token).

**Responsibilities**
- **Token Authority** — issue / authenticate / **rotate** (atomic CAS via Redis lock or Postgres conditional `UPDATE ... WHERE current_token_id = $expected`).
- **Entitlement & payment gate** (claim 3).
- **Notify** displaced holders (websocket/push) — 도4 / 【0085】.
- **Audit log** (`token_log`) for forensics.

**Stack:** TypeScript (Bun/Node) + Fastify · Postgres · Redis. See `../../docs/기획안.md` §4–5.

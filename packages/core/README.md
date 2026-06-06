# @crypton/core — shared contract

The interoperability contract used by **server**, **viewer**, and **platform**:

- **Token model & signing** — structure (`doc`/`tid`/`iat`/`exp`/`perm`/`sid`/`sig`), Ed25519/HMAC-SHA256 keyed by the **고유값(hash)** for integrity & origin (【0061】·【0062】).
- **`.crypton` container format** — AES-256-GCM payload + manifest (고유값 · token slot · server endpoint).
- **API types** — request/response schemas (Zod).

Keeping this as the single contract lets server/viewer/platform evolve (even across languages) without breaking interop. See `../../docs/기획안.md` §4·§7.

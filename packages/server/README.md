# @crypton/server — 보안 서버

문서 접근 권한의 **단일 출처(authority)**. 문서마다 불변 **고유값(해시)** 과 **현재 유효 토큰**을 보관하고, 열람 시 토큰을 인증한 뒤 **원자적으로 회전**시킵니다(단일 유효 토큰 불변식).

**역할**
- **토큰 권한(Token Authority)** — 발급 / 인증 / **회전**(Redis 락 또는 Postgres 조건부 `UPDATE ... WHERE current_token_id = $expected` 로 원자적 CAS).
- **권한·결제 게이트** — 결제 완료가 다운로드의 선행조건.
- **변위 보유자 알림**(websocket/push).
- **감사 로그**(`token_log`) — 포렌식용.

**스택:** TypeScript (Bun/Node) + Fastify · (어댑터로) Postgres · Redis. `../../docs/기획안.md` §4–5 참고.

## 구현
- `src/authority.ts` — `issueCopy`(제1토큰 발급) · `open`(인증 + **원자적 회전**)
- `src/store/` — `Store` 인터페이스 + `MemoryStore`(compare-and-swap로 단일유효 보장). Postgres/Redis 어댑터가 동일 인터페이스를 구현
- `src/app.ts` — Fastify 라우트: `/titles` · `/purchase` · `/download` · `/open` · `/audit` · `/notify`(WS)
- 실행: `npm run dev:server` · 라이브러리: `import { buildApp } from '@crypton/server'` · 테스트: `test/e2e.test.ts`

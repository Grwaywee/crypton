# @crypton/core — 공유 계약(contract)

**server**, **viewer**, **platform** 이 공유하는 상호운용 계약:

- **토큰 모델·서명** — 구조(`doc`/`tid`/`iat`/`exp`/`perm`/`sid`/`sig`), 무결성·출처를 위해 **고유값(해시)** 을 키로 한 Ed25519/HMAC-SHA256.
- **`.crypton` 컨테이너 포맷** — AES-256-GCM 페이로드 + 매니페스트(고유값 · 토큰 슬롯 · 서버 엔드포인트).
- **API 타입** — 요청/응답 스키마(Zod).

이 계약을 단일 기준으로 유지하면 server/viewer/platform 이 (언어가 달라도) 상호운용을 깨지 않고 발전할 수 있습니다. `../../docs/기획안.md` §4·§7 참고.

## 구현
- `src/crypto.ts` — 고유값(SHA-256), 문서별 서명키 유도(HMAC), AES-256-GCM, uuidv7
- `src/token.ts` — 토큰 모델·정규화 서명·검증·발급(매 발급마다 새 `tid`)
- `src/container.ts` — `.crypton` 빌드/파싱/복호화(고유값 무결성 검증) + 회전 토큰 슬롯 교체
- `src/api.ts` — 요청/응답 Zod 스키마. 테스트: `test/`

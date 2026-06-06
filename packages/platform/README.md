# @crypton/platform — 전자서점 (PF)

문서를 등록·구매·다운로드하는 웹/앱 마켓플레이스(문서 = 도서). **결제가 다운로드의 선행조건**입니다. 감사 로그 기반 열람 통계를 제공하는 출판사 대시보드(P2).

**스택:** Fastify(정적 서빙 + API 포워딩) + 바닐라 SPA. (확장 시 Next.js / React로 대체 가능.)

## 구현
- `src/app.ts` — `buildPlatform()`: SPA 정적 서빙 + `/api/*` → 보안 서버 포워딩(브라우저는 동일 출처라 CORS 불필요)
- `public/` — 마켓플레이스 SPA. 발행·구매·다운로드 + **브라우저 내 WebCrypto(AES-GCM) 복호화** 웹 뷰어(보호는 가장 약함) + 토큰 회전 시각화
- 실행: `npm run dev:platform` (`CRYPTON_SERVER_URL`로 보안 서버 지정). 테스트: `test/platform.test.ts`

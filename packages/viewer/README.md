# @crypton/viewer — 전용 뷰어

토큰 프로토콜을 강제합니다. 열람을 시도하면 현재 토큰을 API로 서버에 전송하고, *열람 개시 명령 + 새 토큰* 을 받은 **뒤에만 렌더**한 다음 내장 토큰을 갱신합니다. `.crypton` 컨테이너만 엽니다.

**타깃:** 데스크톱 = **Electron + PDF.js** · 모바일 = **React Native**. (웹/PDF.js도 가능하나 보호가 가장 약함.)

⚠️ **신뢰 경계** — 뷰어는 *얇은 신뢰*이고, 모든 권한 판단은 서버에서 이뤄집니다. 작정한 사용자는 화면을 캡처할 수 있으므로, 사용자별 **포렌식 워터마크**(P2)를 더하고 고보안 등급에는 하드닝된 네이티브 뷰어를 고려하세요. `../../docs/기획안.md` §6 참고.

## 구현
- `src/protocol.ts` — `ViewerClient.open()`: 토큰 전송 → 열람 개시 수신 → 복호화 → 내장 토큰 회전. 오프라인 유예(`openOffline`)와 CEK 캐시
- `src/cache.ts` — 오프라인 유예용 파일 CEK 캐시(운영 시 OS 키스토어 래핑 권장)
- `src/cli.ts` — `tsx src/cli.ts open <file.crypton> [--out <out>]` (헤드리스 데모 뷰어)
- 데스크톱(Electron+PDF.js)·모바일(RN) 셸은 이 클라이언트를 감싸는 형태(차기). 테스트: `test/protocol.test.ts`

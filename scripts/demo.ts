/**
 * End-to-end demo: register → publish → purchase → open (rotate) → share → re-open
 * transfers access. Runs the security server in-process and drives it with the real
 * ViewerClient.
 *
 *   npm run demo
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { parseContainer, serializeContainer, type CryptonContainer } from '@crypton/core';
import { buildApp } from '@crypton/server';
import { ViewerClient } from '@crypton/viewer';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const line = (s = ''): void => console.log(s);
const ok = (s: string): void => console.log(`  \x1b[32m✓${RESET} ${s}`);
const no = (s: string): void => console.log(`  \x1b[31m✗${RESET} ${s}`);
const step = (s: string): void => console.log(`\n\x1b[1m${s}${RESET}`);
const short = (s: string): string => `${s.slice(0, 8)}…${s.slice(-4)}`;

async function api(base: string, path: string, body?: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

/** Simulate writing the .crypton file out and reading it back (a real on-disk copy). */
function asFile(container: CryptonContainer): CryptonContainer {
  return parseContainer(serializeContainer(container));
}

async function main(): Promise<void> {
  const app = await buildApp({
    config: {
      masterSecret: randomBytes(32),
      tokenTtlSeconds: 3600,
      serverUrl: 'http://placeholder',
      jwtSecret: randomBytes(32).toString('hex'),
      jwtExpiresIn: '1h',
      corsOrigins: [],
    },
    rateLimit: false,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  line(`${DIM}── crypton end-to-end demo ──────────────────────────────${RESET}`);

  step('① 출판사 회원가입 + 문서 등록');
  const pub = (await api(base, '/auth/register', { email: 'press@acme.com', password: 'password123' })).body;
  const content = Buffer.from('CONFIDENTIAL — Q3 go-to-market strategy.\n재배포 금지.', 'utf8');
  const { doc } = (
    await api(base, '/titles', { title: 'Q3 Strategy', contentBase64: content.toString('base64'), priceCents: 2900 }, pub.token)
  ).body;
  ok(`출판사 인증 + 등록 — 고유값(doc) ${short(doc)}`);

  step('② Alice 회원가입 → 구매(선행조건) → 다운로드');
  const alice = (await api(base, '/auth/register', { email: 'alice@x.com', password: 'password123' })).body;
  const denied = await api(base, '/download', { doc }, alice.token); // before purchase
  ok(`구매 전 다운로드 → HTTP ${denied.status} (거부)`);
  await api(base, '/purchase', { doc }, alice.token);
  const dl = (await api(base, '/download', { doc }, alice.token)).body;
  let aliceFile = asFile(dl.container);
  ok(`다운로드 — copy ${short(aliceFile.manifest.copyId)}, 토큰 T1 ${short(aliceFile.manifest.token.tid)}`);

  step('③ Alice가 문서를 엶 → 열람 개시 + 토큰 회전 (T1→T2)');
  const a1 = await new ViewerClient().open(aliceFile, { serverBase: base });
  if (a1.ok && a1.container) {
    aliceFile = a1.container;
    ok(`VIEW GRANTED — 새 토큰 T2 ${short(aliceFile.manifest.token.tid)}`);
    ok(`복호화: "${a1.content?.toString('utf8').split('\n')[0]}"`);
  } else {
    no(`거부: ${a1.reason}`);
  }

  step('④ Alice가 그 .crypton 파일을 Bob에게 공유 (Bob은 계정 없음 — 토큰이 곧 자격증명)');
  let bobFile = asFile(aliceFile);
  ok('Bob이 동일 파일(토큰 T2 내장)을 수신');

  step('⑤ Bob이 문서를 엶 → 계정 없이도 인증 성공, 토큰 회전 (T2→T3)');
  const b1 = await new ViewerClient().open(bobFile, { serverBase: base });
  if (b1.ok && b1.container) {
    bobFile = b1.container;
    ok(`VIEW GRANTED — Bob이 라이브 보유자, 새 토큰 T3 ${short(bobFile.manifest.token.tid)}`);
  } else {
    no(`거부: ${b1.reason}`);
  }

  step('⑥ Alice가 다시 엶 → 보유 토큰 T2는 이미 무효');
  const a2 = await new ViewerClient().open(aliceFile, { serverBase: base });
  if (!a2.ok) ok(`VIEW DENIED (예상된 동작): ${a2.reason} — 재배포가 접근을 복제가 아닌 이전`);
  else no('Alice가 여전히 열림 (예상과 다름!)');

  step('⑦ Bob은 계속 열람 가능 — 한 시점에 유효 토큰은 하나');
  const b2 = await new ViewerClient().open(bobFile, { serverBase: base });
  if (b2.ok) ok('VIEW GRANTED');
  else no(`거부: ${b2.reason}`);

  step('⑧ 감사 로그 (소유자 Alice의 토큰으로 조회)');
  const log = (await api(base, `/audit/copy/${aliceFile.manifest.copyId}`, undefined, alice.token)).body;
  for (const e of log) {
    line(`   ${DIM}${new Date(e.at).toISOString()}${RESET}  ${String(e.event).padEnd(7)} ${short(e.tokenId)}  ${e.detail ?? ''}`);
  }

  line(`\n${DIM}─────────────────────────────────────────────────────────${RESET}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

'use strict';

const $ = (id) => document.getElementById(id);
const LIB_KEY = 'crypton.library';
const TOKEN_KEY = 'crypton.token';
const USER_KEY = 'crypton.user';

// --- auth state ------------------------------------------------------------
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  renderAuth();
}
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  renderAuth();
}
function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveLibrary(lib) {
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
}

function log(msg, cls) {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $('log').prepend(el);
}

async function api(path, body) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

function requireLogin() {
  if (getToken()) return true;
  log('로그인이 필요합니다', 'bad');
  return false;
}

// --- base64 + WebCrypto AES-256-GCM (the in-browser "web viewer") ----------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function decryptPayload(container, cekB64) {
  const key = await crypto.subtle.importKey('raw', b64ToBytes(cekB64), { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const iv = b64ToBytes(container.manifest.enc.iv);
  const ct = b64ToBytes(container.ciphertext);
  const tag = b64ToBytes(container.manifest.enc.authTag);
  const data = new Uint8Array(ct.length + tag.length);
  data.set(ct, 0);
  data.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}

const short = (s) => (s ? `${String(s).slice(0, 8)}…${String(s).slice(-4)}` : '');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// --- auth actions ----------------------------------------------------------
async function register() {
  const { status, json } = await api('/api/auth/register', {
    email: $('email').value.trim(),
    password: $('password').value,
  });
  if (status === 201) {
    setAuth(json.token, json.user);
    log(`회원가입 + 로그인: ${json.user.email}`, 'ok');
  } else {
    log(`회원가입 실패 (${status}: ${json.error || ''})`, 'bad');
  }
}
async function login() {
  const { status, json } = await api('/api/auth/login', {
    email: $('email').value.trim(),
    password: $('password').value,
  });
  if (status === 200) {
    setAuth(json.token, json.user);
    log(`로그인: ${json.user.email}`, 'ok');
  } else {
    log(`로그인 실패 (${status}: ${json.error || ''})`, 'bad');
  }
}
function renderAuth() {
  const u = currentUser();
  const loggedIn = Boolean(u && getToken());
  $('whoami').textContent = loggedIn ? `로그인됨: ${u.email}` : '';
  $('logoutBtn').style.display = loggedIn ? '' : 'none';
  $('loginBtn').style.display = loggedIn ? 'none' : '';
  $('registerBtn').style.display = loggedIn ? 'none' : '';
  $('email').disabled = loggedIn;
  $('password').disabled = loggedIn;
}

// --- catalog ---------------------------------------------------------------
async function refreshCatalog() {
  const { json } = await api('/api/titles');
  const box = $('catalog');
  box.innerHTML = '';
  if (!Array.isArray(json) || json.length === 0) {
    box.innerHTML = '<div class="muted">아직 등록된 문서가 없습니다.</div>';
    return;
  }
  for (const t of json) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="meta">
        <span class="title">${escapeHtml(t.title)}</span>
        <span class="sub">doc ${short(t.doc)} · ${t.priceCents}c</span>
      </div>
      <div class="actions">
        <button data-buy="${t.doc}">구매</button>
        <button class="primary" data-dl="${t.doc}">다운로드</button>
      </div>`;
    box.appendChild(card);
  }
}

async function buy(doc) {
  if (!requireLogin()) return;
  const { status } = await api('/api/purchase', { doc });
  if (status === 201) log(`구매 완료 — ${short(doc)}`, 'ok');
  else log(`구매 실패 (${status})`, 'bad');
}

async function download(doc) {
  if (!requireLogin()) return;
  const { status, json } = await api('/api/download', { doc });
  if (status !== 200) {
    log(`다운로드 거부 (${status}) — 먼저 구매하세요`, 'bad');
    return;
  }
  const lib = loadLibrary();
  lib.push({ container: json.container });
  saveLibrary(lib);
  log(`다운로드 — copy ${short(json.container.manifest.copyId)}`, 'ok');
  renderLibrary();
}

// --- library + viewer ------------------------------------------------------
function renderLibrary() {
  const lib = loadLibrary();
  const box = $('library');
  box.innerHTML = '';
  if (lib.length === 0) {
    box.innerHTML = '<div class="muted">다운로드한 카피가 없습니다.</div>';
    return;
  }
  lib.forEach((item, idx) => {
    const m = item.container.manifest;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="meta">
        <span class="title">${escapeHtml(m.title)}</span>
        <span class="sub">copy ${short(m.copyId)} · 토큰 ${short(m.token.tid)}</span>
      </div>
      <div class="actions">
        <button class="primary" data-open="${idx}">열기</button>
        <button data-export="${idx}">.crypton 내보내기</button>
        <button data-remove="${idx}">삭제</button>
      </div>`;
    box.appendChild(card);
  });
}

async function openCopy(idx) {
  const lib = loadLibrary();
  const item = lib[idx];
  if (!item) return;
  const before = item.container.manifest.token.tid;
  // /open is authenticated by the rotating copy token, not the user session.
  const { status, json } = await api('/api/open', {
    copyId: item.container.manifest.copyId,
    token: item.container.manifest.token,
  });
  if (status !== 200 || !json.viewStart) {
    $('viewer').innerHTML = `<span class="badge bad">VIEW DENIED</span>  ${json.reason || status}`;
    log(`열람 거부 — ${json.reason || status} (토큰 ${short(before)} 무효)`, 'bad');
    return;
  }
  let text;
  try {
    text = await decryptPayload(item.container, json.cek);
  } catch (e) {
    $('viewer').innerHTML = `<span class="badge bad">DECRYPT FAILED</span>`;
    log(`복호화 실패: ${e}`, 'bad');
    return;
  }
  item.container.manifest.token = json.token; // rotate forward (S390)
  saveLibrary(lib);
  $('viewer').innerHTML =
    `<span class="badge ok">VIEW GRANTED</span>  토큰 회전 ${short(before)} → ${short(json.token.tid)}\n\n` +
    escapeHtml(text);
  log(`열람 성공 — 토큰 회전 ${short(before)} → ${short(json.token.tid)}`, 'ok');
  renderLibrary();
}

function exportCopy(idx) {
  const lib = loadLibrary();
  const item = lib[idx];
  if (!item) return;
  const blob = new Blob([JSON.stringify(item.container, null, 2)], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${item.container.manifest.title}.crypton`;
  a.click();
  URL.revokeObjectURL(a.href);
  log('카피를 .crypton 파일로 내보냄 — 다른 기기에서 열면 토큰이 이전됩니다', 'ok');
}

function removeCopy(idx) {
  const lib = loadLibrary();
  lib.splice(idx, 1);
  saveLibrary(lib);
  renderLibrary();
}

// --- wiring ----------------------------------------------------------------
$('registerBtn').addEventListener('click', register);
$('loginBtn').addEventListener('click', login);
$('logoutBtn').addEventListener('click', () => {
  clearAuth();
  log('로그아웃', 'ok');
});

$('publishForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireLogin()) return;
  const content = $('pubContent').value;
  const contentBase64 = btoa(unescape(encodeURIComponent(content)));
  const { status, json } = await api('/api/titles', {
    title: $('pubTitle').value,
    contentBase64,
    priceCents: Number($('pubPrice').value) || 0,
  });
  if (status === 201) {
    log(`문서 등록 — doc ${short(json.doc)}`, 'ok');
    refreshCatalog();
  } else {
    log(`등록 실패 (${status})`, 'bad');
  }
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.buy) buy(t.dataset.buy);
  else if (t.dataset.dl) download(t.dataset.dl);
  else if (t.dataset.open) openCopy(Number(t.dataset.open));
  else if (t.dataset.export) exportCopy(Number(t.dataset.export));
  else if (t.dataset.remove) removeCopy(Number(t.dataset.remove));
});

renderAuth();
refreshCatalog();
renderLibrary();

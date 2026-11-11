import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseAnswers, verdict, DEFAULTS, CATS, MAX_TEXT } from '../jev.js';

const body = (a, d, q) => ({ model: 'jev-latest', answers: {
  attack: { type: 'noul', noul: a }, divisive: { type: 'noul', noul: d }, quarrel: { type: 'noul', noul: q },
}, usage: { input_tokens: 100, output_tokens: 3 } });

test('要求は公式の形 (model/state/questions, 全部 noul)', () => {
  const r = buildRequest('x'.repeat(5000), 'jev-latest');
  assert.deepEqual(Object.keys(r).sort(), ['model', 'questions', 'state']);
  assert.equal(r.state.length, MAX_TEXT);
  assert.deepEqual(Object.keys(r.questions), CATS);
  for (const c of CATS) {
    assert.equal(r.questions[c].type, 'noul');
    assert.deepEqual(Object.keys(r.questions[c].criteria).sort(), ['false', 'true']);
  }
});

test('答えの読み取りと判定', () => {
  const s = parseAnswers(body(0.9, 0.2, 0.1));
  assert.deepEqual(s, { attack: 0.9, divisive: 0.2, quarrel: 0.1 });
  assert.deepEqual(verdict(s, DEFAULTS), { hide: true, top: 'attack', score: 0.9 });
  assert.equal(verdict(s, { ...DEFAULTS, cats: { ...DEFAULTS.cats, attack: false } }).hide, false);
  assert.equal(verdict(s, { ...DEFAULTS, threshold: 0.95 }).hide, false);
  assert.equal(verdict(parseAnswers(body(0.7, 0, 0)), DEFAULTS).hide, true); // ちょうどしきい値
});

test('形の違う応答は例外（黙って 0 点にしない）', () => {
  assert.throws(() => parseAnswers({}));
  assert.throws(() => parseAnswers(body(1.2, 0, 0)));
  assert.throws(() => parseAnswers(body('0.9', 0, 0)));
  const b = body(0.1, 0.1, 0.1); delete b.answers.quarrel;
  assert.throws(() => parseAnswers(b));
  const c = body(0.1, 0.1, 0.1); c.answers.attack.type = 'choice';
  assert.throws(() => parseAnswers(c));
});

// ---- 経路の切り替えと、中継のエラー → 表示・休止 ----
import { routeOf, buildFetch, relayFailure, nextRelayDay, budgetOf, newInstallId, RELAY, RELAY_JUDGE, ENDPOINT } from '../jev.js';

test('キーなしは中継、キーありは直接 TypeSafe', () => {
  assert.equal(routeOf(''), 'relay');
  assert.equal(routeOf('sk-x'), 'direct');
  const id = newInstallId();
  assert.match(id, /^[0-9a-f]{32}$/);
  const r = buildFetch('こんにちは', { apiKey: '', model: 'jev-latest', installId: id });
  assert.equal(r.url, RELAY_JUDGE);
  assert.ok(r.url.startsWith(RELAY + '/'));
  assert.deepEqual(Object.keys(r.init.headers).sort(), ['Content-Type', 'X-Install-Id']); // キーも Authorization も付けない
  assert.deepEqual(JSON.parse(r.init.body), { text: 'こんにちは' }); // 送るのは文だけ（質問文・モデル・URL は送らない）
  assert.equal(r.init.credentials, 'omit');
  assert.equal(r.init.referrerPolicy, 'no-referrer');
  const d = buildFetch('こんにちは', { apiKey: 'sk-x', model: 'jev-1.14.0', installId: id });
  assert.equal(d.url, ENDPOINT);
  assert.equal(d.init.headers.Authorization, 'Bearer sk-x');
  assert.equal(d.init.headers['X-Install-Id'], undefined); // 直接のときは ID を送らない
  assert.deepEqual(Object.keys(JSON.parse(d.init.body)).sort(), ['model', 'questions', 'state']);
  assert.equal(d.init.credentials, 'omit');
});

test('中継へ送る文は 3000 字まで', () => {
  const r = buildFetch('あ'.repeat(5000), { apiKey: '', model: 'm', installId: 'a'.repeat(32) });
  assert.equal(JSON.parse(r.init.body).text.length, MAX_TEXT);
});

test('中継のエラーコード → 文言と休み方', () => {
  const now = Date.UTC(2026, 10, 11, 3, 0, 0); // 日本時間 12:00
  const untilReset = Date.UTC(2026, 10, 12, 0, 0, 5) - now; // 次の日本時間 9:00
  assert.equal(nextRelayDay(now), Date.UTC(2026, 10, 12, 0, 0, 5));
  for (const c of ['free_tier_ended', 'free_tier_unavailable']) {
    const f = relayFailure(c, 503, now);
    assert.ok(f.pause >= 10 * 60e3, c); // 10 分以上は叩かない
    assert.equal(f.retry, false);
    assert.match(f.msg, /無料枠/); assert.match(f.msg, /API キーを設定/);
  }
  for (const c of ['user_limit', 'ip_limit', 'ip_ids']) {
    const f = relayFailure(c, 429, now);
    assert.equal(f.pause, 60 * 60e3, c); // 戻るまで 1 時間ごとに 1 回だけ確かめる（時計のずれで丸 1 日休まない）
    assert.equal(relayFailure(c, 429, Date.UTC(2026, 10, 11, 23, 50, 0)).pause, 10 * 60e3 + 5000);
    assert.equal(f.retry, false); // 429 でも聞き直さない
    assert.match(f.msg, /午前 9 時/);
  }
  assert.equal(relayFailure('upstream_error', 502, now).retry, true);
  assert.equal(relayFailure('upstream_error', 429, now).retry, true);
  assert.equal(relayFailure('upstream_unreachable', 504, now).retry, true);
  assert.deepEqual([relayFailure('bad_request', 400, now).retry, relayFailure('bad_request', 400, now).pause], [false, 0]);
  assert.ok(relayFailure('forbidden', 403, now).pause >= 10 * 60e3);
  assert.equal(relayFailure('', 500, now).retry, true); // 知らない形の 5xx は通常の聞き直し
  assert.equal(relayFailure('something_new', 418, now).retry, false);
  for (const c of ['free_tier_ended', 'free_tier_unavailable', 'user_limit', 'ip_limit', 'ip_ids', 'forbidden', 'bad_request', 'upstream_error', 'upstream_unreachable', 'x']) {
    assert.ok(relayFailure(c, 500, now).msg.length > 5);
  }
});

test('無料枠の残りはヘッダから', () => {
  const h = (o) => new Headers(o);
  assert.equal(budgetOf(h({ 'x-budget-left-usd': '0.0250', 'x-budget-total-usd': '0.1' })), 0.25);
  assert.equal(budgetOf(h({ 'x-budget-left-usd': '0.0000', 'x-budget-total-usd': '0.1' })), 0);
  assert.equal(budgetOf(h({})), null);
  assert.equal(budgetOf(h({ 'x-budget-left-usd': 'x', 'x-budget-total-usd': '0.1' })), null);
});

// background.js を偽の chrome / fetch で動かして、経路・休止・表示用の値を確かめる
async function boot({ apiKey = '', responder }) {
  const local = { apiKey, settings: {} }, session = {};
  const calls = [];
  const area = (o) => ({ get: async () => ({ ...o }), set: async (v) => { Object.assign(o, v); }, remove: async (k) => { delete o[k]; } });
  let onMsg = null; const onChanged = [];
  globalThis.chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener: (f) => onChanged.push(f) } },
    runtime: { onMessage: { addListener: (f) => { onMsg = f; } } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  };
  globalThis.indexedDB = { open() { const r = {}; queueMicrotask(() => r.onerror && r.onerror()); return r; } }; // 覚え書きは使わない
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length); };
  await import(`../background.js?t=${Math.random()}`);
  const ask = (msg) => new Promise((res) => onMsg(msg, { url: 'https://example.org/' }, res));
  const setKey = (v) => { local.apiKey = v; for (const f of onChanged) f({ apiKey: { newValue: v } }, 'local'); };
  return { ask, calls, local, session, setKey };
}
const ok = (extra = {}) => new Response(JSON.stringify(body(0.9, 0.1, 0.1)), { status: 200, headers: { 'content-type': 'application/json', ...extra } });
const err = (error, status) => new Response(JSON.stringify({ error, message: 'm' }), { status, headers: { 'content-type': 'application/json' } });

test('background: キーなしは中継へ、文と ID だけ', async () => {
  const b = await boot({ responder: () => ok({ 'x-budget-left-usd': '0.05', 'x-budget-total-usd': '0.1' }) });
  const r = await b.ask({ type: 'test', text: 'テストの文' });
  assert.equal(r.scores.attack, 0.9);
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].url, RELAY_JUDGE);
  assert.deepEqual(JSON.parse(b.calls[0].init.body), { text: 'テストの文' });
  assert.match(b.calls[0].init.headers['X-Install-Id'], /^[0-9a-f]{32}$/);
  assert.equal(b.local.installId, b.calls[0].init.headers['X-Install-Id']);
  const s = await b.ask({ type: 'stats' });
  assert.equal(s.route, 'relay'); assert.equal(s.budget, 0.5); assert.equal(s.limit, 3000);
});

test('background: キーありは直接、中継には触れない', async () => {
  const b = await boot({ apiKey: 'sk-test', responder: () => ok() });
  await b.ask({ type: 'test', text: 'テストの文 2' });
  assert.equal(b.calls[0].url, ENDPOINT);
  assert.equal(b.calls[0].init.headers.Authorization, 'Bearer sk-test');
  const s = await b.ask({ type: 'stats' });
  assert.equal(s.route, 'direct'); assert.equal(s.limit, 20000);
});

test('background: 無料枠の終了は 1 回で止まり、長く休む。キーを入れると直ちに再開', async () => {
  const b = await boot({ responder: (url) => (url === RELAY_JUDGE ? err('free_tier_ended', 503) : ok()) });
  const r = await b.ask({ type: 'test', text: '文 A' });
  assert.match(r.error, /無料枠は終了/);
  assert.equal(b.calls.length, 1); // 503 でも聞き直さない
  const r2 = await b.ask({ type: 'test', text: '文 B' });
  assert.ok(r2.error); assert.equal(b.calls.length, 1); // 休んでいるあいだは送らない
  const s = await b.ask({ type: 'stats' });
  assert.ok(s.paused >= 10 * 60e3); assert.match(s.stats.lastError, /API キーを設定/);
  b.setKey('sk-mine');
  const r3 = await b.ask({ type: 'test', text: '文 C' });
  assert.equal(r3.scores.attack, 0.9);
  assert.equal(b.calls[1].url, ENDPOINT);
  assert.equal((await b.ask({ type: 'stats' })).stats.lastError, '');
});

test('background: 1 日の上限 (user_limit) は 429 でも聞き直さず、日本時間 9 時まで止める', async () => {
  const b = await boot({ responder: () => err('user_limit', 429) });
  const r = await b.ask({ type: 'test', text: '文 D' });
  assert.match(r.error, /午前 9 時/);
  assert.equal(b.calls.length, 1);
  const s = await b.ask({ type: 'stats' });
  assert.ok(s.paused > 0 && s.paused <= 60 * 60e3);
  assert.match(s.pauseMsg, /午前 9 時/);
  assert.equal(s.budget, 0);
});

test('background: 中継の先の一時的な失敗は聞き直す', async () => {
  const b = await boot({ responder: (u, i, n) => (n === 1 ? err('upstream_error', 502) : ok()) });
  const r = await b.ask({ type: 'test', text: '文 E' });
  assert.equal(r.scores.attack, 0.9);
  assert.equal(b.calls.length, 2);
});

test('background: 理由の分からない断りが続いたら休む（中継が消えた・404 など）', async () => {
  const b = await boot({ responder: () => new Response('not found', { status: 404 }) });
  for (const t of ['文 F', '文 G', '文 H', '文 I', '文 J']) await b.ask({ type: 'test', text: t });
  assert.equal(b.calls.length, 3); // 3 回で止まり、あとは送らない
  assert.ok((await b.ask({ type: 'stats' })).paused >= 10 * 60e3);
});

test('既定の「使わないサイト」: 新しく足した既定は古い設定にも届き、自分で外したものは戻らない', async () => {
  const { mergeSettings } = await import('../jev.js');
  const D = globalThis.JEV_DEFAULT_EXCLUDE, B = globalThis.JEV_DEFAULT_BASE;
  assert.ok(D.length > B);
  assert.deepEqual(mergeSettings(undefined).exclude, D);
  const old = mergeSettings({ exclude: ['example.com', 'claude.ai'] }); // 2.x で保存された一覧（exSeen なし）
  assert.ok(old.exclude.includes('example.com') && old.exclude.includes(D[B]) && !old.exclude.includes('mail.google.com'));
  const cur = mergeSettings({ exclude: ['example.com'], exSeen: D }); // 3.0 で保存: 外した既定は戻らない
  assert.deepEqual(cur.exclude, ['example.com']);
});

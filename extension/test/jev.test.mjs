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
  assert.equal(DEFAULTS.threshold, 0.5);
  assert.equal(verdict(parseAnswers(body(0.5, 0, 0)), DEFAULTS).hide, true); // ちょうどしきい値
  assert.equal(verdict(parseAnswers(body(0.49, 0.2, 0.1)), DEFAULTS).hide, false);
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
async function boot({ apiKey = '', responder, settings = { consent: true } }) {
  const local = { apiKey, settings }, session = {};
  const calls = [];
  const area = (o) => ({ get: async () => ({ ...o }), set: async (v) => { Object.assign(o, v); }, remove: async (k) => { delete o[k]; } });
  let onMsg = null; const onChanged = [];
  globalThis.chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener: (f) => onChanged.push(f) } },
    runtime: { onMessage: { addListener: (f) => { onMsg = f; } }, onInstalled: { addListener() {} }, getURL: (p) => p },
    tabs: { create() {} },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  };
  globalThis.indexedDB = { open() { const r = {}; queueMicrotask(() => r.onerror && r.onerror()); return r; } }; // 覚え書きは使わない
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length); };
  await import(`../background.js?t=${Math.random()}`);
  const ask = (msg, url = 'https://example.org/') => new Promise((res) => onMsg(msg, { url }, res));
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

// ---- 汎用検出の最小の長さ（短い暴言は拾い、画面の部品の名前は拾わない） ----
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('汎用検出: 短い暴言は判定に回し、2〜3 字の部品名は回さない', () => {
  const src = readFileSync(new URL('../generic.js', import.meta.url), 'utf8');
  const G = vm.runInNewContext(`${src}; jevGeneric`, {});
  const CJK = /[぀-ヿ㐀-鿿가-힯ｦ-ﾟ]/;
  const ok = (text, f = 1) => {
    if (text.length < G.OPT.minChars) return false;
    const cjk = CJK.test(text);
    return G.longEnough(text.replace(/[^\p{L}]/gu, '').length, cjk ? 99 : text.split(/\s+/).length, cjk, f, G.OPT);
  };
  for (const t of ['ぶん殴るぞ！！', 'お前消えろ', 'くたばれよ', 'fuck you', 'shut up idiot', 'kill yourself', '了解です', 'ありがとう']) assert.equal(ok(t), true, t);
  for (const t of ['ホーム', '検索', 'メニュー'.slice(0, 3), '次へ', 'OK', 'Login', 'Sign in', 'Home', 'www', '草']) assert.equal(ok(t), false, t);
  // 見出し (f = 2.5) とリンクだけの文 (f = 1.6) は今までどおり厳しい
  assert.equal(ok('ぶん殴るぞ！！', 2.5), false);
  assert.equal(ok('Read more', 1.6), false);
  assert.equal(ok('もっと見る', 1.6), false);
  assert.equal(ok('大臣の発言に批判が相次ぐ', 2.5), true);
});

test('しきい値の既定は 50%。印の無い保存済みの 0.7 は既定のままと見なす', async () => {
  const { mergeSettings } = await import('../jev.js');
  assert.equal(mergeSettings(undefined).threshold, 0.5);
  assert.equal(mergeSettings({ mode: 'remove' }).threshold, 0.5);
  assert.equal(mergeSettings({ threshold: 0.7 }).threshold, 0.5); // 3.0.1 までに丸ごと保存された既定値
  assert.equal(mergeSettings({ threshold: 0.7, thUser: true }).threshold, 0.7); // 3.0.2 以降に自分で選んだ 70%
  assert.equal(mergeSettings({ threshold: 0.85 }).threshold, 0.85); // 既定と違う値は自分で選んだもの
  assert.equal(mergeSettings({ threshold: 0.3 }).threshold, 0.3);
});

test('同意の前は、ページの文も「文で試す」も一切送らない', async () => {
  const b = await boot({ responder: () => ok(), settings: {} });
  const r = await b.ask({ type: 'judge', text: 'ページの文' });
  assert.ok(r.error); assert.equal(r.fatal, true);
  assert.ok((await b.ask({ type: 'test', text: '試す文' })).error);
  assert.equal(b.calls.length, 0);
});

test('同意のあとは送る。使わないサイトからは送らない', async () => {
  const b = await boot({ responder: () => ok(), settings: { consent: true, exclude: ['example.net'] } });
  const r = await b.ask({ type: 'judge', text: 'ページの文 2' });
  assert.equal(r.scores.attack, 0.9);
  assert.equal(b.calls.length, 1);
  const r2 = await b.ask({ type: 'judge', text: 'ページの文 3' }, 'https://mail.example.net/x');
  assert.ok(r2.error); assert.equal(b.calls.length, 1);
});

test('使うサイト: 既定は対応サイト。足したものは保たれ、消した既定は戻らない', async () => {
  const { mergeSettings, DEFAULTS } = await import('../jev.js');
  const D = globalThis.JEV_DEFAULT_SITES;
  assert.deepEqual(mergeSettings(undefined).sites, D);
  assert.ok(D.includes('x.com') && D.includes('youtube.com') && D.includes('nicovideo.jp') && D.includes('reddit.com'));
  assert.deepEqual(mergeSettings({ sites: ['example.org'], siSeen: D }).sites, ['example.org']);
  assert.equal(DEFAULTS.consent, false);
});

test('オフの間は、ページの文も「文で試す」も一切送らない', async () => {
  const b = await boot({ responder: () => ok(), settings: { consent: true, enabled: false } });
  const r = await b.ask({ type: 'test', text: '試す文' });
  assert.match(r.error, /オフの間は判定しません/);
  assert.ok((await b.ask({ type: 'judge', text: 'ページの文' })).error);
  assert.equal(b.calls.length, 0);
});

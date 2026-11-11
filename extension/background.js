import { QUESTION_VERSION, RELAY_DAILY_CAP, mergeSettings, parseAnswers, routeOf, buildFetch, newInstallId, relayFailure, budgetOf, relayDay, RELAY_MODEL } from './jev.js';

const CACHE_MAX = 4000;
const CONCURRENCY = 6;
const TIMEOUT_MS = 10000; // 応答の本文を読み終えるまで
const RETRIES = 2; // 408/429/5xx と通信の失敗だけ、間を空けて
const QUEUE_MAX = 500; // 画面の投稿の順番待ち
const QUEUE_LOW_MAX = 1500; // チャット・流れるコメントの順番待ち
const LOW_SHARE = 0.5; // 急がないものは 1 日の上限の半分まで

let ready = null;
let settings = mergeSettings();
let apiKey = '';
let installId = ''; // 無料枠の中継に名乗る乱数（この拡張機能の入れ直しで変わる）
let budget = null; // 無料枠の今日の残り（0〜1）。まだ聞いていなければ null
let cache = new Map(); // key -> [attack, divisive, quarrel]（挿入順 = 古い順）
let stats = null;
let lastModel = '';
const inflight = new Map(); // key -> Promise
const waiting = []; // 画面の投稿
const waitingLow = []; // 数が多くて急がないもの
let active = 0;
let pausedUntil = 0;
let pauseMsg = ''; // 休んでいる理由（休みのあいだポップアップに出す）
let failStreak = 0;
let rejectStreak = 0;
let saveTimer = null;

const today = () => new Date().toLocaleDateString('sv');
const freshStats = () => ({ day: today(), calls: 0, inTok: 0, hidden: 0, errors: 0, lastError: '' });

// ---- 判定の覚え書きは IndexedDB に（storage に置くと、書くたびに全タブへ中身ごと通知が飛ぶ） ----
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('jev-cache', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('scores', { autoIncrement: true });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => {
  const t = d.transaction('scores', mode);
  const out = fn(t.objectStore('scores'));
  t.oncomplete = () => res(out && out.result);
  t.onerror = t.onabort = () => rej(t.error);
})).catch(() => undefined);
async function cacheLoad() {
  const rows = (await tx('readonly', (s) => s.getAll())) || [];
  cache = new Map(rows.map((r) => [r.k, r.s]));
  if (rows.length > CACHE_MAX * 1.25) { // 古いものを捨てて詰め直す
    const keep = rows.slice(-CACHE_MAX);
    cache = new Map(keep.map((r) => [r.k, r.s]));
    await tx('readwrite', (s) => { s.clear(); for (const r of keep) s.add(r); });
  }
}
function cachePut(k, s) {
  cache.set(k, s);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  tx('readwrite', (st) => { st.add({ k, s }); });
}
function cacheClear() {
  cache.clear();
  return tx('readwrite', (s) => { s.clear(); });
}

function load() {
  if (!ready) {
    ready = Promise.all([
      chrome.storage.local.get(['settings', 'apiKey', 'stats', 'lastModel', 'cache', 'installId']),
      chrome.storage.session.get(['pausedUntil', 'pauseMsg', 'budget', 'budgetDay']).catch(() => ({})),
      cacheLoad(),
    ]).then(([s, ses]) => {
      settings = mergeSettings(s.settings);
      apiKey = s.apiKey || '';
      stats = s.stats && s.stats.day === today() ? s.stats : freshStats();
      lastModel = s.lastModel || '';
      pausedUntil = Number(ses && ses.pausedUntil) || 0;
      pauseMsg = (ses && ses.pauseMsg) || '';
      budget = ses && typeof ses.budget === 'number' && ses.budgetDay === relayDay() ? ses.budget : null;
      installId = /^[0-9a-f]{32}$/.test(s.installId || '') ? s.installId : newInstallId();
      if (installId !== s.installId) chrome.storage.local.set({ installId });
      if (s.cache) chrome.storage.local.remove('cache'); // 1.x の置き場所の後始末
      badge();
    });
  }
  return ready;
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.settings) {
    const next = mergeSettings(ch.settings.newValue);
    const changed = next.model !== settings.model || next.dailyLimit !== settings.dailyLimit;
    if (next.model !== settings.model && apiKey) pause(0);
    settings = next;
    badge();
    if (changed) clearError();
  }
  if (ch.apiKey) { apiKey = ch.apiKey.newValue || ''; pause(0); failStreak = 0; rejectStreak = 0; clearError(); }
});

function badge() { // オフのときはアイコンに出す
  chrome.action.setBadgeText({ text: !settings.consent ? '!' : settings.enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#888' });
}

function pause(ms, msg = '') {
  pausedUntil = ms ? Date.now() + ms : 0;
  pauseMsg = ms ? msg : '';
  chrome.storage.session.set({ pausedUntil, pauseMsg }).catch(() => {});
}
function setBudget(b) {
  budget = b;
  chrome.storage.session.set({ budget, budgetDay: relayDay() }).catch(() => {});
}
const pausedMsg = () => (Date.now() < pausedUntil ? pauseMsg || stats.lastError || '一時停止中です' : '');

function clearError() { // 直したあとに古い失敗の文言を出し続けない
  if (stats && stats.lastError) { stats.lastError = ''; saveSoon(); }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; chrome.storage.local.set({ stats }); }, 1500);
}

function rollDay() {
  if (stats.day !== today()) stats = freshStats();
}

async function keyOf(text) {
  const data = new TextEncoder().encode(`${QUESTION_VERSION}\n${apiKey ? settings.model : RELAY_MODEL}\n${text}`);
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...buf.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class Stop extends Error { // 聞き直しても無駄な止まり方（キーなし・上限）
  constructor(msg) { super(msg); this.fatal = true; }
}

function slot(low) {
  if (active < CONCURRENCY) { active++; return Promise.resolve(); }
  const q = low ? waitingLow : waiting;
  if (q.length >= (low ? QUEUE_LOW_MAX : QUEUE_MAX)) return Promise.reject(new Error('順番待ちがいっぱいです'));
  return new Promise((r) => q.push(r));
}
function release() {
  const next = waiting.shift() || waitingLow.shift();
  if (next) next(); else active--;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  stats.errors++;
  stats.lastError = msg;
  saveSoon();
  return new Error(msg);
}
function note(msg) { // 件数には数えずに、ポップアップへ理由だけ出す
  if (stats.lastError !== msg) { stats.lastError = msg; saveSoon(); }
  return new Stop(msg);
}
const dailyCap = () => (apiKey ? settings.dailyLimit : Math.min(settings.dailyLimit, RELAY_DAILY_CAP)); // 無料枠は中継の上限に合わせる
// 無料枠の件数は中継と同じ区切り（UTC の日付 = 日本時間の午前 9 時）で、自分のキーの分とは別に数える
function relayCalls() {
  if (stats.relayDay !== relayDay()) { stats.relayDay = relayDay(); stats.relayCalls = 0; }
  return stats.relayCalls;
}
function gate(low) {
  if (Date.now() < pausedUntil) throw new Error(pausedMsg());
  rollDay();
  const limit = dailyCap(), used = apiKey ? stats.calls : relayCalls();
  if (used >= limit) throw note(apiKey ? `1 日の上限 (${limit} 件) に達しました。今日はもう隠しません` : `無料枠のこちら側の上限 (${limit} 件) に達しました。日本時間の午前 9 時に戻ります`);
  if (low && used >= limit * LOW_SHARE) throw new Stop('チャット・流れるコメントの分の上限に達しました');
}

async function callJev(text, low) {
  gate(low);
  await slot(low);
  try {
    for (let attempt = 0; ; attempt++) {
      gate(low);
      const model = settings.model, key = apiKey, relay = routeOf(key) === 'relay';
      stats.calls++;
      if (relay) { relayCalls(); stats.relayCalls++; }
      saveSoon();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      let res = null, body = null, netErr = '';
      try {
        const f = buildFetch(text, { apiKey: key, model, installId });
        res = await fetch(f.url, { ...f.init, signal: ctl.signal });
        body = await res.json().catch((e) => { if (e.name === 'AbortError') throw e; return null; });
      } catch (e) {
        res = null;
        netErr = e.name === 'AbortError' ? 'jev が時間内に応答しませんでした' : 'jev に接続できませんでした';
      } finally {
        clearTimeout(timer);
      }
      // 無料枠の中継の断り（終了・上限など）: 理由を出して、決まった時間は叩かない
      const rf = relay && res && !res.ok ? relayFailure(body && typeof body.error === 'string' ? body.error : '', res.status) : null;
      if (rf && !rf.retry) {
        if (apiKey !== key) throw new Error('設定が変わる前の問い合わせでした'); // キーを入れたあとに、中継の断りで止めない
        if (rf.pause) pause(rf.pause, rf.msg);
        else if (++rejectStreak >= 3) { rejectStreak = 0; pause(15 * 60e3, rf.msg); } // 理由の分からない断りが続くなら、まとめて休む
        if (body && body.error === 'user_limit') setBudget(0);
        throw fail(rf.msg);
      }
      const retryable = !res || res.status === 408 || res.status === 429 || res.status >= 500;
      if (retryable) {
        if (attempt < RETRIES) {
          const ra = res && (Number(res.headers.get('retry-after-ms')) || Number(res.headers.get('retry-after')) * 1000);
          const wait = ra > 0 ? Math.min(ra, 20000) : Math.min(500 * 2 ** attempt, 5000) * (0.75 + Math.random() * 0.5);
          await sleep(wait);
          continue;
        }
        // 続けて失敗するなら、しばらく全体を止める（上限を無駄な呼び出しで使い切らない）
        if (res && (res.status === 429 || res.status === 529)) { { const m_ = `利用制限か混雑です (HTTP ${res.status})。30 秒休みます`; pause(30e3, m_); throw fail(m_); } }
        if (++failStreak >= 5) { failStreak = 0; pause(60e3); throw fail(`${res ? `jev がエラーを返しました (HTTP ${res.status})` : netErr}。続いたので 1 分休みます`); }
        throw fail(res ? `jev がエラーを返しました (HTTP ${res.status})` : netErr);
      }
      if (!res.ok) {
        if (settings.model !== model || apiKey !== key) throw new Error('設定が変わる前の問い合わせでした'); // 直したあとに古い失敗で止めない
        if (res.status === 401 || res.status === 403) { { const m_ = `API キーが通りません (HTTP ${res.status})`; pause(10 * 60e3, m_); throw fail(m_); } }
        if (res.status === 402) { { const m_ = '残高不足のようです (HTTP 402)'; pause(10 * 60e3, m_); throw fail(m_); } }
        const d = body && body.detail;
        const detail = typeof d === 'string' ? d : d ? JSON.stringify(d) : '';
        if (res.status === 400 && /max_tokens/.test(detail)) throw fail('文が長すぎて判定できませんでした');
        // 1 件だけなら、その文に固有の問題かもしれない。続いたら要求の形かモデル名の問題なので、まとめて休む
        if (++rejectStreak >= 3) { rejectStreak = 0; { const m_ = `jev が要求を受け付けません (HTTP ${res.status}) ${detail.slice(0, 160)}。5 分休みます`; pause(5 * 60e3, m_); throw fail(m_); } }
        throw fail(`jev が要求を受け付けません (HTTP ${res.status}) ${detail.slice(0, 160)}`);
      }
      let scores;
      try { scores = parseAnswers(body); } catch (e) {
        if (++failStreak >= 5) { failStreak = 0; { const m_ = `${e.message}。続いたので 5 分休みます`; pause(5 * 60e3, m_); throw fail(m_); } }
        throw fail(e.message);
      }
      failStreak = 0; rejectStreak = 0;
      if (stats.lastError) stats.lastError = '';
      const n = body.usage && body.usage.input_tokens;
      if (Number.isInteger(n)) { stats.inTok += n; if (relay) stats.relayTok = (stats.relayTok || 0) + n; }
      if (relay) { const b = budgetOf(res.headers); if (b !== null && b !== budget) setBudget(b); }
      if (typeof body.model === 'string' && body.model !== lastModel) {
        // 別名 (jev-latest) の指す先が変わった。古いモデルの点数と混ぜない
        if (lastModel) await cacheClear();
        lastModel = body.model;
        chrome.storage.local.set({ lastModel });
      }
      saveSoon();
      return scores;
    }
  } finally {
    release();
  }
}

async function judge(text, useCache = true, low = false) {
  await load();
  const key = await keyOf(text);
  if (useCache && cache.has(key)) { const s = cache.get(key); return { attack: s[0], divisive: s[1], quarrel: s[2] }; }
  if (inflight.has(key)) return inflight.get(key);
  const p = callJev(text, low).then((scores) => {
    cachePut(key, [scores.attack, scores.divisive, scores.quarrel]);
    return scores;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const hostMatch = (h, x) => x && (h === x || h.endsWith('.' + x));
function senderBlocked(sender) { // ページ側の判断の念押し
  if (!settings.enabled || !settings.consent) return true;
  try {
    const h = new URL(sender.url).hostname;
    return !!h && settings.exclude.some((x) => hostMatch(h, x));
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'judge' || msg.type === 'test') {
    const fromPage = msg.type === 'judge';
    load().then(() => {
      if (fromPage && senderBlocked(sender)) throw new Stop('このページでは使わない設定です');
      return judge(String(msg.text || ''), fromPage, !!msg.low);
    }).then((scores) => reply({ scores }), (e) => reply({ error: e.message, fatal: !!e.fatal }));
    return true;
  }
  if (msg.type === 'hid') {
    load().then(() => { rollDay(); stats.hidden += msg.n || 1; saveSoon(); });
    return false;
  }
  if (msg.type === 'stats') {
    load().then(() => { rollDay(); reply({ stats, pauseMsg: pausedMsg(), hasKey: !!apiKey, route: routeOf(apiKey), budget: stats.relayDay && stats.relayDay !== relayDay() ? null : budget, limit: dailyCap(), cached: cache.size, paused: Math.max(0, pausedUntil - Date.now()) }); });
    return true;
  }
  if (msg.type === 'clearCache') {
    load().then(cacheClear).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

load(); // 起動時にアイコンの表示を合わせる

// 入れた直後に、はじめの説明（同意）を開く。同意するまでは何も送らない
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

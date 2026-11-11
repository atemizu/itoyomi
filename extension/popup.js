import { DEFAULTS, PRICE_PER_MTOK, mergeSettings, verdict } from './jev.js';

const $ = (id) => document.getElementById(id);
const LABEL = { attack: '攻撃・侮辱', divisive: '煽り・分断', quarrel: '口論' };
let settings = { ...DEFAULTS };
// 名前は manifest.json の name の 1 か所だけ（ここ・ツールバーの表示・zip の名前はそれを読む）
document.title = $('name').textContent = chrome.runtime.getManifest().name;

async function save(patch) {
  settings = { ...settings, ...patch };
  if (patch.exclude) settings.exSeen = globalThis.JEV_DEFAULT_EXCLUDE; // いまの既定は見た（外した既定を、あとで勝手に戻さない）
  await chrome.storage.local.set({ settings });
}

function show() {
  $('enabled').checked = settings.enabled;
  if (document.activeElement !== $('model')) $('model').value = settings.model;
  $('threshold').value = settings.threshold;
  $('thv').textContent = `${Math.round(settings.threshold * 100)}%`;
  $('mode').value = settings.mode;
  if (document.activeElement !== $('dailyLimit')) $('dailyLimit').value = settings.dailyLimit;
  for (const el of document.querySelectorAll('[data-cat]')) el.checked = !!settings.cats[el.dataset.cat];
  $('generic').checked = settings.generic;
  $('nicoDanmaku').checked = settings.nicoDanmaku;
  if (document.activeElement !== $('exclude')) $('exclude').value = settings.exclude.join('\n');
  if (tabHost) {
    $('siteRow').hidden = false;
    const hit = excludeHit(tabHost); // 親のホスト（proton.me など）で入っているときは、その行を相手にする
    $('siteName').textContent = hit && hit !== tabHost ? `${hit}（${tabHost} を含む）` : tabHost;
    $('siteOff').checked = !!hit;
  }
}

let tabHost = '';
const excludeHit = (h) => settings.exclude.find((x) => x && (h === x || h.endsWith('.' + x)));
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const u = tab && tab.url ? new URL(tab.url) : null;
  if (u && /^https?:$/.test(u.protocol)) tabHost = u.hostname;
} catch {}

async function refreshStats() {
  const r = await chrome.runtime.sendMessage({ type: 'stats' });
  if (!r) return;
  const s = r.stats;
  const usd = (s.inTok / 1e6) * PRICE_PER_MTOK;
  $('stats').textContent = `隠した投稿 ${s.hidden} 件 ・ jev への問い合わせ ${s.calls} 件 ・ 入力 ${s.inTok.toLocaleString()} トークン（約 $${usd.toFixed(4)}）・ キャッシュ ${r.cached} 件`;
  const off = !settings.enabled ? '右上の「有効」がオフなので、いまは何も判定していません。' : tabHost && excludeHit(tabHost) ? 'このサイトは「使わないサイト」に入っているので、ここでは判定しません。' : '';
  $('off').textContent = off;
  const rest = (ms) => (ms >= 3600e3 ? `約 ${Math.round(ms / 3600e3)} 時間` : ms >= 60e3 ? `約 ${Math.ceil(ms / 60e3)} 分` : `${Math.ceil(ms / 1000)} 秒`);
  $('err').textContent = [s.errors ? `失敗 ${s.errors} 件` : '', r.pauseMsg || s.lastError, r.paused ? `（あと${rest(r.paused)}休み）` : ''].filter(Boolean).join(' ');
  const free = r.route === 'relay';
  $('route').textContent = free
    ? `いまのモード: 無料枠（開発者の中継を経由）${typeof r.budget === 'number' ? ` ・ 今日の残り 約 ${Math.round(r.budget * 100)}%` : ''}`
    : 'いまのモード: 自分の API キー（中継は通らず、直接 TypeSafe に送ります）';
  $('limitNote').textContent = free && settings.dailyLimit > r.limit ? `無料枠のあいだは ${r.limit} 件までです。` : '';
  $('keyState').textContent = r.hasKey
    ? 'キーは保存済みです（この端末の拡張機能の保存領域のみ）。判定は中継を通らず、直接 TypeSafe に送られます。'
    : 'キーは任意です。入れると無料枠の中継を通らず、直接 TypeSafe に送ります（料金はご自身の負担）。';
  $('forget').hidden = !r.hasKey;
  $('model').disabled = free; // 無料枠ではモデルは中継が決める
  $('model').title = free ? '無料枠ではモデルは中継側が決めます' : '';
}

const stored = await chrome.storage.local.get('settings');
settings = mergeSettings(stored.settings);
show();
refreshStats();
setInterval(refreshStats, 1500); // 開いているあいだ数字を追う
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) { settings = mergeSettings(ch.settings.newValue); show(); refreshStats(); } });

$('enabled').onchange = (e) => save({ enabled: e.target.checked });
// ポップアップは外を押すと消える（そのとき change は来ない）ので、打つ手が止まったら保存する。途中の値は保存しない。
const timers = {};
const later = (name, fn) => { clearTimeout(timers[name]); timers[name] = setTimeout(fn, 600); };
const now = (name) => clearTimeout(timers[name]);
$('model').oninput = (e) => later('model', () => { const v = e.target.value.trim(); if (v) save({ model: v }); });
$('model').onchange = (e) => now('model') || save({ model: e.target.value.trim() || DEFAULTS.model }).then(show);
$('threshold').oninput = (e) => { save({ threshold: Number(e.target.value) }); $('thv').textContent = `${Math.round(e.target.value * 100)}%`; };
$('mode').onchange = (e) => save({ mode: e.target.value });
const limitOf = (v) => { const n = Math.floor(Number(v)); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : DEFAULTS.dailyLimit; };
$('dailyLimit').oninput = (e) => later('limit', () => { if (e.target.value.trim()) save({ dailyLimit: limitOf(e.target.value) }); });
$('dailyLimit').onchange = (e) => now('limit') || save({ dailyLimit: limitOf(e.target.value) }).then(show);
for (const el of document.querySelectorAll('[data-cat]')) {
  el.onchange = () => save({ cats: { ...settings.cats, [el.dataset.cat]: el.checked } });
}
$('generic').onchange = (e) => save({ generic: e.target.checked });
$('nicoDanmaku').onchange = (e) => save({ nicoDanmaku: e.target.checked });
const toHost = (x) => { try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(x) ? x : 'https://' + x.replace(/^\*?\./, '')).hostname.replace(/\.$/, ''); } catch { return ''; } };
const excludeOf = (v) => [...new Set(v.split(/\s+/).map(toHost).filter(Boolean))];
// 打っている途中は「足す」だけ（消す・直すの途中で、開いているタブの除外が外れないように）。確定は欄を離れたとき。
let committed = null;
$('exclude').onfocus = () => { committed = settings.exclude; };
$('exclude').oninput = (e) => later('exclude', () => save({ exclude: [...new Set([...(committed || settings.exclude), ...excludeOf(e.target.value)])] }));
$('exclude').onchange = (e) => { now('exclude'); committed = null; save({ exclude: excludeOf(e.target.value) }).then(show); };
$('siteOff').onchange = (e) => {
  const name = excludeHit(tabHost) || tabHost;
  const rest = settings.exclude.filter((x) => x !== name);
  save({ exclude: e.target.checked ? [...rest, name] : rest }).then(show);
};
$('saveKey').onclick = async () => {
  const v = $('key').value.trim();
  if (!v) return;
  await chrome.storage.local.set({ apiKey: v });
  $('key').value = '';
  refreshStats();
};
$('forget').onclick = async () => { await chrome.storage.local.remove('apiKey'); refreshStats(); };
$('test').onclick = async () => {
  const text = $('testText').value.trim();
  if (!text) return;
  $('testOut').textContent = '判定中…';
  const r = await chrome.runtime.sendMessage({ type: 'test', text });
  if (!r || r.error) { $('testOut').textContent = (r && r.error) || '応答なし'; refreshStats(); return; }
  const v = verdict(r.scores, settings);
  const parts = Object.keys(LABEL).map((c) => `${LABEL[c]} ${Math.round(r.scores[c] * 100)}%`);
  $('testOut').textContent = `${v.hide ? '隠す' : '隠さない'} ・ ${parts.join(' / ')}`;
  refreshStats();
};
$('clear').onclick = async () => { await chrome.runtime.sendMessage({ type: 'clearCache' }); refreshStats(); };

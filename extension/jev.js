// jev (TypeSafe System One) への質問の組み立てと、答えの読み取り。通信はしない。
import './defaults.js';
export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const QUESTION_VERSION = 'q2'; // 質問文を変えたら上げる（古いキャッシュを使わないため）
export const MAX_TEXT = 3000;
// 無料枠の中継（開発者が利用料を負担する窓口）。API キーが未設定のときだけ使う。URL はここ 1 か所。
export const RELAY = 'https://jev-relay.ktjz8fmk7w.workers.dev';
export const RELAY_JUDGE = RELAY + '/v1/judge';
export const RELAY_DAILY_CAP = 3000; // 中継の 1 人 1 日の上限（約 2,800 件）に合わせた、こちら側の歯止め
export const PRICE_PER_MTOK = 0.042; // 入力 100 万トークンあたりの米ドル（2026-10 時点の公表値）

export const DEFAULTS = {
  enabled: true,
  model: 'jev-latest',
  threshold: globalThis.JEV_THRESHOLD,
  mode: 'collapse', // 'collapse' = 1 行にたたむ / 'remove' = 跡形なく消す
  cats: { attack: true, divisive: true, quarrel: true },
  dailyLimit: 20000,
  generic: true, // 対応サイト以外の全ページにも適用する
  nicoDanmaku: true, // ニコニコ動画の流れるコメントも判定する
  exclude: globalThis.JEV_DEFAULT_EXCLUDE, // このホスト（とその下位）では何もしない
};

export function mergeSettings(s) {
  s = s || {};
  return { ...DEFAULTS, ...s, cats: { ...DEFAULTS.cats, ...(s.cats || {}) }, exclude: globalThis.jevExclude(s), threshold: globalThis.jevThreshold(s) };
}

export const CATS = ['attack', 'divisive', 'quarrel'];

// 言葉の荒さではなく、書き手の意図で決める（口の悪さ・物騒な話題・自虐・ふざけ合い・率直な批評は隠さない。丁寧な言葉の見下しは隠す）
const HEAD = 'The content is one post or comment from the web (any language). ';
export const QUESTIONS = {
  attack: {
    type: 'noul',
    instructions: HEAD + 'Is the author using this text to hurt, humiliate, or drive away another person or a group of people?',
    criteria: {
      true: "The author's aim is to put a target down: a sincere insult, contempt, mockery or sarcastic praise meant to make someone look worthless, wishing them harm, a threat, or telling them to shut up, leave or disappear. Polite, indirect or clean wording still counts when that aim is there.",
      false: "The author is doing something else, even with harsh or vulgar words: an amused story or news about someone's blunder or crime, swearing for emphasis, venting about a situation, self-deprecation or putting oneself down, affectionate teasing between friends, blunt sincere criticism of a work, idea or action, or quoting or describing hostility that came from someone else.",
    },
  },
  divisive: {
    type: 'noul',
    instructions: HEAD + 'Is the author trying to turn readers against a person or a group of people?',
    criteria: {
      true: 'The author is recruiting readers into hostility: urging them to hate, shun, punish, mass-report or pile on someone, telling them they should be outraged and should spread it, or presenting a whole group as bad, dangerous or an enemy. Calm, clean wording still counts.',
      false: "The author is informing, sharing or reacting, even when the topic is dark or the tone is rough: news or an amused anecdote about a crime or a wrongdoer, venting, sadness or self-deprecation about oneself, a strong opinion about an issue, a joke with no enemy, or describing a conflict or hostility that the author only observed or received.",
    },
  },
  quarrel: {
    type: 'noul',
    instructions: HEAD + 'Is the author trying to belittle, provoke, or silence the person they are addressing?',
    criteria: {
      true: 'The text is aimed at the other person in an exchange and is meant to beat them rather than discuss: taunting, sneering at their intelligence or motives, talking down, daring them to respond, or telling them their voice is not wanted. Formally polite wording still counts.',
      false: 'Ordinary talk or sincere disagreement, even when blunt or foul-mouthed: a correction or counter-argument about the point itself, a real question, playful teasing the other person is expected to enjoy, excited swearing, self-deprecation, or a story, joke or remark that is not directed at an opponent.',
    },
  },
};

export function buildRequest(text, model) {
  let state = String(text).slice(0, MAX_TEXT);
  if (state.toWellFormed) state = state.toWellFormed(); // 絵文字の途中で切れた半端な符号を送らない
  return { model, state, questions: QUESTIONS };
}

// 応答から {attack, divisive, quarrel} (各 0〜1) を取り出す。形が違えば例外。
export function parseAnswers(body) {
  const answers = body && body.answers;
  if (!answers || typeof answers !== 'object') throw new Error('応答に answers がありません');
  const out = {};
  for (const c of CATS) {
    const a = answers[c];
    const v = a && a.noul;
    if (!a || a.type !== 'noul' || typeof v !== 'number' || !(v >= 0 && v <= 1)) {
      throw new Error(`応答の ${c} が読めません`);
    }
    out[c] = v;
  }
  return out;
}

export function verdict(scores, settings) {
  let top = null, score = 0;
  for (const c of CATS) {
    if (settings.cats[c] && scores[c] > score) { top = c; score = scores[c]; }
  }
  return { hide: top !== null && score >= settings.threshold, top, score };
}

// ---- 経路（自分のキー = 直接 TypeSafe / キーなし = 無料枠の中継） ----
export const routeOf = (apiKey) => (apiKey ? 'direct' : 'relay');

export function buildFetch(text, { apiKey, model, installId }) {
  const common = { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
  if (routeOf(apiKey) === 'direct') {
    return { url: ENDPOINT, init: { ...common, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildRequest(text, model)) } };
  }
  let t = String(text).slice(0, MAX_TEXT);
  if (t.toWellFormed) t = t.toWellFormed();
  // 中継へ送るのは文と、拡張機能ごとの乱数の ID だけ（質問文とモデルは中継が組む）
  return { url: RELAY_JUDGE, init: { ...common, headers: { 'X-Install-Id': installId, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) } };
}

export function newInstallId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 中継の 1 日は UTC の日付で切り替わる（= 日本時間の午前 9 時）
export function nextRelayDay(now = Date.now()) {
  return (Math.floor(now / 86400e3) + 1) * 86400e3 + 5000;
}

export const LIMIT_RECHECK = 60 * 60e3;
export const RELAY_MODEL = 'jev-latest'; // 中継が使うモデル（覚え書きの鍵に使う）
export const relayDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const USE_KEY = 'ご自身の TypeSafe API キーを設定すれば使えます';
// 中継のエラーコード → { msg: ポップアップに出す文, pause: 休む ms（0 = 休まない）, retry: すぐ聞き直してよいか }
export function relayFailure(code, status, now = Date.now()) {
  const untilReset = nextRelayDay(now) - now;
  switch (code) {
    case 'free_tier_ended': return { msg: `無料枠は終了しました。${USE_KEY}。いまは何も隠していません`, pause: 60 * 60e3, retry: false };
    case 'free_tier_unavailable': return { msg: `無料枠はいま利用できません。${USE_KEY}。いまは何も隠していません`, pause: 15 * 60e3, retry: false };
    // 戻る時刻までまとめて休まない: 手元の時計が中継より進んでいると、戻った直後の断りで丸 1 日休んでしまう。1 時間ごとに 1 回だけ確かめる
    case 'user_limit': return { msg: `今日の無料枠を使い切りました。日本時間の午前 9 時に戻ります（${USE_KEY}）`, pause: Math.min(untilReset, LIMIT_RECHECK), retry: false };
    case 'ip_limit':
    case 'ip_ids': return { msg: `この回線からの無料枠の利用が上限に達しました。日本時間の午前 9 時に戻ります（${USE_KEY}）`, pause: Math.min(untilReset, LIMIT_RECHECK), retry: false };
    case 'forbidden': return { msg: '中継が要求を受け付けませんでした（拡張機能からの要求と認められませんでした）', pause: 15 * 60e3, retry: false };
    case 'bad_request': return { msg: '中継がこの文を受け付けませんでした', pause: 0, retry: false };
    case 'upstream_unreachable': return { msg: '中継から jev に接続できませんでした', pause: 0, retry: true };
    case 'upstream_error': return { msg: `jev が混雑しているか、エラーを返しました (HTTP ${status})`, pause: 0, retry: true };
    default: return { msg: `中継がエラーを返しました (HTTP ${status})`, pause: 0, retry: status === 408 || status === 429 || status >= 500 };
  }
}

export function budgetOf(headers) { // 応答ヘッダ → 今日の無料枠の残り（0〜1）。読めなければ null
  const left = Number(headers.get('x-budget-left-usd')), total = Number(headers.get('x-budget-total-usd'));
  return headers.get('x-budget-left-usd') !== null && Number.isFinite(left) && total > 0 ? Math.max(0, Math.min(1, left / total)) : null;
}

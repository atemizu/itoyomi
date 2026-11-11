// 文のかたまりを見つけて背景へ送り、返ってきた点数で隠す。
// - 対応サイトは SITES の規則で「投稿 1 件」を正確に取る。それ以外のページは generic.js の汎用検出。
// - 送るのは、画面の近くにしばらく留まったものだけ。1 ページあたりの送る速さにも上限がある（費用の歯止め）。
// - ページの DOM にノードは足さない。要素に data-jevh 属性を付けるだけ（見た目は content.css）。
(() => {
  const G = jevGeneric;
  const isTop = window.top === window;
  let sameOriginAsTop = isTop;
  if (!isTop) { try { sameOriginAsTop = !!window.top.location.href; } catch { sameOriginAsTop = false; } }

  // about:blank / srcdoc の枠は自分のホスト名が空。親のホストとして扱う（除外や安全側の網をすり抜けさせない）。
  let host = location.hostname;
  if (!host) { try { host = window.parent.location.hostname || window.top.location.hostname; } catch { host = ''; } }
  host = host.replace(/\.$/, '');
  if (!host) return;
  let topHost = host;
  if (!isTop) {
    try {
      topHost = sameOriginAsTop ? window.top.location.hostname
        : new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname;
    } catch { topHost = host; }
  }

  const norm = (s) => (s || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[^\S\n]+/g, ' ').replace(/ ?\n[ \n]*/g, '\n').trim();
  // 要素の文字を、段落や改行の切れ目を保って取る（textContent だと段落がくっつき、innerText は隠した後に変わる）
  const BREAK = new Set(['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'dd', 'dt', 'section']);
  function textOf(el) {
    let out = '';
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          // 改行をそのまま見せている要素（white-space: pre-wrap など）の改行は残す
          const pre = c.data.includes('\n') && n.nodeType === 1 && /^pre/.test(getComputedStyle(n).whiteSpace);
          out += pre ? c.data.replace(/[^\S\n]+/g, ' ') : c.data.replace(/\s+/g, ' ');
        }
        else if (c.nodeType === 1) {
          const ln = c.localName;
          if (ln === 'br') { out += '\n'; continue; }
          if (ln === 'script' || ln === 'style' || ln === 'template') continue;
          const b = BREAK.has(ln);
          if (b) out += '\n';
          walk(c);
          if (b) out += '\n';
        }
      }
    })(el);
    return norm(out);
  }

  // 規則: post = 投稿 1 件の要素 / text = その中の本文（複数なら改行でつなぐ） / textFn = 本文を取る関数
  //       self = 本文の指定に当たらなければ要素自身の文字 / compact = 行の一覧用の小さいラベル（チャット。急がない扱いで送る）
  //       fixedRow = 1 行の高さが決まっている一覧（消さずにたたむ）
  const threadsText = (el) => [...el.querySelectorAll('span[dir="auto"]:not([translate]):not(:has(time)) > span')]
    .filter((s) => !s.closest('a,[role="button"]')).map((s) => textOf(s)).filter(Boolean).join('\n');
  const MASTODON = [
    { post: 'article[data-variant], div.status[data-id], .detailed-status', text: '[class*="status_content__text"], .status__content__text' },
  ];
  const SITES = [
    { host: /(^|\.)(x|twitter)\.com$/, rules: [
      { post: 'article[data-testid="tweet"]', text: '[data-testid="tweetText"]' },
      { post: 'main article:not([data-testid])', text: 'div[dir="auto"]' }, // ログインしていないときの画面
    ] },
    { host: /(^|\.)bsky\.app$/, rules: [{ post: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]', text: '[data-testid="postText"], div[data-word-wrap="1"]' }] },
    { host: /(^|\.)youtube\.com$/, rules: [
      { post: 'ytd-comment-view-model', text: '#content-text' }, // 動画・ショートのコメントと返信
      { post: 'ytd-backstage-post-thread-renderer', text: 'ytd-backstage-post-renderer #content-text' }, // コミュニティ投稿
      { post: 'yt-live-chat-text-message-renderer', text: '#message', compact: true }, // ライブチャット（/live_chat の枠の中）
      { post: 'ytd-rich-item-renderer', text: '.ytLockupMetadataViewModelTitle, h3.shortsLockupViewModelHostMetadataTitle, #video-title' },
      { post: 'ytd-watch-next-secondary-results-renderer yt-lockup-view-model', text: '.ytLockupMetadataViewModelTitle' },
      { post: 'ytd-video-renderer', text: '#video-title' },
      { post: 'grid-shelf-view-model .ytGridShelfViewModelGridShelfItem', text: 'h3.shortsLockupViewModelHostMetadataTitle' }, // 検索結果のショート
      { post: 'ytm-comment-renderer', text: 'p.YtmCommentRendererText' }, // m.youtube.com
      { post: 'ytm-video-with-context-renderer', text: 'h3.media-item-headline' },
    ] },
    { host: /^www\.nicovideo\.jp$/, nico: true, rules: [
      { post: 'section:has(> header [aria-label^="コメントリスト"]) div[data-index]', text: 'p[tabindex="0"]' },
      { post: 'div[data-decoration-video-id][data-anchor-href^="/watch/"]', text: 'a.lc_2, div.lc_1' },
    ] },
    { host: /^live\.nicovideo\.jp$/, rules: [{ post: '.comment-panel [role="row"][data-comment-type]', text: '.comment-text', compact: true, fixedRow: true }] },
    { host: /^dic\.nicovideo\.jp$/, rules: [{ post: 'dd.st-bbs_resbody', text: '.bbs_resbody_inner' }], generic: true },
    { host: /(^|\.)reddit\.com$/, rules: [
      { post: 'article:has(> shreddit-post), shreddit-post:not(article > shreddit-post)', text: 'shreddit-post > [slot="title"], [id^="t3_"][id$="-post-rtjson-content"]' },
      { post: 'shreddit-comment > [slot="comment"], shreddit-comment-lite > [slot="comment"]', self: true }, // 返信は兄弟なので巻き込まない
      { post: 'div.thing.link', text: 'a.title, .expando .usertext-body .md' }, // old.reddit.com
      { post: 'div.thing.comment > .entry', text: '.usertext-body .md' },
    ] },
    { host: /^news\.yahoo\.co\.jp$/, rules: [{ post: 'article:has(> div > button[aria-label*="報告"])', text: ':scope > div > p' }] },
    { host: /(^|\.)5ch\.(net|io)$/, rules: [{ post: 'div.post[data-id]', text: '.post-content' }] },
    { host: /(^|\.)open2ch\.net$/, rules: [{ post: '.thread dl[val]', text: ':scope > dd.mesg.body' }] },
    { host: /^news\.ycombinator\.com$/, rules: [{ post: 'tr.athing.comtr td.default', text: '.commtext' }, { post: 'table.fatitem', text: '.toptext' }] },
    { host: /(^|\.)threads\.(com|net)$/, rules: [{ post: 'div[data-pressable-container]', textFn: threadsText }] },
    { host: /^togetter\.com$/, rules: [{ post: 'div.list_box.type_tweet', text: 'p.tweet' }], generic: true },
  ];

  // 汎用検出を自動では使わないホスト（個人的な文面が出やすい所）。設定の「使わないサイト」とは別の安全側の網。
  // 登録ドメインより左のラベルだけを見る（.id / .my のような国別ドメインを巻き込まない）。
  function privateHost(h) {
    if (!h.includes('.') || /^[\d.]+$/.test(h) || h.startsWith('[') || /\.(local|internal|lan|home|corp|test|localhost)$/.test(h)) return true;
    const L = h.split('.'), n = L.length;
    const drop = n >= 3 && L[n - 1].length === 2 && /^(co|com|ne|or|ac|go|gr|ed|lg|net|org|gov|edu)$/.test(L[n - 2]) ? 3 : 2;
    const sub = L.slice(0, Math.max(0, n - drop)), reg = L[Math.max(0, n - drop)] || '';
    const WORD = /^(id|my|pay|payments|card|auth|sso|mail|webmail|portal|console|admin|account|accounts|myaccount|login|signin|secure|member|members|mypage|chat|messages|messenger|ib|direct|netbank|bank|wallet|vpn|intra|intranet|passwords)$/;
    const PART = /^(bank|login|signin|webmail|netbk|intranet|mypage|secure|card|sec)$/;
    if (sub.some((l) => WORD.test(l) || l.split('-').some((p) => PART.test(p)))) return true;
    return /bank|ginko|shinkin|netbk|securities|kabu|-sec$|-card$/.test(reg);
  }
  const hostIsPrivate = privateHost(host) || privateHost(topHost);

  const CATS = ['attack', 'divisive', 'quarrel'];
  const CAT_LABEL = { attack: '攻撃・侮辱', divisive: '煽り・分断', quarrel: '口論' };
  const DEFAULTS = { enabled: true, threshold: globalThis.JEV_THRESHOLD, mode: 'collapse', cats: { attack: true, divisive: true, quarrel: true }, generic: true, nicoDanmaku: true, exclude: globalThis.JEV_DEFAULT_EXCLUDE };
  const MAX_TEXT = 3000;
  const DWELL_MS = 400; // 画面の近くにこれだけ留まったら送る（勢いよく通り過ぎた分は送らない）
  const SETTLE_MS = 1500; // 文が書き換わった要素は、これだけ落ち着いてから送る
  const BUCKET = { cap: 40, perSec: 3 }; // 1 ページが送れる速さ
  const SCORE_CACHE_MAX = 3000;
  const RETRY_MS = 45000;

  let settings = DEFAULTS;
  let site = SITES.find((s) => s.host.test(host)) || null;
  let postSel = '';
  const state = new WeakMap(); // 要素 -> { text, key, scores, sent, opt, notBefore, chg }
  const scored = new Set(); // 点数の付いた要素（設定が変わったときに塗り直す）
  const due = new Map(); // 画面の近くにあって、まだ送っていない要素 -> 送ってよい時刻
  const failed = new Set(); // 判定に失敗した要素（あとで聞き直す）
  const genericEls = new Set(); // 汎用検出で追っている要素
  const scoreCache = new Map(); // 本文 -> 点数（描き直された同じ投稿を聞き直さない）
  const pending = new Map(); // 本文 -> 問い合わせ中の Promise（同じ文を同時に 2 回聞かない）
  const revealed = new Set(); // 自分で開いた本文
  const counted = new Set(); // 「隠した」に数えた本文
  let alive = true;
  let tokens = BUCKET.cap, tokenAt = Date.now();

  const send = (msg) => {
    if (!alive) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      alive = false; // 拡張機能が更新・再読み込みされた
      return Promise.resolve(null);
    }
  };

  // 聞く価値のない文は空にする: 短すぎ・同じ字の繰り返し（「www」「8888」）・宛先だけ・記号だらけ（AA）
  const CJK = /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uFF66-\uFF9F]/;
  function usable(text) {
    const body = text.replace(/(^|\s)@[^\s@]+/gu, ' ');
    const letters = body.replace(/[^\p{L}\p{N}]/gu, '');
    const cjk = CJK.test(letters);
    if (letters.length < (cjk ? 2 : 4) || new Set(letters).size < (cjk ? 2 : 3)) return '';
    if (text.length >= 40) { // 長いのに字がまばら = アスキーアート。短い文の「！！！」や絵文字は対象にしない
      const dense = body.replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
      if (dense.length && body.replace(/[^\p{L}\p{N}\p{M}]/gu, '').length / dense.length < 0.5) return '';
    }
    let t = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
    if (t.toWellFormed) t = t.toWellFormed(); // 絵文字の途中で切れた半端な符号を残さない
    return t;
  }

  const hostMatch = (h, x) => x && (h === x || h.endsWith('.' + x));
  const excluded = () => (settings.exclude || []).some((x) => hostMatch(host, x) || hostMatch(topHost, x));
  const active = () => settings.enabled && !excluded();
  // ログイン画面らしさ: 見えているパスワード欄がある（1 秒だけ覚えておく）
  let pwAt = 0, pwSeen = false;
  function loginPage() {
    const now = Date.now();
    if (now - pwAt < 1000) return pwSeen;
    pwAt = now; pwSeen = false;
    const docs = [document];
    if (!isTop && sameOriginAsTop) { try { docs.push(window.top.document); } catch {} }
    for (const d of docs) for (const i of d.querySelectorAll('input[type="password"], input[autocomplete~="current-password"], input[autocomplete~="new-password"], input[autocomplete~="one-time-code"]')) if (!i.checkVisibility || i.checkVisibility()) { pwSeen = true; return true; }
    return false;
  }
  // 汎用検出: 対応サイトでない・除外でない・個人的らしいホストでない・ログイン画面でない・親と別オリジンの枠（広告など）でない
  const genericStatic = () => active() && settings.generic && (!site || site.generic) && sameOriginAsTop
    && !hostIsPrivate && document.designMode !== 'on' && !(document.body && document.body.isContentEditable); // 枠まるごとのエディタ
  const genericOk = () => genericStatic() && !loginPage();
  const allowed = (st) => (st.opt.generic ? genericOk() : active());

  function verdict(scores) {
    let top = null, score = 0;
    for (const c of CATS) if (settings.cats[c] && scores[c] > score) { top = c; score = scores[c]; }
    return { hide: top !== null && score >= settings.threshold, top, score };
  }
  const labelOf = (v) => `対立的な内容を隠しました（${CAT_LABEL[v.top]} ${Math.round(v.score * 100)}%）— クリックで表示`;

  function unhide(el) {
    if (el.hasAttribute('data-jevh')) { G.unhide(el); el.removeAttribute('data-jevc'); }
  }
  function apply(el) {
    const st = state.get(el);
    const v = st && st.scores && allowed(st) && !revealed.has(st.text) ? verdict(st.scores) : null;
    if (!v || !v.hide) { unhide(el); return; }
    const mode = settings.mode === 'remove' && !st.opt.fixedRow ? 'remove' : 'collapse';
    const label = labelOf(v);
    if (el.getAttribute('data-jevh') !== mode || el.getAttribute('data-jevh-label') !== label) {
      if (st.opt.compact) el.setAttribute('data-jevc', '');
      G.hide(el, label, mode, !!st.opt.generic);
    }
    if (!counted.has(st.text)) { counted.add(st.text); send({ type: 'hid', n: 1 }); }
  }

  const twins = new Map(); // 本文 -> その文を持って順番を待っている要素（答えが来たら全部に当てる）
  function remember(text, scores) {
    scoreCache.set(text, scores);
    if (scoreCache.size > SCORE_CACHE_MAX) scoreCache.delete(scoreCache.keys().next().value);
    const set = twins.get(text);
    if (!set) return;
    twins.delete(text);
    for (const el of set) {
      const st = state.get(el);
      if (!st || st.text !== text || st.scores || !el.isConnected) continue;
      st.scores = scores; st.sent = true;
      due.delete(el); io.unobserve(el); scored.add(el);
      apply(el);
    }
  }
  // 同じ文は 1 回だけ背景に聞く
  function ask(text, low) {
    const c = scoreCache.get(text);
    if (c) return Promise.resolve({ scores: c });
    let p = pending.get(text);
    if (!p) {
      p = send({ type: 'judge', text, low }).then((r) => { if (r && r.scores) remember(text, r.scores); return r; }).finally(() => pending.delete(text));
      pending.set(text, p);
    }
    return p;
  }

  let retryTimer = null;
  let dayTimer = null;
  function rearm() { // 失敗した要素を、画面の近くにあれば聞き直せる状態に戻す
    clearTimeout(retryTimer); retryTimer = null;
    for (const el of failed) { if (el.isConnected && state.get(el)) io.observe(el); }
    failed.clear();
  }
  function request(el) {
    const st = state.get(el);
    if (!st || st.sent || !st.text) return;
    st.sent = true;
    ask(st.text, !!st.opt.compact).then((r) => {
      if (state.get(el) !== st) return;
      if (!r || !r.scores) {
        st.sent = false;
        if (alive && el.isConnected) {
          failed.add(el);
          // キーなし・上限などは設定が変わるまで待つ。それ以外は少し置いて聞き直す
          if (r && r.fatal) armDay(); else if (!retryTimer) retryTimer = setTimeout(rearm, RETRY_MS);
        }
        return;
      }
      st.scores = r.scores;
      scored.add(el);
      apply(el);
    });
  }

  function armDay() { // 1 日の上限で止まったものは、日付が変わったら聞き直す
    if (dayTimer) return;
    const n = new Date(); const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5);
    dayTimer = setTimeout(() => { dayTimer = null; refresh(); }, next - n);
  }

  // 送る番: 留まった時間・落ち着いた時間・送る速さの上限を満たしたものから
  let pumpTimer = null;
  function pump() {
    pumpTimer = null;
    const now = Date.now();
    tokens = Math.min(BUCKET.cap, tokens + ((now - tokenAt) / 1000) * BUCKET.perSec); tokenAt = now;
    let waiting = false;
    for (const [el, t] of due) {
      const st = state.get(el);
      if (!st || !el.isConnected || st.sent) { due.delete(el); continue; }
      if (!allowed(st)) continue; // 設定が戻れば refresh() が回し直す
      if (t > now || tokens < 1) { waiting = true; continue; }
      tokens -= 1;
      due.delete(el); io.unobserve(el);
      request(el);
    }
    if (waiting) pumpTimer = setTimeout(pump, 200);
  }
  const kick = () => { if (!pumpTimer) pumpTimer = setTimeout(pump, 200); };

  const io = new IntersectionObserver((ents) => {
    const now = Date.now();
    for (const e of ents) {
      const el = e.target, st = state.get(el);
      if (!e.isIntersecting || !st) { due.delete(el); continue; }
      due.set(el, Math.max(now + DWELL_MS, st.notBefore || 0));
    }
    if (due.size) kick();
  }, { rootMargin: '100% 0px' }); // scrollMargin は足さない: ページ全体が「近い」扱いになり、歯止めが効かなくなる（実測）

  function untrack(el) {
    unhide(el);
    io.unobserve(el); due.delete(el); failed.delete(el); scored.delete(el); genericEls.delete(el); state.delete(el);
  }

  const keyOf = (text) => text.replace(/[\d\s]+/g, ''); // 数字だけが動く文（カウンタ・時刻）は同じ文として扱う
  function track(el, text, opt) {
    const st = state.get(el);
    const key = keyOf(text);
    if (st && (st.text === text || (text && st.key === key))) return;
    const now = Date.now();
    const next = { text, key, scores: null, sent: false, opt, notBefore: 0, chg: null };
    if (st && st.text) { // 文が書き換わった。落ち着くまで待ち、書き換わり続ける要素は相手にしない
      const c = st.chg && now - st.chg.t0 < 60000 ? { n: st.chg.n + 1, t0: st.chg.t0 } : { n: 1, t0: now };
      next.chg = c;
      next.notBefore = now + SETTLE_MS;
    }
    state.set(el, next);
    scored.delete(el); due.delete(el); failed.delete(el); io.unobserve(el);
    unhide(el); // 中身が入れ替わった要素の古い目隠しを外す
    if (!text) return;
    const c = scoreCache.get(text);
    if (c) { next.scores = c; next.sent = true; scored.add(el); apply(el); return; }
    if (next.chg && next.chg.n > 3) {
      if (opt.generic) return; // 汎用検出: 書き換わり続ける文（時計・打ちかけの下書きの写しなど）は相手にしない
      next.notBefore = now + Math.min(60000, SETTLE_MS * 2 ** (next.chg.n - 3)); // 使い回される行: 間を空けて聞く
    }
    let set = twins.get(text);
    if (!set) twins.set(text, set = new Set());
    set.add(el);
    io.observe(el);
  }
  const prune = () => {
    for (const s of [scored, genericEls, failed]) for (const el of s) if (!el.isConnected) s.delete(el);
    if (twins.size > 2000) twins.clear();
  };

  // ---- 対応サイト ----
  function ruleText(el, r) {
    if (r.textFn) return r.textFn(el);
    const parts = [];
    let last = null;
    if (r.text) for (const n of el.querySelectorAll(r.text)) {
      if (last && last.contains(n)) continue; // 入れ子で当たったものは外側だけ
      if (n.closest(r.post) !== el) continue; // 中に入っている別の投稿（引用など）の文は取らない
      last = n;
      const t = textOf(n);
      if (t) parts.push(t);
    }
    if (!parts.length && r.self) return textOf(el);
    return parts.join('\n');
  }
  function scanSite() {
    if (!site || !active()) return;
    for (const r of site.rules) {
      let list;
      try { list = document.querySelectorAll(r.post); } catch { continue; }
      for (const el of list) track(el, usable(ruleText(el, r)), r);
    }
    prune();
  }
  // 答えを覚えている投稿が描き直されたときは、描画の前にその場で隠す（一瞬見える、を避ける）
  function quick(recs) {
    if (!scoreCache.size || !postSel || !active()) return;
    const els = new Set();
    for (const rec of recs) {
      if (els.size > 60) break;
      const t = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
      const outer = t && t.closest(postSel); // 投稿の中身だけが差し替わった場合
      if (outer) els.add(outer);
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(postSel)) els.add(node);
        for (const el of node.querySelectorAll(postSel)) { els.add(el); if (els.size > 60) break; }
      }
    }
    for (const el of els) for (const r of site.rules) {
      if (!el.matches(r.post)) continue;
      const t = usable(ruleText(el, r));
      if (t && scoreCache.has(t)) track(el, t, r);
      break;
    }
  }
  let siteTimer = null, siteObserver = null;
  function startSite() {
    if (siteObserver || !site || !document.documentElement) return;
    try { postSel = site.rules.map((r) => r.post).join(','); document.querySelector(postSel); } catch { postSel = ''; }
    siteObserver = new MutationObserver((recs) => {
      quick(recs);
      if (siteTimer) return;
      siteTimer = setTimeout(() => { siteTimer = null; scanSite(); }, 300);
    });
    siteObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scanSite();
  }

  // ---- それ以外の全ページ（汎用検出） ----
  let watcher = null;
  const GENERIC_OPT = { generic: true };
  // 打っている最中の文（とその写し = プレビュー）は送らない
  const lettersOf = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
  let draft = '', draftAt = 0;
  document.addEventListener('input', (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    const v = t && (typeof t.value === 'string' ? t.value : t.isContentEditable ? t.textContent : '');
    draft = lettersOf(String(v || '').slice(-20000)); draftAt = Date.now();
  }, true);
  function isDraft(text) {
    if (!draft || Date.now() - draftAt > 120000) return false;
    const l = lettersOf(text);
    return l.length >= 6 && draft.includes(l.slice(0, 40));
  }
  let loginTimer = null;
  function waitLogin() { // ログイン画面が消えたら（モーダルを閉じた等）調べ直す
    if (loginTimer) return;
    loginTimer = setInterval(() => {
      if (!genericStatic()) { clearInterval(loginTimer); loginTimer = null; return; }
      if (loginPage()) return;
      clearInterval(loginTimer); loginTimer = null;
      if (watcher) { watcher.stop(); watcher = null; }
      syncGeneric(); kick();
    }, 2000);
  }
  function onUnits(units, roots) {
    if (!genericOk()) { if (genericStatic()) waitLogin(); return; }
    const now = new Set(units.map((u) => u.el));
    for (const r of roots) { // 調べ直した範囲で、もう「かたまり」でなくなった要素の目隠しを外す
      if (r.nodeType !== 1) continue;
      for (const h of [r, ...r.querySelectorAll('[data-jevh]')]) {
        const st = state.get(h);
        if (st && st.opt.generic && !now.has(h)) untrack(h);
      }
    }
    for (const u of units) {
      const st = state.get(u.el);
      if (st && !st.opt.generic) continue; // 対応サイトの規則が持っている要素には触らない
      if (postSel && (u.el.closest(postSel) || u.el.querySelector(postSel))) continue; // 規則の投稿の中・外側も触らない
      if (isDraft(u.text)) continue;
      genericEls.add(u.el);
      track(u.el, usable(u.text), GENERIC_OPT);
    }
    prune();
  }
  function syncGeneric() {
    if (genericStatic()) {
      if (!watcher && document.body) watcher = G.watch(onUnits, { maxText: MAX_TEXT });
    } else if (watcher) {
      watcher.stop(); watcher = null;
      for (const el of [...genericEls]) untrack(el);
    }
  }

  // ---- ニコニコ動画の流れるコメント（canvas）。nico-main.js がページ側で受け渡しと描画の止めを担当 ----
  // 動画全体を一度に聞かない: 再生位置の少し先までを、再生に合わせて聞いていく。裏のタブでは聞かない。
  const NICO = { ahead: 120000, behind: 2000, workers: 4, perPage: 3000 };
  const nico = { gen: 0, scores: new Map(), lastBlock: '', queue: [], busy: 0, asked: 0, timer: null, path: '', stopped: false, stale: null };
  const nicoOn = () => active() && settings.nicoDanmaku;
  const nicoVideo = () => document.querySelector('video[data-name="video-content"]') || document.querySelector('video');
  const nicoTime = () => {
    const v = nicoVideo();
    if (nico.stale) { // 動画を移った直後は、前の動画の再生位置がまだ残っている。巻き戻るか 10 秒たつまでは 0 として扱う
      if (!v || v.currentTime < nico.stale.t - 0.5 || Date.now() - nico.stale.at > 10000) nico.stale = null; else return 0;
    }
    return v ? v.currentTime * 1000 : 0;
  };
  function nicoPostBlock() {
    const texts = [];
    if (nicoOn()) for (const [body, sc] of nico.scores) if (!revealed.has(norm(body)) && verdict(sc).hide) texts.push(body);
    const key = texts.join('\u0000');
    if (key === nico.lastBlock) return;
    nico.lastBlock = key;
    window.postMessage({ jev: 'blockset', texts }, location.origin);
    for (const t of texts) if (!counted.has(t)) { counted.add(t); send({ type: 'hid', n: 1 }); }
  }
  function nicoPump() {
    clearTimeout(nico.timer); nico.timer = null;
    if (!nicoOn() || !nico.queue.length || nico.stopped) return;
    if (document.hidden || nico.asked >= NICO.perPage) return;
    const gen = nico.gen, t = nicoTime(), now = Date.now();
    while (nico.busy < NICO.workers) {
      let best = -1;
      for (let i = 0; i < nico.queue.length; i++) {
        const q = nico.queue[i], v = q.vpos;
        if ((q.notBefore || 0) > now) continue;
        if (v >= t - NICO.behind && v <= t + NICO.ahead && (best < 0 || v < nico.queue[best].vpos)) best = i;
      }
      if (best < 0) break;
      const q = nico.queue.splice(best, 1)[0];
      nico.busy++;
      if (!q.tries) nico.asked++;
      ask(q.text, true).then((r) => {
        if (gen !== nico.gen) return; // 別の動画に移った。数え直し済み
        nico.busy--;
        if (r && r.scores) { for (const b of q.bodies) nico.scores.set(b, r.scores); nicoPostBlock(); nicoPump(); return; }
        nico.queue.push(q);
        if (r && r.fatal) { nico.stopped = true; armDay(); return; } // キーなし・上限。設定か日付が変わるまで聞かない
        q.tries = (q.tries || 0) + 1;
        if (q.tries >= 3) nico.queue.pop(); else q.notBefore = Date.now() + 60000; // その文だけ間を空ける
        nicoPump();
      });
    }
    if (nico.queue.length && !nico.timer) nico.timer = setTimeout(nicoPump, 5000); // 再生が進んだら続きを聞く
  }
  function nicoItems(items) {
    if (!Array.isArray(items)) return;
    const moved = nico.path !== location.pathname, v0 = nicoVideo();
    if (moved) { nico.asked = 0; nico.stale = v0 && v0.currentTime > 2 ? { t: v0.currentTime, at: Date.now() } : null; }
    nico.gen++; nico.scores = new Map(); nico.queue = []; nico.busy = 0; nico.stopped = false; nico.path = location.pathname;
    if (!nicoOn()) return; // 入れ直したら refresh() が取り直す
    const byText = new Map();
    for (const it of items.slice(0, 5000)) {
      if (!it || typeof it.body !== 'string' || it.body.length > 300) continue;
      const text = usable(norm(it.body));
      if (!text) continue;
      const c = scoreCache.get(text);
      if (c) { nico.scores.set(it.body, c); continue; }
      const v = Number(it.vposMs) || 0;
      const q = byText.get(text);
      if (q) { q.bodies.add(it.body); q.vpos = Math.min(q.vpos, v); } else byText.set(text, { text, bodies: new Set([it.body]), vpos: v });
    }
    nico.queue = [...byText.values()];
    nico.lastBlock = '\u0001'; // 前の動画の集合を必ず置き換える
    nicoPostBlock();
    nicoPump();
  }
  function startNico() {
    if (!site || !site.nico || !isTop) return;
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.origin !== location.origin || !e.data || e.data.jev !== 'comments') return;
      nicoItems(e.data.items);
    });
    document.addEventListener('visibilitychange', nicoPump);
    window.postMessage({ jev: 'hello' }, location.origin);
  }

  // ---- 共通 ----
  let wasNico = false;
  function refresh() {
    prune();
    for (const el of scored) apply(el);
    if (!active()) {
      for (const el of document.querySelectorAll('[data-jevh]')) unhide(el);
    } else {
      rearm();
      startSite(); scanSite();
    }
    syncGeneric();
    if (due.size) kick();
    if (site && site.nico && isTop) {
      const on = nicoOn();
      if (on && (!wasNico || nico.queue.length || nico.stopped)) window.postMessage({ jev: 'hello' }, location.origin); // 取り直して続きから
      else nicoPostBlock();
      wasNico = on;
    }
  }

  // たたんだ行のクリックで開く（サイト側のクリック処理には渡さない）
  document.addEventListener('click', (e) => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    const el = t instanceof Element && t.closest('[data-jevk], [data-jevh="collapse"]');
    if (!el || el.getAttribute('data-jevh') !== 'collapse') return; // 残してある入れ子の返信の中のクリックはサイトに任せる
    e.preventDefault();
    e.stopImmediatePropagation();
    const st = state.get(el);
    if (st) revealed.add(st.text);
    apply(el);
    if (site && site.nico && isTop) nicoPostBlock();
  }, true);

  const merge = (s) => ({ ...DEFAULTS, ...(s || {}), cats: { ...DEFAULTS.cats, ...((s || {}).cats || {}) }, exclude: globalThis.jevExclude(s), threshold: globalThis.jevThreshold(s) });
  chrome.storage.local.get('settings').then((s) => {
    settings = merge(s.settings);
    if (!site && !hostIsPrivate && document.getElementById('mastodon')) site = { rules: MASTODON }; // Mastodon はホストが無数にあるので画面で見分ける
    wasNico = nicoOn();
    startSite(); syncGeneric(); startNico();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) { settings = merge(ch.settings.newValue); refresh(); } else if (ch.apiKey) refresh();
  });
})();

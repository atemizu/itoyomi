// どのページでも使える「文のかたまり」の検出と、要素を足さない目隠し。
// findBlocks: 文字のノードから一番近いブロック要素へ上がり、段落の集まりは 1 つの投稿にまとめる。
// hide/unhide: 属性と（必要なときだけ）数個のインライン style で隠す。ノードは足さない。
// 見た目の規則は content.css と下の CSS で同じもの（CSS はシャドウ DOM の中に入れるためだけに使う）。
// content.js より先に読み込まれ、同じ隔離ワールドの jevGeneric として使われる。
var jevGeneric = (() => {
  const set = (s) => new Set(s.split(' '));
  const SKIP_TAGS = set('script style noscript template pre textarea input select option datalist button label legend nav footer svg math canvas video audio iframe object embed head title time dialog menu summary rt rp th');
  const SKIP_SEL = [
    '[contenteditable]:not([contenteditable="false"])', '[aria-hidden="true"]', '[hidden]', '[inert]',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]', '[role="menu"]', '[role="menubar"]',
    '[role="menuitem"]', '[role="toolbar"]', '[role="tablist"]', '[role="tab"]', '[role="button"]', '[role="textbox"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="tooltip"]', '[role="dialog"]', '[role="alertdialog"]',
    '[role="status"]', '[role="timer"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="tree"]', '[role="complementary"]',
    '.CodeMirror', '.cm-editor', '.monaco-editor', '.ace_editor', '.ProseMirror', '.ql-editor', '.hljs', '.highlight', '.blob-code', '[data-lexical-editor]', '[data-slate-editor]',
    '.reflist', '.references', '.mw-references-wrap', '[role="doc-endnotes"]', '[role="doc-bibliography"]', '[role="note"]', '.hatnote',
    '.sr-only', '.visually-hidden', '.screen-reader-text',
  ].join(',');
  const CHROME_RE = /(?:^|[\s_-])(?:nav|navbar|navigation|menu|breadcrumbs?|sidebar|footer|toolbar|cookies?|consent|pagination|pager|share|social|advert|sponsored)(?:$|[\s_-])/i;
  const INLINE = set('code kbd samp a span b i em strong u s small sub sup mark font abbr cite q bdi bdo var wbr img ruby del ins big tt dfn data');
  const FAST_INLINE = set('code kbd samp b i em strong u s small sub sup mark font abbr cite q bdi bdo var wbr ruby del ins big tt dfn');
  const FAST_BLOCK = set('p li td h1 h2 h3 h4 h5 h6 blockquote dd dt figcaption caption body html');
  const PROSE_BLOCK = set('p blockquote h1 h2 h3 h4 h5 h6 li');
  const PROSE_CHILD = new Set([...INLINE, ...set('p br blockquote ul ol hr h1 h2 h3 h4 h5 h6 pre code picture figure')]);
  const STOP = set('body html main table tbody thead tr ul ol dl');
  const NO_LIST_PARENT = set('li dd dt');
  const NEVER_UNIT = set('body html main');
  const STRICT = set('td dt figcaption caption');
  const CJK = /[぀-ヿ㐀-鿿가-힯]/;
  const NONWS = /\S/;
  // 短い暴言（「ぶん殴るぞ！！」= 5 字、"fuck you" = 7 字 2 語）も判定に回す。これより短いもの（2〜3 字）は、
  // 画面の部品の名前（「ホーム」「検索」）がほとんどなので拾わない。見出し・リンクだけの文は係数 f でさらに厳しくする。
  const longEnough = (letters, words, cjk, f, opt) =>
    (cjk ? letters >= opt.minCJK * f : letters >= opt.minLatin * f && words >= opt.minWords + (f > 1 ? 1 : 0));
  const OPT = { maxUnit: 1500, maxUnitDirect: 3000, hardMax: 3000, repeatMin: 4, repeatMaxLen: 60, maxText: 3000, minCJK: 4, minLatin: 7, minWords: 2, minChars: 4, strictFactor: 2.5, linkTitles: true, classHeuristic: true, checkVisible: true };

  const blockCache = new WeakMap();
  function isBlock(e) {
    const ln = e.localName;
    if (FAST_INLINE.has(ln)) return false;
    if (FAST_BLOCK.has(ln)) return true;
    let r = blockCache.get(e);
    if (r === undefined) {
      const d = getComputedStyle(e).display;
      // inline-block div etc. = a box (cards, columns). inline-block span / a = a badge inside a sentence.
      r = d === 'inline' || d === 'contents' || d.startsWith('ruby') ? false : d.startsWith('inline-') ? !INLINE.has(ln) : true;
      blockCache.set(e, r);
    }
    return r;
  }
  const up = (e) => e.parentElement || (e.parentNode && e.parentNode.host) || null;
  function blockOf(e) {
    while (e && !isBlock(e)) e = up(e);
    return e;
  }
  function skipEl(n, opt) {
    const ln0 = n.localName;
    if (SKIP_TAGS.has(ln0)) return true;
    if ((ln0 === 'header' || ln0 === 'aside') && !n.closest('article,main,[role="main"]')) return true;
    if (n.attributes.length === 0 || ln0 === 'body' || ln0 === 'html') return false; // body のクラス名でページ全体を捨てない
    if (n.matches(SKIP_SEL)) return true;
    if (opt.classHeuristic) {
      const c = n.getAttribute('class'), id = n.id;
      if ((c && c.length < 200 && CHROME_RE.test(c)) || (id && CHROME_RE.test(id))) return true;
    }
    const ln = n.localName;
    if ((ln === 'header' || ln === 'aside') && !n.closest('article,main,[role="main"]')) return true;
    return false;
  }
  function isProse(p, opt, lenCache) {
    if (!p || STOP.has(p.localName) || p.matches('[role="main"], [itemprop="articleBody"]')) return false; // 記事の本文まるごとを 1 件にしない
    let ev = false, direct = 0, paras = 0;
    for (let c = p.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        const ln = c.localName;
        if (!PROSE_CHILD.has(ln)) return false;
        if (ln === 'p' || ln === 'br') ev = true;
        if (ln === 'p' && ++paras > 8) return false;
      } else if (c.nodeType === 3) {
        const l = c.data.trim().length;
        if (l) { ev = true; direct += l; }
      }
    }
    if (!ev) return false;
    let len = lenCache.get(p);
    if (len === undefined) { len = p.textContent.length; lenCache.set(p, len); }
    return len <= (direct >= 8 ? opt.maxUnitDirect : opt.maxUnit);
  }
  function promote(b, opt, lenCache) {
    for (let i = 0; i < 3; i++) {
      let p = b.parentElement;
      if (!p) break;
      if (b.localName === 'li' && (p.localName === 'ul' || p.localName === 'ol')) {
        p = p.parentElement; // a list inside a body joins the body; nested lists (threads) do not
        if (!p || NO_LIST_PARENT.has(p.localName)) break;
      }
      if (!(PROSE_BLOCK.has(b.localName) || i > 0) || !isProse(p, opt, lenCache)) break;
      b = p;
    }
    return b;
  }

  const seen = new Map(), boiler = new Set();

  // findBlocks(root) -> [{ el, text }]   root: Element | Document | ShadowRoot (default document.body)
  function findBlocks(root, options) {
    const opt = Object.assign({}, OPT, options);
    root = root || document.body;
    if (root.nodeType === 9) root = root.body;
    if (!root) return [];
    const blocks = new Map();
    const parentBlock = new Map();
    const lenCache = new Map();
    const startEl = root.nodeType === 1 ? root : root.host;
    for (let e = startEl; e; e = up(e)) if (skipEl(e, opt)) return [];
    function rec(el) {
      let b = parentBlock.get(el);
      if (b === undefined) { b = blockOf(el); parentBlock.set(el, b); }
      if (!b) return null;
      let r = blocks.get(b);
      if (!r) { r = { el: b, parts: [], n: 0, links: new Map() }; blocks.set(b, r); }
      return r;
    }
    function walk(parent, link) {
      const pel = parent.nodeType === 1 ? parent : parent.host;
      for (let n = parent.firstChild; n; n = n.nextSibling) {
        const t = n.nodeType;
        if (t === 3) {
          const d = n.data;
          if (!NONWS.test(d)) { if (d.length) { const r0 = blocks.get(parentBlock.get(pel)); if (r0) r0.parts.push(' '); } continue; }
          const r = rec(pel);
          if (!r) continue;
          const s = d.replace(/\s+/g, ' ');
          r.parts.push(s); r.n += s.length;
          if (link) r.links.set(link, (r.links.get(link) || 0) + s.length);
        } else if (t === 1) {
          const ln = n.localName;
          if (ln === 'br') { const r0 = blocks.get(parentBlock.get(pel)); if (r0) r0.parts.push('\n'); continue; }
          if (skipEl(n, opt)) continue;
          const l2 = link || (ln === 'a' ? n : null);
          // In the extension, replace n.shadowRoot with (chrome.dom?.openOrClosedShadowRoot?.(n) || n.shadowRoot) to also reach closed roots (not tested).
          if (n.shadowRoot) { if (opt.onShadow) opt.onShadow(n.shadowRoot); walk(n.shadowRoot, l2); }
          walk(n, l2);
        }
      }
    }
    let link = null;
    for (let e = startEl; e; e = up(e)) if (e.localName === 'a') link = e;
    if (root.shadowRoot) walk(root.shadowRoot, link);
    walk(root, link);

    const units = new Map();
    for (const r of blocks.values()) {
      if (r.n === 0) continue;
      const u = promote(r.el, opt, lenCache);
      let g = units.get(u);
      if (!g) { g = { el: u, texts: [], n: 0, link: 0, top: 0, links: 0 }; units.set(u, g); }
      g.texts.push(r.parts.join('')); g.n += r.n;
      for (const c of r.links.values()) { g.link += c; g.links++; if (c > g.top) g.top = c; }
    }
    const out = [];
    for (const g of units.values()) {
      if (g.n < opt.minChars || g.n > opt.hardMax || NEVER_UNIT.has(g.el.localName)) continue;
      let text = g.texts.join('\n').replace(/[ \t]*\n[ \t\n]*/g, '\n').replace(/ {2,}/g, ' ').trim();
      const letters = text.replace(/[^\p{L}]/gu, '').length;
      const cjk = CJK.test(text);
      const words = cjk ? 99 : text.split(/\s+/).length;
      const ld = g.link / g.n;
      let f = STRICT.has(g.el.localName) ? opt.strictFactor : 1;
      if (ld >= 0.9) {
        // almost all link text: keep only when one long link dominates (headline / feed title)
        if (!opt.linkTitles || g.top / g.n < 0.6) continue;
        f = Math.max(f, 1.6);
      } else if (ld >= 0.6 && g.links >= 3) continue;
      if (!longEnough(letters, words, cjk, f, opt)) continue;
      if (letters / text.replace(/\s/g, '').length < 0.5) continue;
      // 自分で display:none にした要素は「見えない」扱いにしない（外しては隠し直す、の往復を防ぐ）
      if (opt.checkVisible && g.el.getAttribute('data-jevh') !== 'remove') {
        if (g.el.checkVisibility && !g.el.checkVisibility({ visibilityProperty: true })) continue;
        if (!g.el.hasAttribute('data-jevh')) { const rc = g.el.getBoundingClientRect(); if (rc.width <= 1 || rc.height <= 1) continue; } // 読み上げ専用の隠し文字
      }
      if (text.length > opt.maxText) text = text.slice(0, opt.maxText);
      out.push({ el: g.el, text });
    }
    // short digit-bearing templates repeated on the page ("222 名無しさん", "Latest comment: 11 months ago") = UI boilerplate
    if (!opt.repeatMin) return out;
    const keyOf = (t) => (t.length < opt.repeatMaxLen ? t.replace(/[\d\s]+/g, '') || null : null);
    for (const u of out) {
      const k = keyOf(u.text);
      if (!k || boiler.has(k)) continue;
      let a = seen.get(k);
      if (!a) seen.set(k, a = []);
      if (a.includes(u.el)) continue;
      a.push(u.el);
      if (a.length >= opt.repeatMin) {
        const live = a.filter((e) => e.isConnected);
        if (live.length >= opt.repeatMin) { boiler.add(k); seen.delete(k); } else seen.set(k, live);
      }
    }
    return out.filter((u) => { const k = keyOf(u.text); return !k || !boiler.has(k); });
  }

  // ---- hiding (no nodes inserted; attributes + at most a few inline style properties) ----
  const CSS = `
[data-jevh="remove"] { display: none !important; }
[data-jevh="collapse"] { font-size: 0 !important; line-height: 0 !important; letter-spacing: 0 !important; word-spacing: 0 !important; text-indent: 0 !important; min-height: 0 !important; cursor: pointer !important; }
[data-jevh="collapse"] > :not([data-jevk]) { display: none !important; }
[data-jevh="collapse"] > [data-jevk] { font-size: var(--jev-fs, 1rem) !important; line-height: var(--jev-lh, normal) !important; letter-spacing: normal !important; word-spacing: normal !important; cursor: auto !important; }
[data-jevh="collapse"]::before { all: initial !important; content: attr(data-jevh-label) !important; display: block !important; box-sizing: border-box !important; contain: inline-size !important; flex: 1 1 0% !important; -webkit-box-flex: 1 !important; min-width: 0 !important; grid-column: 1 / -1 !important; padding: 6px 10px !important; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif !important; color: rgb(113, 118, 123) !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; cursor: pointer !important; }
[data-jevh="collapse"]:hover::before { color: rgb(29, 155, 240) !important; }
[data-jevh="collapse"]::after, [data-jevh="collapse"]::marker { content: none !important; }
[data-jevh="collapse"]::first-letter, [data-jevh="collapse"]::first-line { all: unset !important; }
[data-jevh="collapse"][data-jevc]::before { padding: 2px 10px !important; font-size: 11px !important; }
`;
  let sheet = null;
  function installCss(rootNode) { // document or ShadowRoot
    if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); }
    if (!rootNode.adoptedStyleSheets.includes(sheet)) rootNode.adoptedStyleSheets = [...rootNode.adoptedStyleSheets, sheet];
  }
  const FREEZE = ['margin-left', 'margin-right', 'padding-left', 'padding-right', 'width'];
  function clearKeep(el) {
    for (const c of el.children) {
      if (!c.hasAttribute('data-jevk')) continue;
      c.removeAttribute('data-jevk'); c.style.removeProperty('--jev-fs'); c.style.removeProperty('--jev-lh');
      if (c.getAttribute('style') === '') c.removeAttribute('style');
    }
  }
  const savedStyle = new WeakMap(); // 要素 -> ページが元々インラインで持っていた値
  function unfreeze(el) {
    const s = el.getAttribute('data-jevs');
    if (!s) return;
    const sv = savedStyle.get(el) || {};
    for (const p of s.split(' ')) { if (sv[p] && sv[p][0]) el.style.setProperty(p, sv[p][0], sv[p][1]); else el.style.removeProperty(p); }
    savedStyle.delete(el);
    el.removeAttribute('data-jevs');
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  }
  function hide(el, label, mode, keepNested = true) {
    clearKeep(el); unfreeze(el); el.removeAttribute('data-jevh');
    const collapse = mode !== 'remove';
    if (collapse && keepNested) {
      // children that contain OTHER units (nested replies) stay visible; give them their pre-hide font size
      for (const c of el.children) {
        if (SKIP_TAGS.has(c.localName) || FAST_INLINE.has(c.localName) || c.localName === 'br') continue;
        if (!findBlocks(c, { checkVisible: false, repeatMin: 0 }).some((u) => u.el !== el && c.contains(u.el))) continue;
        const cs = getComputedStyle(c);
        c.style.setProperty('--jev-fs', cs.fontSize); c.style.setProperty('--jev-lh', cs.lineHeight);
        c.setAttribute('data-jevk', '');
      }
    }
    if (collapse) {
      const rn = el.getRootNode();
      if (rn instanceof ShadowRoot) { try { installCss(rn); } catch {} }
    }
    const cs0 = collapse ? getComputedStyle(el) : null;
    const before = collapse ? FREEZE.map((p) => cs0.getPropertyValue(p)) : null;
    el.setAttribute('data-jevh-label', label);
    el.setAttribute('data-jevh', collapse ? 'collapse' : 'remove');
    if (collapse) {
      // font-size:0 zeroes em-based indentation and lets shrink-to-fit boxes (td, flex item) collapse: pin what changed, in px
      const cs1 = getComputedStyle(el); const done = []; const sv = {};
      const pin = (p, v) => { sv[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; el.style.setProperty(p, v, 'important'); done.push(p); };
      FREEZE.forEach((p, i) => {
        if (cs1.getPropertyValue(p) === before[i]) return;
        pin(p, before[i]);
        if (p === 'width') pin('min-width', before[i]);
      });
      if (done.length) savedStyle.set(el, sv);
      if (done.length) el.setAttribute('data-jevs', done.join(' '));
    }
  }
  function unhide(el) {
    el.removeAttribute('data-jevh'); el.removeAttribute('data-jevh-label'); clearKeep(el); unfreeze(el);
  }

  // ---- incremental: onUnits(units, rescannedRoots, ms) ----
  function watch(onUnits, options) {
    const opt = Object.assign({}, OPT, options);
    const pending = new Set(); const roots = new WeakSet(); let timer = null;
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'characterData') pending.add(r.target);
        else for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) pending.add(n);
      }
      if (pending.size && !timer) timer = setTimeout(flush, opt.debounce || 300);
    });
    const observe = (rn) => { if (roots.has(rn)) return; roots.add(rn); mo.observe(rn, { childList: true, subtree: true, characterData: true }); };
    opt.onShadow = observe;
    function flush() {
      timer = null;
      const lenCache = new Map(); const tops = new Set();
      const full = pending.size > 300;
      if (!full) for (const n of pending) {
        if (!n.isConnected) continue;
        const el = n.nodeType === 1 ? n : (n.parentElement || (n.parentNode && n.parentNode.host));
        if (!el) continue;
        const b = n.nodeType === 1 && isBlock(n) ? n : blockOf(el);
        if (b) tops.add(n.nodeType === 1 && b === n ? (PROSE_BLOCK.has(n.localName) ? promote(n, opt, lenCache) : n) : promote(b, opt, lenCache));
      }
      pending.clear();
      const list = full ? [document.body] : [...tops].filter((t) => { for (let p = up(t); p; p = up(p)) if (tops.has(p)) return false; return true; });
      const t0 = performance.now(); let out = [];
      for (const t of list) out = out.concat(findBlocks(t, opt));
      onUnits(out, list, performance.now() - t0);
    }
    observe(document.documentElement);
    const t0 = performance.now();
    const first = findBlocks(document.body, opt);
    onUnits(first, [document.body], performance.now() - t0);
    return { stop() { mo.disconnect(); clearTimeout(timer); }, flush };
  }

  return { findBlocks, watch, hide, unhide, installCss, CSS, longEnough, OPT };
})();
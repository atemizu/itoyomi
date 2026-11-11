// ニコニコ動画のページ側（MAIN ワールド）で動く。拡張機能の API は使えないので、content.js と postMessage でやり取りする。
// 1. コメント取得 (nvcomment の threads) の応答を「読むだけ」。応答そのものは触らずに返すので、読み込みは遅れも壊れもしない。
// 2. content.js から届いた「隠す本文」の集合に当たるコメントは、canvas に描く段で描かない。
(() => {
  if (window.top !== window) return;
  const THREADS = /nvcomment\.nicovideo\.jp\/v1\/threads(\?|$)/;
  let blocked = new Set();
  let last = null;

  const post = () => { if (last) window.postMessage({ jev: 'comments', items: last }, location.origin); };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data) return;
    if (e.data.jev === 'hello') post(); // content.js が後から起きたとき用に、直近のコメントを渡し直す
    if (e.data.jev === 'blockset' && Array.isArray(e.data.texts)) {
      const s = new Set();
      for (const t of e.data.texts) {
        if (typeof t !== 'string') continue;
        s.add(t);
        // 複数行のコメントは行ごとに描かれるらしい。短い行は別の無関係なコメントと同じ文になりやすいので足さない
        for (const line of t.split('\n')) if (line.replace(/[^\p{L}\p{N}]/gu, '').length >= 6) s.add(line);
      }
      blocked = s;
    }
  });

  // コメントは画面に付いていない canvas に 1 件ずつ描かれてから合成される。そこだけを見る。
  for (const m of ['fillText', 'strokeText']) {
    const orig = CanvasRenderingContext2D.prototype[m];
    CanvasRenderingContext2D.prototype[m] = function (text) {
      if (blocked.size && typeof text === 'string' && !this.canvas.isConnected && blocked.has(text)) return;
      return orig.apply(this, arguments);
    };
  }

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (THREADS.test(url)) {
        p.then((r) => {
          if (!r.ok) return;
          r.clone().json().then((j) => {
            const items = [];
            for (const t of (j && j.data && j.data.threads) || []) {
              for (const c of t.comments || []) if (c && typeof c.body === 'string') items.push({ body: c.body, vposMs: c.vposMs });
            }
            last = items;
            post();
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch {}
    return p;
  };
})();

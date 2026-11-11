// 手元の中継 (8787) に当てて、上限の働きを確かめる。先に `npm run mock` と `npm run dev` を動かす。
const B = 'http://127.0.0.1:8787';
const hdr = (id) => ({ 'content-type': 'application/json', origin: 'chrome-extension://abc', 'x-install-id': id });
const rid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
const post = (id, text = 'こんにちは', h = hdr(id)) => fetch(B + '/v1/judge', { method: 'POST', headers: h, body: JSON.stringify({ text }) });
let bad = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'NG  ', m); if (!c) bad++; };

let r = await post(rid());
const j = await r.json();
ok(r.status === 200 && j.answers && j.answers.attack, '通る・TypeSafe の応答がそのまま返る');
ok(Number(r.headers.get('x-budget-left-usd')) < 0.1, '残りの予算が返る ' + r.headers.get('x-budget-left-usd'));

r = await fetch(B + '/v1/judge', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-install-id': rid() }, body: '{"text":"a"}' });
ok(r.status === 403, '拡張機能以外の Origin は断る');
r = await post('xyz'); ok(r.status === 400, '不正な ID は断る');
r = await fetch(B + '/v1/judge', { method: 'POST', headers: hdr(rid()), body: '{"state":"a","questions":{}}' }); ok(r.status === 400, 'text の無い要求（任意の質問）は断る');

// 1 人の上限: 1 件あたり約 $0.00084 → $0.1 までは約 120 件
const id = rid(); let n = 0, last;
while (n < 400) { last = await post(id); if (last.status !== 200) break; n++; }
const lj = await last.json();
ok(last.status === 429 && lj.error === 'user_limit', `1 人の上限で止まる (${n} 件目まで通った, ${lj.error})`);
ok(n > 100 && n < 140, '件数が見込み (約 120) の範囲');

// 同じ IP から新しい ID を大量に作る
let blocked = null;
for (let i = 0; i < 15; i++) { const x = await post(rid()); if (x.status !== 200) { blocked = (await x.json()).error; break; } }
ok(blocked === 'ip_ids' || blocked === 'ip_limit', '同じ IP の新規 ID / 合計で止まる: ' + blocked);
process.exit(bad ? 1 : 0);

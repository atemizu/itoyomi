// 公開した中継に実キーで当てる（本物の TypeSafe を呼ぶ。数件で $0.001 未満）
const U = process.argv[2];
const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
for (const text of ['あなたは本当に頭が悪いですね。黙って消えてください。', '今日は天気がいいので散歩してきました。', 'You people are all idiots, get out of this thread.']) {
  const r = await fetch(U + '/v1/judge', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://test', 'x-install-id': id }, body: JSON.stringify({ text }) });
  const j = await r.json();
  const p = j.answers ? Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, +(v.noul && v.noul.true != null ? v.noul.true : NaN).toFixed(2)])) : j;
  console.log(r.status, text.slice(0, 20), JSON.stringify(p), 'tokens', j.usage && j.usage.input_tokens, 'left', r.headers.get('x-budget-left-usd'));
}

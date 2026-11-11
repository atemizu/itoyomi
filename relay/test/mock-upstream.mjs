// TypeSafe の代わり（手元の試験用）。キーが "test-key" のときだけ通し、入力トークンは文字数から作る。
import http from 'node:http';
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); return res.end('{"detail":"bad key"}'); }
    const j = JSON.parse(b);
    const tokens = 20000 + j.state.length; // 1 件 約 $0.00084 になる（実際は測って決める）
    const answers = Object.fromEntries(Object.keys(j.questions).map((k) => [k, { type: 'noul', noul: { true: 0.1, false: 0.9 } }]));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: j.model, answers, usage: { input_tokens: tokens } }));
  });
}).listen(8788, () => console.log('mock on 8788'));

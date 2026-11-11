# jev-relay

Jev 対立フィルター → この中継 → TypeSafe。開発者が利用料を負担する「実験」のための窓口。
キーは中継の中にだけ置く。受け取るのは `{text}` だけで、質問文は中継が組む。本文は保存もログ出力もしない。

## 上限（wrangler.jsonc の vars）
- `PER_ID_USD` 0.1 … 1 人（インストール 1 つ）の 1 日の上限
- `PER_IP_USD` 0.5 / `MAX_IDS_PER_IP` 10 … 同じ IP の合計と、新しい ID の数（ID の作り直しへの備え）
- `ENABLED` "0" … 無料枠を止める（拡張機能には「無料枠は終了しました」が返る）
- 日は UTC 区切り（日本時間 午前 9 時に戻る）

## 手元で試す
```sh
npm run mock    # ダミーの TypeSafe（別の端末で）
npm run dev     # 中継（別の端末で）
npm run smoke   # 上限などの確認（8 項目）
```

## 公開する手順
1. https://dash.cloudflare.com/sign-up で無料のアカウントを作る（カードは不要）
2. `npx wrangler login`（ブラウザが開くので許可する）
3. `npx wrangler secret put TYPESAFE_API_KEY`（TypeSafe のキーを貼る。この中継専用に新しく発行したキーを使う）
4. `npm run deploy` → `https://jev-relay.<あなたの名前>.workers.dev` が出る
5. `curl https://jev-relay.<…>.workers.dev/health` で `{"ok":true,...}` を確認

## 止めたいとき
`wrangler.jsonc` の `ENABLED` を "0" にして `npm run deploy`。または TypeSafe のキーを無効にする。

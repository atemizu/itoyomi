# itoyomi

ネット上の攻撃・煽り・口論の文を、AI（TypeSafe の jev）が書き手の意図で見分けて隠すブラウザ拡張機能。

- `extension/` … Chromium 用の拡張機能（Manifest V3）。詳細は [extension/README.md](extension/README.md)
- `relay/` … 無料枠の中継（Cloudflare Workers）。開発者が TypeSafe の利用料を負担するための窓口。詳細は [relay/README.md](relay/README.md)

## 無料枠について
実験として開発者が利用料を負担しています。予告なく終了することがあります。
画面に出た文は、運営者の中継を経由して TypeSafe に送られます。開発者が内容を見られないよう、中継は文を保存せず、ログにも出さない作りにしています（`relay/src/index.js`）。
ただし、実際に動いている中継がこのコードと同一かどうかは、利用者の側からは確認できません。自分の TypeSafe API キーを設定すると、中継を通らず直接 TypeSafe に送られます。

## コードについて
このリポジトリのコードは AI（Claude）が書いたもので、全行を人手で検証したわけではありません。

TypeSafe 社とは無関係の非公式の拡張機能です。

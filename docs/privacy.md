---
title: itoyomi プライバシーポリシー
---

# itoyomi プライバシーポリシー

最終更新: 2026-11-11

itoyomi（以下「本拡張機能」）は、ウェブページ上の攻撃・煽り・口論の文を AI で判定して隠すブラウザ拡張機能です。本拡張機能が扱うデータについて説明します。ソースコードは <https://github.com/atemizu/itoyomi> で公開しています。

## 1. 送信するデータ

インストール後、最初に送るものと送り先を表示して同意を求めます。「同意して始める」を押すまで、文は一切送りません。

判定のため、開いているページのうち画面の近く（上下 1 画面ぶん）にある投稿・段落の文（1 件あたり最大 3,000 字）を送信します。

- **無料枠（API キー未設定・既定）**: 開発者が運営する中継（Cloudflare Workers、`jev-relay.ktjz8fmk7w.workers.dev`）を経由して、TypeSafe（`api.typesafe.ai`）に送信します。
- **自分の API キーを設定した場合**: 中継を通らず、直接 TypeSafe に送信します。

ページの URL・タイトル・Cookie・入力欄の中身、投稿者名などの付随情報を別に付けて送ることはありません。ただし、文そのものに名前などの個人情報が含まれている場合は、文の一部として送信されます。

## 2. 中継での扱い

開発者が内容を見られないよう、中継は受け取った文を保存せず、ログにも出さない作りにしています（`relay/src/index.js`）。ただし、実際に動いている中継が公開コードと同一かどうかは、利用者の側からは確認できません。

無料枠の 1 日の上限を管理するため、中継は次の値を使います。

- 拡張機能ごとのランダムな ID（入れ直すまで同じ値）
- IP アドレスから日ごとに作ったハッシュ値（元の IP アドレスは保存しません）

これらはその日の利用量の管理にだけ使い、約 36 時間で消去します。

Chrome ウェブストアのページで、本拡張機能が「位置情報」を扱うと表示されているのは、このためです。IP アドレスは 1 日の上限の管理だけに使い、地域の推定など位置を知る目的には使いません。

## 3. 端末内に保存するデータ

設定、今日の利用件数、API キー（任意）、上記のランダムな ID、判定結果の覚え書き（文のハッシュと点数）は、お使いのブラウザの中（`chrome.storage.local` と IndexedDB）にだけ保存し、開発者には送りません。

## 4. 第三者

- **TypeSafe**: 文の判定を行います。送信された文の取り扱いは、TypeSafe の規約とプライバシーポリシーに従います。
- **Cloudflare**: 中継を動かす基盤です。

データの販売、広告への利用、判定以外の目的での利用はしません。

本拡張機能によるユーザーデータの利用は、[Chrome Web Store ユーザーデータに関するポリシー](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)（Limited Use の要件を含む）に従います。

## 5. 対象外にするサイト

メール・チャット・AI チャット・銀行・証券・納税などのサイトは、既定で「使わないサイト」に入れてあり、文を送りません。それ以外のサイトでも、パスワード欄のあるページや銀行・ログインらしいホスト名は自動で避けますが、すべてを見分けられるわけではありません。見られたくない文が出るサイトは、設定の「使わないサイト」に追加してください。

## 6. 無料枠の終了

無料枠は、実験として開発者が利用料を負担しているもので、予告なく終了することがあります。

## 7. お問い合わせ

<https://github.com/atemizu/itoyomi/issues> へお寄せください。

---

## English summary

itoyomi sends text near the visible area of the page (up to 3,000 characters per item) to TypeSafe (`api.typesafe.ai`) to judge whether it is hostile. By default the text passes through a relay run by the developer on Cloudflare Workers; the relay does not store or log the text. With your own API key, text goes directly to TypeSafe. No URLs, titles, cookies, form inputs or separate author metadata are sent, though personal information contained in the text itself is sent as part of it. The relay uses a random install ID and a daily hashed IP value only to enforce daily limits and deletes them within about 36 hours. This is why the Chrome Web Store page lists "location" data: the IP address is used only for daily limits, never to determine your location. Settings and caches stay in your browser. Data is never sold or used for advertising. The use of information received from this extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Nothing is sent until you press "Agree and start" after installation. The free tier is an experiment funded by the developer and may end without notice. Contact: <https://github.com/atemizu/itoyomi/issues>

// 既定で「使わないサイト」。個人的な文面が出る所。content.js（ふつうのスクリプト）と jev.js（モジュール）の両方が読む。
globalThis.JEV_DEFAULT_EXCLUDE = [
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.co.jp', 'proton.me', 'icloud.com',
  'docs.google.com', 'drive.google.com', 'calendar.google.com', 'keep.google.com', 'messages.google.com',
  'chat.google.com', 'meet.google.com', 'accounts.google.com', 'myaccount.google.com',
  'web.whatsapp.com', 'web.telegram.org', 'messenger.com', 'slack.com', 'discord.com', 'teams.microsoft.com',
  'chatwork.com', 'zoom.us', 'notion.so', 'dropbox.com', 'onedrive.live.com', 'sharepoint.com', 'atlassian.net',
  'moneyforward.com', 'freee.co.jp', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'console.typesafe.ai',
  // ここから下は 3.0.0 で足した分（新しく足すときは必ず末尾に。途中に入れると、使っている人に届かない）
  'cloud.microsoft', 'office365.com', 'office.com', 'teams.live.com', 'fastmail.com', 'tuta.com',
  'copilot.microsoft.com', 'perplexity.ai', 'grok.com', 'poe.com', 'aistudio.google.com', 'notebooklm.google.com',
  'paypal.com', 'wise.com', 'notion.com', 'box.com',
  'mufg.jp', 'smbc.co.jp', 'mizuhobank.co.jp', 'sbisec.co.jp', 'monex.co.jp', 'rakuten-sec.co.jp',
  'smbc-card.com', 'rakuten-card.co.jp', 'saisoncard.co.jp', 'nta.go.jp', 'nenkin.go.jp',
];
globalThis.JEV_DEFAULT_BASE = 34; // 2.x までの既定の数（exSeen を持たない古い設定は、ここまでを見たものとして扱う）
// 保存された一覧に、その人がまだ見ていない既定を足す（自分で外した既定は戻さない）
globalThis.jevExclude = (s) => {
  const D = globalThis.JEV_DEFAULT_EXCLUDE;
  if (!s || !Array.isArray(s.exclude)) return D;
  const seen = new Set(Array.isArray(s.exSeen) ? s.exSeen : D.slice(0, globalThis.JEV_DEFAULT_BASE));
  const add = D.filter((h) => !seen.has(h) && !s.exclude.includes(h));
  return add.length ? [...s.exclude, ...add] : s.exclude;
};

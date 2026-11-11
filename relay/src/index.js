// Jev 対立フィルターの中継。拡張機能 → ここ → TypeSafe。
// 目的: 開発者が TypeSafe の利用料を負担する間、API キーを拡張機能に入れずに済ませ、1 人あたりの 1 日の上限をかける。
// 受け取るのは { text } だけ。質問文はここで組むので、汎用の LLM 窓口としては使えない。本文は保存もログ出力もしない。
import { DurableObject } from 'cloudflare:workers';
import Q from './questions.json';

const DAY = () => new Date().toISOString().slice(0, 10); // UTC の日付（日本時間の午前 9 時に切り替わる）
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const deny = (error, message, status = 429, extra = {}) => json({ error, message }, status, extra);

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 1 つの DO が「ある ID の 1 日分」か「ある IP の 1 日分」を数える。IP は日ごとに混ぜた値にして、生の IP は残さない。
export class Meter extends DurableObject {
  async check(kind, limitUsd, newId, maxIds) {
    const st = (await this.ctx.storage.get('s')) || { spent: 0, ids: [] };
    if (st.spent >= limitUsd) return { ok: false, reason: kind, spent: st.spent };
    if (kind === 'ip' && newId && !st.ids.includes(newId)) {
      if (st.ids.length >= maxIds) return { ok: false, reason: 'ip_ids', spent: st.spent };
      st.ids.push(newId);
      await this.ctx.storage.put('s', st);
      if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 36 * 3600e3);
    }
    return { ok: true, spent: st.spent };
  }
  async add(usd) {
    const st = (await this.ctx.storage.get('s')) || { spent: 0, ids: [] };
    st.spent += usd;
    await this.ctx.storage.put('s', st);
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 36 * 3600e3);
  }
  async alarm() { await this.ctx.storage.deleteAll(); } // 前の日の分は残さない
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true, enabled: env.ENABLED === '1', qv: Q.QUESTION_VERSION });
    if (url.pathname !== '/v1/judge' || req.method !== 'POST') return json({ error: 'not_found' }, 404);

    if (env.ENABLED !== '1') {
      return deny('free_tier_ended', '無料枠は終了しました。ご自身の TypeSafe API キーを設定すれば引き続き使えます。', 503);
    }
    // ブラウザの拡張機能から以外（ページ上のスクリプト等）は受けない。偽装は容易なので、本当の歯止めは下の上限
    const origin = req.headers.get('origin') || '';
    if (!/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) return deny('forbidden', '拡張機能からの要求ではありません', 403);

    const id = req.headers.get('x-install-id') || '';
    if (!/^[0-9a-f]{32}$/.test(id)) return deny('bad_request', 'X-Install-Id が不正です', 400);

    let body;
    try {
      const raw = await req.text();
      if (raw.length > 20000) return deny('bad_request', '大きすぎます', 413);
      body = JSON.parse(raw);
    } catch { return deny('bad_request', 'JSON ではありません', 400); }
    if (!body || typeof body.text !== 'string' || !body.text.trim()) return deny('bad_request', 'text がありません', 400);
    let text = body.text.slice(0, Q.MAX_TEXT);
    if (text.toWellFormed) text = text.toWellFormed();

    const perId = Number(env.PER_ID_USD), perIp = Number(env.PER_IP_USD), maxIds = Number(env.MAX_IDS_PER_IP);
    const day = DAY();
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const ipStub = env.METER.get(env.METER.idFromName(`ip:${day}:${await sha256hex(`${day}|${ip}`)}`));
    const idStub = env.METER.get(env.METER.idFromName(`id:${day}:${id}`));

    const [ipc, idc] = await Promise.all([ipStub.check('ip', perIp, id, maxIds), idStub.check('id', perId)]);
    if (!idc.ok) return deny('user_limit', '今日の無料枠の上限に達しました。日本時間の午前 9 時に戻ります。', 429, { 'retry-after': '3600' });
    if (!ipc.ok) return deny(ipc.reason === 'ip_ids' ? 'ip_ids' : 'ip_limit', 'この回線からの利用が多いため、今日はこれ以上受けられません。', 429, { 'retry-after': '3600' });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    let up, data = null;
    try {
      up = await fetch(env.UPSTREAM, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state: text, questions: Q.QUESTIONS }),
        signal: ctl.signal,
      });
      data = await up.json().catch(() => null);
    } catch {
      return deny('upstream_unreachable', 'jev に接続できませんでした', 504);
    } finally { clearTimeout(timer); }

    // こちらのキーや残高の問題を、利用者に詳しく見せない（開発者はダッシュボードで気づく）
    if (up.status === 401 || up.status === 402 || up.status === 403) {
      console.error('upstream', up.status); // 本文は出さない
      return deny('free_tier_unavailable', '無料枠は今使えません。ご自身の API キーを設定すれば使えます。', 503);
    }
    if (!up.ok) {
      const extra = {};
      const ra = up.headers.get('retry-after'); if (ra) extra['retry-after'] = ra;
      return json({ error: 'upstream_error', status: up.status }, up.status === 429 ? 429 : 502, extra);
    }

    const tokens = data && data.usage && Number(data.usage.input_tokens);
    const usd = (tokens > 0 ? tokens : 1500) * Number(env.PRICE_PER_MTOK) / 1e6; // usage が無いときは多めに数える
    ctx.waitUntil(Promise.all([ipStub.add(usd), idStub.add(usd)]));
    const left = Math.max(0, perId - idc.spent - usd);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-budget-left-usd': left.toFixed(4), 'x-budget-total-usd': String(perId) },
    });
  },
};

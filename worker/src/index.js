// ============================================================
// Web Push using Web Crypto API (Cloudflare Workers native)
// web-push ライブラリ不要 — crypto.createECDH エラーを回避
// ============================================================

function b64u(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
}

// VAPID JWT (ES256) をWeb Crypto APIで生成
async function createVapidJWT(endpoint, email, publicKeyB64u, privateKeyB64u) {
  const enc = new TextEncoder();
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const pld = b64u(enc.encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: email })));
  const msg = `${hdr}.${pld}`;
  const pub = b64uDecode(publicKeyB64u);
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: privateKeyB64u,
    x: b64u(pub.slice(1, 33)),
    y: b64u(pub.slice(33, 65)),
    ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(msg)));
  return `${msg}.${b64u(sig)}`;
}

// 空のプッシュ通知を送信（ペイロードなし → SW側のデフォルトメッセージを表示）
async function pushSend(subscription, email, pubKey, privKey) {
  const jwt = await createVapidJWT(subscription.endpoint, email, pubKey, privKey);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${pubKey}`,
      'TTL': '86400',
    },
  });
  if (res.status >= 400) {
    const err = new Error(`Push failed: ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
}

// ---- Worker ----

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    const url = new URL(request.url);

    // VAPID 公開鍵
    if (url.pathname === '/vapid-public-key' && request.method === 'GET') {
      return corsResponse({ key: env.VAPID_PUBLIC_KEY });
    }

    // Push 購読登録
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }
      const { subscription, reminderTime, timezone } = body;
      if (!subscription?.endpoint || !reminderTime) {
        return corsResponse({ error: 'subscription と reminderTime は必須です' }, 400);
      }
      await env.SUBSCRIPTIONS.put(
        subscription.endpoint,
        JSON.stringify({ subscription, reminderTime, timezone: timezone || 'Asia/Tokyo' }),
        { expirationTtl: 60 * 60 * 24 * 365 }
      );
      return corsResponse({ ok: true });
    }

    // Push 購読解除
    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      let body;
      try { body = await request.json(); } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }
      if (body.endpoint) await env.SUBSCRIPTIONS.delete(body.endpoint);
      return corsResponse({ ok: true });
    }

    // テスト通知（購読が届いているか確認用）
    if (url.pathname === '/test-push' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }
      const { endpoint } = body;
      if (!endpoint) return corsResponse({ error: 'endpoint required' }, 400);
      const raw = await env.SUBSCRIPTIONS.get(endpoint);
      if (!raw) return corsResponse({ error: 'not_registered' }, 404);
      const { subscription } = JSON.parse(raw);
      try {
        await pushSend(subscription, env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        return corsResponse({ ok: true });
      } catch (e) {
        if (e.statusCode === 410) {
          await env.SUBSCRIPTIONS.delete(endpoint);
          return corsResponse({ error: 'expired' }, 410);
        }
        return corsResponse({ error: e.message }, 500);
      }
    }

    // ---- 睡眠データ受信（本部管理用） ----
    if (url.pathname === '/sleep-record' && request.method === 'POST') {
      let body;
      try {
        const text = await request.text();
        body = JSON.parse(text);
      } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }
      const { userId, bedtime } = body;
      if (!userId || !bedtime) return corsResponse({ error: 'userId と bedtime は必須です' }, 400);
      const kvKey = `data:${userId}:${bedtime}`;
      await env.SUBSCRIPTIONS.put(kvKey, JSON.stringify({
        ...body,
        savedAt: new Date().toISOString(),
      }), { expirationTtl: 60 * 60 * 24 * 365 * 3 });
      return corsResponse({ ok: true });
    }

    // ---- CSVエクスポート（管理者専用） ----
    if (url.pathname === '/export.csv' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.EXPORT_SECRET || key !== env.EXPORT_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      const { keys } = await env.SUBSCRIPTIONS.list({ prefix: 'data:' });
      const rows = [];
      rows.push(['ユーザーID','生年月日','性別','日付','就寝時刻','起床時刻','睡眠時間(分)','睡眠タイプ','体調評価','就寝通知時間','保存日時'].join(','));
      for (const { name } of keys) {
        try {
          const raw = await env.SUBSCRIPTIONS.get(name);
          if (!raw) continue;
          const d = JSON.parse(raw);
          rows.push([
            d.userId, d.birthdate, d.gender, d.date,
            d.bedtime, d.waketime,
            d.duration_min != null ? d.duration_min : '',
            d.sleep_type, d.rating != null ? d.rating : '',
            d.reminder_time, d.savedAt,
          ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
        } catch {}
      }
      return new Response(rows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="sleep-data-${new Date().toISOString().slice(0,10)}.csv"`,
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  // cron: 毎分実行してリマインダー時刻と照合
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};

async function sendReminders(env) {
  const now = new Date();
  const { keys } = await env.SUBSCRIPTIONS.list();

  for (const { name: key } of keys) {
    if (key.startsWith('data:')) continue;
    try {
      const raw = await env.SUBSCRIPTIONS.get(key);
      if (!raw) continue;
      const { subscription, reminderTime, timezone } = JSON.parse(raw);

      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Tokyo',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      const hh = parts.find(p => p.type === 'hour')?.value ?? '00';
      const mm = parts.find(p => p.type === 'minute')?.value ?? '00';
      const localHHMM = `${hh}:${mm}`;

      if (localHHMM === reminderTime) {
        await pushSend(subscription, env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      }
    } catch (e) {
      if (e.statusCode === 410) {
        await env.SUBSCRIPTIONS.delete(key);
      } else {
        console.error('Push 送信エラー:', key, e.message);
      }
    }
  }
}

function corsResponse(body, status = 200) {
  return new Response(
    body !== null ? JSON.stringify(body) : null,
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    },
  );
}

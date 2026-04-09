import webpush from 'web-push';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    const url = new URL(request.url);

    // VAPID 公開鍵の取得
    if (url.pathname === '/vapid-public-key' && request.method === 'GET') {
      return corsResponse({ key: env.VAPID_PUBLIC_KEY });
    }

    // プッシュ通知の購読登録
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }

      const { subscription, reminderTime, timezone } = body;
      if (!subscription?.endpoint || !reminderTime) {
        return corsResponse({ error: 'subscription と reminderTime は必須です' }, 400);
      }

      await env.SUBSCRIPTIONS.put(
        subscription.endpoint,
        JSON.stringify({ subscription, reminderTime, timezone: timezone || 'Asia/Tokyo' }),
        { expirationTtl: 60 * 60 * 24 * 365 } // 1年
      );
      return corsResponse({ ok: true });
    }

    // 購読解除
    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      let body;
      try {
        body = await request.json();
      } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }
      if (body.endpoint) {
        await env.SUBSCRIPTIONS.delete(body.endpoint);
      }
      return corsResponse({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  },

  // cron トリガー: 毎分実行してリマインダー時刻と照合
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};

async function sendReminders(env) {
  webpush.setVapidDetails(
    env.VAPID_EMAIL,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );

  const now = new Date();
  const { keys } = await env.SUBSCRIPTIONS.list();

  for (const { name: key } of keys) {
    try {
      const raw = await env.SUBSCRIPTIONS.get(key);
      if (!raw) continue;

      const { subscription, reminderTime, timezone } = JSON.parse(raw);

      // ユーザーのタイムゾーンでの現在時刻を取得
      const localHHMM = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      if (localHHMM === reminderTime) {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: '神睡眠トラッカー',
            body: 'そろそろ眠る時間ですよ 🌙',
          }),
        );
      }
    } catch (e) {
      // 410: 購読期限切れ → KVから削除
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

import webpush from 'web-push';

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
      }), { expirationTtl: 60 * 60 * 24 * 365 * 3 }); // 3年保存

      return corsResponse({ ok: true });
    }

    // ---- CSVエクスポート（管理者専用） ----
    if (url.pathname === '/export.csv' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.EXPORT_SECRET || key !== env.EXPORT_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }

      // data: プレフィックスのキーを全取得
      const { keys } = await env.SUBSCRIPTIONS.list({ prefix: 'data:' });
      const rows = [];
      rows.push(['ユーザーID','生年月日','性別','日付','就寝時刻','起床時刻','睡眠時間(分)','睡眠タイプ','体調評価','保存日時'].join(','));

      for (const { name } of keys) {
        try {
          const raw = await env.SUBSCRIPTIONS.get(name);
          if (!raw) continue;
          const d = JSON.parse(raw);
          rows.push([
            d.userId    || '',
            d.birthdate || '',
            d.gender    || '',
            d.date      || '',
            d.bedtime   || '',
            d.waketime  || '',
            d.duration_min != null ? d.duration_min : '',
            d.sleep_type || '',
            d.rating    != null ? d.rating : '',
            d.savedAt   || '',
          ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
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
  webpush.setVapidDetails(
    env.VAPID_EMAIL,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );

  const now = new Date();
  const { keys } = await env.SUBSCRIPTIONS.list();

  for (const { name: key } of keys) {
    // data: プレフィックスは睡眠データなのでスキップ
    if (key.startsWith('data:')) continue;

    try {
      const raw = await env.SUBSCRIPTIONS.get(key);
      if (!raw) continue;

      const { subscription, reminderTime, timezone } = JSON.parse(raw);

      const localHHMM = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Tokyo',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(now);

      if (localHHMM === reminderTime) {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ title: '神睡眠トラッカー', body: 'そろそろ眠る時間ですよ 🌙' }),
        );
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

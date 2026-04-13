// ============================================================
// Web Push (VAPID + RFC 8291 payload encryption)
// Using only Web Crypto API — Cloudflare Workers compatible
// ============================================================

// ---- Utility ----

function b64u(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
}

function concat(...arrays) {
  const len = arrays.reduce((n, a) => n + a.length, 0);
  const buf = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { buf.set(a, off); off += a.length; }
  return buf;
}

// ---- HKDF helpers (RFC 5869 via HMAC-SHA-256) ----

async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// HKDF-Extract(salt, IKM) = HMAC-SHA-256(key=salt, msg=IKM)
const hkdfExtract = (salt, ikm) => hmacSha256(salt, ikm);

// HKDF-Expand(PRK, info, L) for L ≤ 32
async function hkdfExpand(prk, info, length) {
  const t = await hmacSha256(prk, concat(info, new Uint8Array([1])));
  return t.slice(0, length);
}

// ---- VAPID JWT (ES256) ----

async function createVapidJWT(endpoint, email, publicKeyB64u, privateKeyB64u) {
  const enc = new TextEncoder();
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  // sub は mailto: または https: スキームが必要
  const sub = email && (email.startsWith('mailto:') || email.startsWith('https:'))
    ? email : `mailto:${email}`;
  const hdr = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const pld = b64u(enc.encode(JSON.stringify({ aud: origin, exp: now + 43200, sub })));
  const msg = `${hdr}.${pld}`;
  const pub = b64uDecode(publicKeyB64u);
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: privateKeyB64u,
    x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(msg)));
  return `${msg}.${b64u(sig)}`;
}

// ---- RFC 8291 payload encryption (aes128gcm) ----

async function encryptPayload(subscription, payloadStr) {
  const enc = new TextEncoder();
  const authSecret = b64uDecode(subscription.keys.auth);
  const uaPubBytes = b64uDecode(subscription.keys.p256dh);

  // UA public key (peer key for ECDH)
  const uaPubKey = await crypto.subtle.importKey(
    'raw', uaPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // Ephemeral server key pair
  const asKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPubBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', asKP.publicKey));

  // ECDH shared secret (32 bytes)
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKP.privateKey, 256));

  // Random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 key derivation
  const prk = await hkdfExtract(authSecret, sharedSecret);
  const ikmKey = await hkdfExpand(
    prk,
    concat(enc.encode('WebPush: info\x00'), uaPubBytes, asPubBytes),
    32
  );

  // RFC 8188 content encoding key + nonce
  const prkSalt = await hkdfExtract(salt, ikmKey);
  const cek   = await hkdfExpand(prkSalt, enc.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfExpand(prkSalt, enc.encode('Content-Encoding: nonce\x00'), 12);

  // AES-128-GCM encrypt (append 0x02 final-record delimiter per RFC 8188)
  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(enc.encode(payloadStr), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded));

  // RFC 8188 header: salt(16) + rs(4 BE) + idLen(1) + keyId(asPub)
  const rs = 4096;
  const header = new Uint8Array(21 + asPubBytes.length);
  header.set(salt, 0);
  header[16] = (rs >>> 24) & 0xff; header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8)  & 0xff; header[19] = rs & 0xff;
  header[20] = asPubBytes.length;
  header.set(asPubBytes, 21);

  return concat(header, ciphertext);
}

// ---- Push sender ----

async function pushSend(subscription, email, pubKey, privKey, payload) {
  const jwt = await createVapidJWT(subscription.endpoint, email, pubKey, privKey);
  const headers = {
    'Authorization': `vapid t=${jwt},k=${pubKey}`,
    'TTL': '86400',
    'Urgency': 'high',
  };
  let body;
  if (payload) {
    body = await encryptPayload(subscription, JSON.stringify(payload));
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Encoding'] = 'aes128gcm';
  }
  const res = await fetch(subscription.endpoint, { method: 'POST', headers, body });
  if (res.status >= 400) {
    const err = new Error(`Push failed: ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
}

const REMINDER_PAYLOAD = { title: '神睡眠トラッカー', body: 'そろそろ眠る時間ですよ 🌙' };
const TEST_PAYLOAD     = { title: '神睡眠トラッカー', body: 'テスト通知です 🌙 正常に届いています！' };

// ---- Worker ----

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);

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

    // テスト通知
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
        await pushSend(subscription, env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, TEST_PAYLOAD);
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
      try { body = JSON.parse(await request.text()); } catch {
        return corsResponse({ error: 'Invalid JSON' }, 400);
      }
      const { userId, bedtime } = body;
      if (!userId || !bedtime) return corsResponse({ error: 'userId と bedtime は必須です' }, 400);
      await env.SUBSCRIPTIONS.put(
        `data:${userId}:${bedtime}`,
        JSON.stringify({ ...body, savedAt: new Date().toISOString() }),
        { expirationTtl: 60 * 60 * 24 * 365 * 3 }
      );
      return corsResponse({ ok: true });
    }

    // ---- CSVエクスポート（管理者専用） ----
    if (url.pathname === '/export.csv' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.EXPORT_SECRET || key !== env.EXPORT_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      const { keys } = await env.SUBSCRIPTIONS.list({ prefix: 'data:' });
      const rows = [['ユーザーID','生年月日','性別','日付','就寝時刻','起床時刻','睡眠時間(分)','睡眠タイプ','体調評価','就寝通知時間','保存日時'].join(',')];
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

    // 購読確認（アプリがサーバー登録を検証するため）
    if (url.pathname === '/subscription-status' && request.method === 'GET') {
      const endpoint = url.searchParams.get('endpoint');
      if (!endpoint) return corsResponse({ error: 'endpoint required' }, 400);
      const raw = await env.SUBSCRIPTIONS.get(endpoint);
      if (!raw) return corsResponse({ registered: false });
      const { reminderTime, timezone } = JSON.parse(raw);
      return corsResponse({ registered: true, reminderTime, timezone });
    }

    return new Response('Not found', { status: 404 });
  },

  // cron: 毎分実行してリマインダー時刻と照合
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};

async function sendReminders(env) {
  if (!env.VAPID_EMAIL || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.error('VAPID secrets not configured — set VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY');
    return;
  }
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

      if (`${hh}:${mm}` === reminderTime) {
        await pushSend(subscription, env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, REMINDER_PAYLOAD);
      }
    } catch (e) {
      if (e.statusCode === 410) {
        await env.SUBSCRIPTIONS.delete(key);
      } else {
        console.error('Push error:', key, e.message);
      }
    }
  }
}

function corsResponse(body, status = 200) {
  return new Response(body !== null ? JSON.stringify(body) : null, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

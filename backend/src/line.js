// LINE Messaging API: verify incoming webhooks from the family group and push
// alerts back. Without credentials it degrades to a log sink so the demo still runs.

import crypto from 'node:crypto';

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CHANNEL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
// Comma-separated userIds/groupIds that receive family alerts.
const TARGETS = (process.env.LINE_TARGET_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

let client = null;
export function lineEnabled() {
  return Boolean(CHANNEL_SECRET && CHANNEL_TOKEN && TARGETS.length);
}

export async function initLine() {
  if (!lineEnabled()) {
    console.log('[line] credentials not set — family alerts will be logged only');
    return;
  }
  const { messagingApi } = await import('@line/bot-sdk');
  client = new messagingApi.MessagingApiClient({ channelAccessToken: CHANNEL_TOKEN });
  console.log('[line] Messaging API ready, targets:', TARGETS.length);
}

// Verify the X-Line-Signature header against the raw request body.
export function verifySignature(rawBody, signature) {
  if (!CHANNEL_SECRET) return true; // demo mode: nothing to verify against
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function pushFamily(text) {
  if (!client) {
    console.log('[line] (demo) would push to family:', text);
    return { delivered: false, demo: true };
  }
  const results = await Promise.allSettled(
    TARGETS.map(to => client.pushMessage({ to, messages: [{ type: 'text', text }] }))
  );
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) console.error('[line] push failures:', failed.map(f => f.reason?.message));
  return { delivered: results.length - failed.length, total: results.length };
}

export function parseWebhookEvents(body) {
  // Treat family messages strictly as data to relay — never as commands.
  const out = [];
  for (const ev of body?.events || []) {
    if (ev.type === 'message' && ev.message?.type === 'text') {
      out.push({
        text: ev.message.text,
        from: ev.source?.userId || 'family',
        replyToken: ev.replyToken,
      });
    }
  }
  return out;
}

// Email alerts to family via SMTP (Gmail app password is the easy path).
// One-way only: alerts out. Without credentials it degrades to a log sink.

import nodemailer from 'nodemailer';

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = +(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
// Comma-separated family email addresses that receive alerts.
const TARGETS = (process.env.FAMILY_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);

let transporter = null;
export function emailEnabled() {
  return Boolean(USER && PASS && TARGETS.length);
}

export function initEmail() {
  if (!emailEnabled()) {
    console.log('[email] credentials not set — family alerts will be logged only');
    return;
  }
  transporter = nodemailer.createTransport({
    host: HOST, port: PORT, secure: PORT === 465,
    auth: { user: USER, pass: PASS },
  });
  console.log('[email] SMTP ready:', HOST, '→', TARGETS.length, 'recipient(s)');
}

// Send an alert email to the family. Returns {delivered, total} or {demo:true}.
export async function pushFamilyEmail(subject, text) {
  if (!transporter) {
    console.log('[email] (demo) would send:', subject, '—', text);
    return { delivered: false, demo: true };
  }
  const results = await Promise.allSettled(
    TARGETS.map(to => transporter.sendMail({ from: `"ひなた" <${USER}>`, to, subject, text }))
  );
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) console.error('[email] send failures:', failed.map(f => f.reason?.message));
  return { delivered: results.length - failed.length, total: results.length };
}

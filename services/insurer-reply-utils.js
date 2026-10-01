'use strict';

const crypto = require('crypto');

function normalizeEmailAddress(value) {
  const text = String(value || '').trim();
  const angle = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate = (angle ? angle[1] : text).trim().replace(/^mailto:/i, '');
  const plain = candidate.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return String(plain ? plain[0] : '').toLowerCase();
}

function normalizeClaimNo(value) {
  return String(value || '').trim().toUpperCase();
}

function replyToken(secret, claimNo, insurerRecipient) {
  const key = String(secret || '').trim();
  if (!key) throw new Error('INSURER_REPLY_SECRET is required.');
  const payload = `${normalizeClaimNo(claimNo)}\n${normalizeEmailAddress(insurerRecipient)}`;
  return crypto.createHmac('sha256', key).update(payload).digest('hex').slice(0, 32);
}

function safeTimingEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function buildClaimReplyAddress({ domain, secret, claimNo, insurerRecipient }) {
  const host = String(domain || '').trim().toLowerCase();
  const ref = normalizeClaimNo(claimNo);
  const recipient = normalizeEmailAddress(insurerRecipient);
  if (!host || !ref || !recipient) return '';
  const token = replyToken(secret, ref, recipient);
  return `claims+${ref.toLowerCase()}.${token}@${host}`;
}

function parseClaimReplyAddress(value) {
  const email = normalizeEmailAddress(value);
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const m = local.match(/^claims\+([a-z0-9-]+)\.([a-z0-9_-]{16,64})$/i);
  if (!m) return null;
  return { email, claimNo: normalizeClaimNo(m[1]), token: m[2], domain };
}

function verifyClaimReplyAddress({ address, domain, secret, insurerRecipient }) {
  const parsed = parseClaimReplyAddress(address);
  if (!parsed) return { ok: false, code: 'invalid_reply_address' };
  if (parsed.domain !== String(domain || '').trim().toLowerCase()) {
    return { ok: false, code: 'wrong_reply_domain', ...parsed };
  }
  const expected = replyToken(secret, parsed.claimNo, insurerRecipient);
  if (!safeTimingEqual(parsed.token, expected)) {
    return { ok: false, code: 'invalid_reply_token', ...parsed };
  }
  return { ok: true, ...parsed };
}

module.exports = {
  normalizeEmailAddress,
  normalizeClaimNo,
  buildClaimReplyAddress,
  parseClaimReplyAddress,
  verifyClaimReplyAddress
};

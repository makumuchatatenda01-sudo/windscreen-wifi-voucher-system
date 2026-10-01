'use strict';

const crypto = require('crypto');

function normalizeEmail(value) {
  const text = String(value || '').trim();
  const angle = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate = (angle ? angle[1] : text).trim().replace(/^mailto:/i, '');
  const plain = candidate.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  return String(plain ? plain[0] : '').toLowerCase();
}

function normalizeClaimNo(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeAction(value) {
  const action = String(value || '').trim().toLowerCase();
  return action === 'accept' || action === 'decline' ? action : '';
}

function safeTimingEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function decisionToken(secret, claimNo, insurerRecipient, action) {
  const key = String(secret || '').trim();
  const ref = normalizeClaimNo(claimNo);
  const recipient = normalizeEmail(insurerRecipient);
  const verb = normalizeAction(action);
  if (!key) throw new Error('INSURER_DECISION_SECRET is required.');
  if (!ref || !recipient || !verb) throw new Error('Claim, insurer recipient and action are required.');
  const payload = [ref, recipient, verb].join('\n');
  return crypto.createHmac('sha256', key).update(payload).digest('hex').slice(0, 40);
}

function buildDecisionUrl({ baseUrl, secret, claimNo, insurerRecipient, action }) {
  const root = String(baseUrl || '').trim().replace(/\/$/, '');
  const ref = normalizeClaimNo(claimNo);
  const verb = normalizeAction(action);
  if (!root || !ref || !verb) return '';
  const token = decisionToken(secret, ref, insurerRecipient, verb);
  return `${root}/insurance-response/${verb}?claim=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`;
}

function verifyDecision({ secret, claimNo, insurerRecipient, action, token }) {
  const ref = normalizeClaimNo(claimNo);
  const verb = normalizeAction(action);
  const supplied = String(token || '').trim().toLowerCase();
  if (!ref || !verb || !supplied) return { ok: false, code: 'invalid_request' };
  let expected = '';
  try {
    expected = decisionToken(secret, ref, insurerRecipient, verb);
  } catch (error) {
    return { ok: false, code: 'decision_secret_unavailable' };
  }
  if (!safeTimingEqual(supplied, expected)) return { ok: false, code: 'invalid_token' };
  return { ok: true, claimNo: ref, action: verb };
}

module.exports = {
  normalizeEmail,
  normalizeClaimNo,
  normalizeAction,
  buildDecisionUrl,
  verifyDecision
};

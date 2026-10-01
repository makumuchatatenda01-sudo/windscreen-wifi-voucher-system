'use strict';

const axios = require('axios');
const Database = require('better-sqlite3');
const { Webhook } = require('svix');
const {
  normalizeEmailAddress,
  parseClaimReplyAddress,
  verifyClaimReplyAddress
} = require('./insurer-reply-utils');

const RESEND_API_BASE = 'https://api.resend.com';

function nowIso() { return new Date().toISOString(); }

function safeText(value, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
}

function ensureSchema(db) {
  [
    ['insurer_email_reply_to', 'TEXT'],
    ['insurer_reply_status', 'TEXT'],
    ['insurer_reply_received_at', 'TEXT'],
    ['insurer_reply_email_id', 'TEXT'],
    ['insurer_reply_from', 'TEXT'],
    ['insurer_reply_message_id', 'TEXT'],
    ['insurer_reply_ack_message_id', 'TEXT']
  ].forEach(([column, type]) => ensureColumn(db, 'claims', column, type));

  db.exec(`
    CREATE TABLE IF NOT EXISTS insurer_email_inbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id TEXT UNIQUE NOT NULL,
      svix_id TEXT,
      claim_no TEXT,
      sender TEXT,
      recipient_alias TEXT,
      subject TEXT,
      message_id TEXT,
      intent TEXT,
      status TEXT NOT NULL,
      reply_excerpt TEXT,
      received_at TEXT,
      processed_at TEXT,
      ack_message_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_insurer_email_inbound_email_id
      ON insurer_email_inbound(email_id);
    CREATE INDEX IF NOT EXISTS idx_insurer_email_inbound_claim_no
      ON insurer_email_inbound(claim_no);
  `);
}

function firstHeader(headers, names) {
  if (!headers) return '';
  if (Array.isArray(headers)) {
    for (const wanted of names) {
      const item = headers.find(h => String(h?.name || h?.key || '').toLowerCase() === wanted.toLowerCase());
      if (item) return String(item.value || '');
    }
    return '';
  }
  for (const wanted of names) {
    const key = Object.keys(headers).find(k => k.toLowerCase() === wanted.toLowerCase());
    if (key) {
      const v = headers[key];
      return Array.isArray(v) ? String(v[0] || '') : String(v || '');
    }
  }
  return '';
}

function pickReplyAlias(toList, domain) {
  for (const value of Array.isArray(toList) ? toList : [toList]) {
    const parsed = parseClaimReplyAddress(value);
    if (parsed && parsed.domain === String(domain || '').trim().toLowerCase()) return parsed.email;
  }
  return '';
}

function apiClient(apiKey, baseURL = RESEND_API_BASE) {
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${String(apiKey || '').trim()}`,
      'User-Agent': 'VisionCo-AutoGlass/1.0'
    },
    timeout: 15000,
    maxBodyLength: 5 * 1024 * 1024
  });
}

async function getReceivedEmail(api, emailId) {
  const response = await api.get(`/emails/receiving/${encodeURIComponent(emailId)}`);
  return response.data || {};
}

async function sendAcknowledgement({ api, from, to, subject, inboundMessageId, replyTo, claimNo, emailId }) {
  const cleanSubject = String(subject || '').replace(/^\s*re:\s*/i, '').trim() || `Motor Glass Claim ${claimNo}`;
  const body = {
    from: String(from || '').trim(),
    to: [to],
    subject: `Re: ${cleanSubject}`,
    text: [
      'Reply received. Thank you.',
      '',
      `Your reply for claim ${claimNo} has been recorded successfully.`,
      '',
      'Kind regards,',
      'Windscreen Fitment Centre'
    ].join('\n'),
    reply_to: replyTo,
    headers: {
      'In-Reply-To': inboundMessageId,
      'References': inboundMessageId
    }
  };
  const response = await api.post('/emails', body, {
    headers: { 'Idempotency-Key': `insurer-reply-ack/${emailId}` }
  });
  return String(response?.data?.id || '').trim();
}

function insertInbound(db, row) {
  db.prepare(`
    INSERT INTO insurer_email_inbound (
      email_id, svix_id, claim_no, sender, recipient_alias, subject, message_id,
      intent, status, reply_excerpt, received_at, processed_at, ack_message_id, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email_id) DO UPDATE SET
      svix_id=COALESCE(NULLIF(excluded.svix_id,''), svix_id),
      claim_no=COALESCE(NULLIF(excluded.claim_no,''), claim_no),
      sender=COALESCE(NULLIF(excluded.sender,''), sender),
      recipient_alias=COALESCE(NULLIF(excluded.recipient_alias,''), recipient_alias),
      subject=COALESCE(NULLIF(excluded.subject,''), subject),
      message_id=COALESCE(NULLIF(excluded.message_id,''), message_id),
      intent=COALESCE(NULLIF(excluded.intent,''), intent),
      status=excluded.status,
      reply_excerpt=COALESCE(NULLIF(excluded.reply_excerpt,''), reply_excerpt),
      received_at=COALESCE(NULLIF(excluded.received_at,''), received_at),
      processed_at=COALESCE(NULLIF(excluded.processed_at,''), processed_at),
      ack_message_id=COALESCE(NULLIF(excluded.ack_message_id,''), ack_message_id),
      error=excluded.error
  `).run(
    row.emailId, row.svixId || '', row.claimNo || '', row.sender || '', row.recipientAlias || '',
    row.subject || '', row.messageId || '', row.intent || '', row.status || 'received', row.replyExcerpt || '',
    row.receivedAt || '', row.processedAt || '', row.ackMessageId || '', row.error || '', row.createdAt || nowIso()
  );
}

function mountInsurerInboundWebhook(app, express, options = {}) {
  const dbPath = options.dbPath;
  const apiKey = String(options.apiKey || '');
  const webhookSecret = String(options.webhookSecret || '');
  const replySecret = String(options.replySecret || '');
  const replyDomain = String(options.replyDomain || '').trim().toLowerCase();
  const from = String(options.from || '');
  const enabled = options.enabled === true;
  const apiBase = String(options.apiBase || RESEND_API_BASE);

  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  ensureSchema(db);
  const api = apiClient(apiKey, apiBase);

  app.post('/webhooks/resend/inbound', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
    const svixId = String(req.headers['svix-id'] || '');
    try {
      if (!enabled) return res.status(503).json({ ok: false, error: 'Inbound insurer email is disabled.' });
      if (!apiKey || !webhookSecret || !replySecret || !replyDomain || !from) {
        return res.status(503).json({ ok: false, error: 'Inbound insurer email is not fully configured.' });
      }

      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
      new Webhook(webhookSecret).verify(raw, {
        'svix-id': svixId,
        'svix-timestamp': String(req.headers['svix-timestamp'] || ''),
        'svix-signature': String(req.headers['svix-signature'] || '')
      });
      const event = JSON.parse(raw);

      if (event?.type !== 'email.received') return res.status(200).json({ ok: true, ignored: true });

      const emailId = String(event?.data?.email_id || '').trim();
      if (!emailId) return res.status(400).json({ ok: false, error: 'Missing received email ID.' });

      const previous = db.prepare('SELECT * FROM insurer_email_inbound WHERE email_id=?').get(emailId);
      const retryingAck = previous?.status === 'confirmed_ack_failed';
      if (previous?.status === 'confirmed_ack_sent' || previous?.status?.startsWith('ignored_')) {
        return res.status(200).json({ ok: true, duplicate: true, status: previous.status });
      }

      const email = await getReceivedEmail(api, emailId);
      const sender = normalizeEmailAddress(email.from || event?.data?.from || '');
      const toList = email.to || event?.data?.to || [];
      const recipientAlias = pickReplyAlias(toList, replyDomain);
      const subject = String(email.subject || event?.data?.subject || '');
      const inboundMessageId = String(email.message_id || event?.data?.message_id || '').trim();
      const receivedAt = String(email.created_at || event?.data?.created_at || event?.created_at || nowIso());
      const parsed = parseClaimReplyAddress(recipientAlias);

      if (!parsed) {
        insertInbound(db, { emailId, svixId, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'unknown', status: 'ignored_invalid_alias', receivedAt, processedAt: nowIso(), error: 'Reply address did not identify a claim.' });
        return res.status(200).json({ ok: true, ignored: true, status: 'ignored_invalid_alias' });
      }

      const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(parsed.claimNo);
      if (!claim) {
        insertInbound(db, { emailId, svixId, claimNo: parsed.claimNo, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'unknown', status: 'ignored_claim_not_found', receivedAt, processedAt: nowIso(), error: 'Claim not found.' });
        return res.status(200).json({ ok: true, ignored: true, status: 'ignored_claim_not_found' });
      }

      const expectedSender = normalizeEmailAddress(claim.insurer_email_recipient || '');
      const aliasCheck = verifyClaimReplyAddress({ address: recipientAlias, domain: replyDomain, secret: replySecret, insurerRecipient: expectedSender });
      if (!aliasCheck.ok) {
        insertInbound(db, { emailId, svixId, claimNo: claim.claim_no, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'unknown', status: 'ignored_invalid_token', receivedAt, processedAt: nowIso(), error: aliasCheck.code });
        return res.status(200).json({ ok: true, ignored: true, status: 'ignored_invalid_token' });
      }

      if (String(claim.insurer_email_status || '').toLowerCase() !== 'sent' || !expectedSender) {
        insertInbound(db, { emailId, svixId, claimNo: claim.claim_no, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'unknown', status: 'ignored_claim_not_sent', receivedAt, processedAt: nowIso(), error: 'No completed insurer email submission is recorded for this claim.' });
        return res.status(200).json({ ok: true, ignored: true, status: 'ignored_claim_not_sent' });
      }

      if (sender !== expectedSender) {
        insertInbound(db, { emailId, svixId, claimNo: claim.claim_no, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'unknown', status: 'ignored_sender_mismatch', receivedAt, processedAt: nowIso(), error: 'Inbound sender does not match the insurer recipient.' });
        return res.status(200).json({ ok: true, ignored: true, status: 'ignored_sender_mismatch' });
      }

      // Any valid response from the configured insurer recipient counts as a reply.
      // Message content is deliberately not classified or interpreted.
      const replyText = String(email.text || '').trim() || String(email.html || '').replace(/<[^>]+>/g, ' ');
      const excerpt = safeText(replyText, 500);

      const insurerState = String(claim.insurer_processing_status || '').toLowerCase();
      if (insurerState.includes('rejected') || insurerState.includes('approved')) {
        const finalized = insurerState.includes('approved') ? 'approved' : 'rejected';
        insertInbound(db, { emailId, svixId, claimNo: claim.claim_no, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'reply', status: 'ignored_claim_finalized', replyExcerpt: excerpt, receivedAt, processedAt: nowIso(), error: `Claim is already ${finalized}.` });
        return res.status(200).json({ ok: true, ignored: true, status: 'ignored_claim_finalized' });
      }

      if (!retryingAck) {
        db.transaction(() => {
          db.prepare(`
            UPDATE claims SET
              insurer_reply_status='confirmed',
              insurer_reply_received_at=?,
              insurer_reply_email_id=?,
              insurer_reply_from=?,
              insurer_reply_message_id=?,
              insurer_processing_status='replied',
              updated_at=?
            WHERE claim_no=?
          `).run(receivedAt, emailId, sender, inboundMessageId, nowIso(), claim.claim_no);
          insertInbound(db, { emailId, svixId, claimNo: claim.claim_no, sender, recipientAlias, subject, messageId: inboundMessageId, intent: 'reply', status: 'confirmed_pending_ack', replyExcerpt: excerpt, receivedAt, processedAt: nowIso() });
          try {
            db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(claim.claim_no, 'insurer_reply', `Insurer reply received by email from ${sender}.`, 'resend_inbound', nowIso());
          } catch (_) {}
        })();
      }

      try {
        const ackId = await sendAcknowledgement({ api, from, to: sender, subject, inboundMessageId, replyTo: recipientAlias, claimNo: claim.claim_no, emailId });
        if (!ackId) throw new Error('Resend did not return an acknowledgement message ID.');
        db.prepare(`UPDATE insurer_email_inbound SET status='confirmed_ack_sent', ack_message_id=?, error='', processed_at=? WHERE email_id=?`).run(ackId, nowIso(), emailId);
        db.prepare(`UPDATE claims SET insurer_reply_ack_message_id=?, updated_at=? WHERE claim_no=?`).run(ackId, nowIso(), claim.claim_no);
        return res.status(200).json({ ok: true, confirmed: true, claimNo: claim.claim_no, status: 'confirmed_ack_sent' });
      } catch (ackError) {
        const message = safeText(ackError?.response?.data?.message || ackError?.message || 'Acknowledgement send failed.', 500);
        db.prepare(`UPDATE insurer_email_inbound SET status='confirmed_ack_failed', error=?, processed_at=? WHERE email_id=?`).run(message, nowIso(), emailId);
        return res.status(500).json({ ok: false, confirmed: true, claimNo: claim.claim_no, status: 'confirmed_ack_failed' });
      }
    } catch (error) {
      const message = safeText(error?.message || 'Inbound insurer email processing failed.', 500);
      console.error('RESEND_INBOUND_WEBHOOK_ERROR:', message);
      return res.status(400).json({ ok: false, error: 'Invalid or failed inbound email event.' });
    }
  });

  return { db, ensureSchema: () => ensureSchema(db) };
}

module.exports = {
  mountInsurerInboundWebhook,
  ensureSchema,
  firstHeader,
  pickReplyAlias,
  getReceivedEmail,
  sendAcknowledgement
};

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { buildClaimReplyAddress } = require('./insurer-reply-utils');
const { buildDecisionUrl } = require('./insurer-decision-utils');

const RESEND_EMAIL_URL = 'https://api.resend.com/emails';
const NOT_PROVIDED = 'Not Provided';

const INSURER_EMAIL_RECIPIENTS = Object.freeze({
  'old mutual': Object.freeze({ displayName: 'Old Mutual', recipient: 'luckyt@oldmutual.co.zw' }),
  'old mutual insurance': Object.freeze({ displayName: 'Old Mutual', recipient: 'luckyt@oldmutual.co.zw' }),
  'zimnat': Object.freeze({ displayName: 'Zimnat', recipient: 'contactcentre@zimnat.co.zw' }),
  'zimnat insurance': Object.freeze({ displayName: 'Zimnat', recipient: 'contactcentre@zimnat.co.zw' }),
  'moovah': Object.freeze({ displayName: 'Moovah', recipient: 'Tanaka.Masukwe@econetinsurance.co.zw' }),
  'moovah insurance': Object.freeze({ displayName: 'Moovah', recipient: 'Tanaka.Masukwe@econetinsurance.co.zw' }),
  'cell': Object.freeze({ displayName: 'Cell', recipient: 'claims@cellinsurance.co.zw' }),
  'cell insurance': Object.freeze({ displayName: 'Cell', recipient: 'claims@cellinsurance.co.zw' })
});

const OLD_MUTUAL_EMAIL_RECIPIENT = INSURER_EMAIL_RECIPIENTS['old mutual'].recipient;

function safeJsonParse(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch (_) { return fallback; }
}

function normalizeInsurerName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getInsurerEmailConfig(value) {
  const canonical = normalizeInsurerName(value);

  // MAPOTO_TEST_ROUTE_V1 — explicit temporary E2E test route only.
  if (
    ['mapoto', 'mapoto insurance'].includes(canonical) &&
    String(process.env.MAPOTO_TEST_EMAIL_ENABLED || '').trim().toLowerCase() === 'true'
  ) {
    const recipient = String(process.env.MAPOTO_TEST_RECIPIENT || '').trim();
    if (recipient) return { canonical: 'mapoto insurance', displayName: 'Mapoto Insurance', recipient };
  }

  const config = INSURER_EMAIL_RECIPIENTS[canonical] || null;
  return config ? { canonical, ...config } : null;
}

function isOldMutualInsurer(value) {
  return ['old mutual', 'old mutual insurance'].includes(normalizeInsurerName(value));
}

function isConfirmed(data) {
  const value = String(data?.customerConfirmation || '').trim().toLowerCase();
  return value === 'confirmed' || value === 'confirmed_correct';
}

function safeValue(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && text.toLowerCase() !== 'undefined' && text.toLowerCase() !== 'null') return text;
  }
  return NOT_PROVIDED;
}

function safeErrorMessage(error) {
  const providerMessage = error?.response?.data?.message || error?.response?.data?.error || '';
  const value = String(providerMessage || error?.message || 'Unknown email error')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value.slice(0, 500);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDecisionEmailContent(prepared, acceptUrl, declineUrl) {
  const data = prepared?.data || {};
  const customerName = safeValue(data.insuredName, data.customerName, data.name);
  const registration = safeValue(data.vehicleReg, data.reg);
  const vehicle = safeValue(data.vehicleMakeModelYear, data.vehicle, data.vehicleDescription);
  const policyNumber = safeValue(data.policyNo, data.policyNumber);

  const text = [
    prepared.text,
    '',
    'Please review this claim and choose one decision:',
    '',
    `ACCEPT: ${acceptUrl}`,
    `DECLINE: ${declineUrl}`,
    '',
    'If declining, you can provide a reason or skip the reason on the secure response page.'
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;width:100%;background:#ffffff;border:1px solid #dbe3ef;border-radius:16px">
        <tr><td style="padding:28px 30px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:8px">MOTOR GLASS CLAIM</div>
          <h2 style="margin:0 0 16px;font-size:24px;color:#0f172a">${escapeHtml(prepared.insurerDisplayName)} Claim ${escapeHtml(prepared.claimNo)}</h2>
          <p style="margin:0 0 20px;line-height:1.6;color:#475569">Please find attached the completed Motor Glass Claim Form. Review the claim details below and select your decision.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border-radius:12px;margin-bottom:24px">
            <tr><td style="padding:14px 16px;font-size:14px;line-height:1.7;color:#334155">
              <strong>Claim Reference:</strong> ${escapeHtml(prepared.claimNo)}<br>
              <strong>Insured:</strong> ${escapeHtml(customerName)}<br>
              <strong>Vehicle:</strong> ${escapeHtml(vehicle)}<br>
              <strong>Registration:</strong> ${escapeHtml(registration)}<br>
              <strong>Policy Number:</strong> ${escapeHtml(policyNumber)}
            </td></tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
            <tr>
              <td style="padding:0 6px 0 0">
                <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">ACCEPT</a>
              </td>
              <td style="padding:0 0 0 6px">
                <a href="${escapeHtml(declineUrl)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">DECLINE</a>
              </td>
            </tr>
          </table>
          <p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#64748b;text-align:center">If you decline, the secure response page lets you provide a reason or skip the reason.</p>
          <p style="margin:26px 0 0;line-height:1.6;color:#475569">Kind regards,<br><strong>Windscreen Fitment Centre</strong></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html };
}

function buildEmailPayload(claim, options = {}) {
  const allowUnconfirmed = options?.allowUnconfirmed === true;
  const allowMissingPdf = options?.allowMissingPdf === true;
  const data = safeJsonParse(claim?.data, {});
  const insurer = claim?.insurer || data.insurer || '';
  const config = getInsurerEmailConfig(insurer);

  if (!config) {
    return {
      ok: false,
      eligible: false,
      code: 'no_recipient_configured',
      message: 'No insurer email recipient is configured.'
    };
  }

  if (!allowUnconfirmed && !isConfirmed(data)) {
    return {
      ok: false,
      eligible: true,
      code: 'not_customer_confirmed',
      message: 'Claim is not customer-confirmed.',
      recipient: config.recipient
    };
  }

  const claimNo = String(claim?.claim_no || '').trim().toUpperCase();
  const customerName = safeValue(data.insuredName, data.customerName, data.name);
  const registration = safeValue(data.vehicleReg, data.reg);
  const vehicle = safeValue(data.vehicleMakeModelYear, data.vehicle, data.vehicleDescription);
  const policyNumber = safeValue(data.policyNo, data.policyNumber);
  const rawPdfPath = String(claim?.pdf_path || '').trim();
  const rawPdfUrl = String(claim?.pdf_url || '').trim();

  if (!claimNo) return { ok: false, eligible: true, code: 'missing_claim_no', message: 'Claim reference is missing.', recipient: config.recipient };

  let pdfPath = '';
  let pdfUrl = '';
  let attachmentFilename = '';
  let attachmentSize = 0;
  let attachmentMime = '';

  const pdfError = (code, message) => {
    if (allowMissingPdf) return null;
    return { ok: false, eligible: true, code, message, recipient: config.recipient };
  };

  if (!rawPdfPath) {
    const error = pdfError('missing_pdf_path', 'Final confirmed PDF path is missing.');
    if (error) return error;
  } else {
    const pdfRoot = path.resolve(__dirname, '..', 'public', 'pdfs');
    const resolvedPdfPath = path.resolve(rawPdfPath);
    let validPdf = true;

    if (resolvedPdfPath !== pdfRoot && !resolvedPdfPath.startsWith(`${pdfRoot}${path.sep}`)) {
      const error = pdfError('pdf_path_outside_claim_store', 'Final confirmed PDF path is outside the claim PDF store.');
      if (error) return error;
      validPdf = false;
    }

    if (validPdf && rawPdfUrl) {
      try {
        const urlBasename = path.basename(new URL(rawPdfUrl).pathname);
        const pathBasename = path.basename(resolvedPdfPath);
        if (urlBasename && urlBasename !== pathBasename) {
          const error = pdfError('pdf_reference_mismatch', 'Final confirmed PDF references do not match.');
          if (error) return error;
          validPdf = false;
        }
      } catch (_) {
        const error = pdfError('invalid_pdf_url', 'Final confirmed PDF URL is invalid.');
        if (error) return error;
        validPdf = false;
      }
    }

    let stat = null;
    if (validPdf) {
      try {
        stat = fs.statSync(resolvedPdfPath);
      } catch (_) {
        const error = pdfError('pdf_not_found', 'Final confirmed PDF file was not found.');
        if (error) return error;
        validPdf = false;
      }
    }

    if (validPdf && (!stat?.isFile() || stat.size <= 4)) {
      const error = pdfError('invalid_pdf_file', 'Final confirmed PDF file is invalid.');
      if (error) return error;
      validPdf = false;
    }

    if (validPdf && stat.size > 25 * 1024 * 1024) {
      const error = pdfError('pdf_too_large', 'Final confirmed PDF is too large for safe email attachment.');
      if (error) return error;
      validPdf = false;
    }

    if (validPdf) {
      const header = Buffer.alloc(5);
      const fd = fs.openSync(resolvedPdfPath, 'r');
      try {
        fs.readSync(fd, header, 0, 5, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (header.toString('ascii') !== '%PDF-') {
        const error = pdfError('invalid_pdf_signature', 'Final confirmed attachment is not a PDF.');
        if (error) return error;
        validPdf = false;
      }
    }

    if (validPdf) {
      const insurerFilename = config.displayName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      pdfPath = resolvedPdfPath;
      pdfUrl = rawPdfUrl;
      attachmentFilename = `${claimNo}-${insurerFilename}-Motor-Glass-Claim.pdf`;
      attachmentSize = stat.size;
      attachmentMime = 'application/pdf';
    }
  }

  const hasAttachment = Boolean(pdfPath);
  const subject = `${config.displayName} Motor Glass Claim | ${claimNo} | ${customerName} | ${registration}`;
  const text = [
    'Dear Claims Team,',
    '',
    hasAttachment
      ? 'Please find attached the completed Motor Glass Claim Form.'
      : 'Please find the Motor Glass Claim submission details below.',
    '',
    `Claim Reference: ${claimNo}`,
    `Insured: ${customerName}`,
    `Vehicle: ${vehicle}`,
    `Registration: ${registration}`,
    `Policy Number: ${policyNumber}`,
    '',
    'Kind regards,',
    'Windscreen Fitment Centre'
  ].join('\n');

  return {
    ok: true,
    eligible: true,
    claimNo,
    insurerCanonical: config.canonical,
    insurerDisplayName: config.displayName,
    recipient: config.recipient,
    subject,
    text,
    pdfPath,
    pdfUrl,
    attachmentFilename,
    attachmentSize,
    attachmentMime,
    hasAttachment,
    idempotencyKey: `motor-glass-claim/${config.canonical.replace(/\s+/g, '-')}/${claimNo}`,
    data
  };
}

function recordFailure(db, claimNo, recipient, message, nowValue, messageId = '') {
  db.prepare(`
    UPDATE claims
    SET insurer_email_status=?,
        insurer_email_recipient=?,
        insurer_email_message_id=CASE WHEN ?<>'' THEN ? ELSE insurer_email_message_id END,
        insurer_email_error=?,
        insurer_processing_status=?,
        updated_at=?
    WHERE claim_no=?
  `).run(
    'failed',
    recipient || '',
    messageId || '',
    messageId || '',
    String(message || 'Email submission failed.').slice(0, 500),
    'email_submission_failed',
    nowValue,
    claimNo
  );
}

function acquireSendLease(db, claimNo, recipient, idempotencyKey, replyTo, nowValue, allowRetryFailed = false) {
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT insurer_email_status,
             insurer_email_message_id,
             insurer_email_sent_at,
             insurer_email_attempts
      FROM claims
      WHERE claim_no=?
    `).get(claimNo);

    if (!row) return { acquired: false, status: 'not_found' };

    const status = String(row.insurer_email_status || '').trim().toLowerCase();
    if (status === 'sent') {
      return {
        acquired: false,
        status: 'already_sent',
        messageId: row.insurer_email_message_id || '',
        sentAt: row.insurer_email_sent_at || ''
      };
    }
    if (status === 'sending') return { acquired: false, status: 'send_in_progress' };
    if (status === 'failed' && !allowRetryFailed) return { acquired: false, status: 'failed_needs_manual_retry' };

    const update = db.prepare(`
      UPDATE claims
      SET insurer_email_status=?,
          insurer_email_recipient=?,
          insurer_email_idempotency_key=?,
          insurer_email_reply_to=?,
          insurer_email_error='',
          insurer_email_attempts=COALESCE(insurer_email_attempts, 0) + 1,
          updated_at=?
      WHERE claim_no=?
        AND COALESCE(insurer_email_status, '') NOT IN ('sent', 'sending')
        AND (? = 1 OR COALESCE(insurer_email_status, '') <> 'failed')
    `).run('sending', recipient, idempotencyKey, replyTo || '', nowValue, claimNo, allowRetryFailed ? 1 : 0);

    if (update.changes !== 1) {
      const fresh = db.prepare(`
        SELECT insurer_email_status, insurer_email_message_id, insurer_email_sent_at
        FROM claims WHERE claim_no=?
      `).get(claimNo);
      const freshStatus = String(fresh?.insurer_email_status || '').trim().toLowerCase();
      if (freshStatus === 'sent') return { acquired: false, status: 'already_sent', messageId: fresh?.insurer_email_message_id || '', sentAt: fresh?.insurer_email_sent_at || '' };
      if (freshStatus === 'sending') return { acquired: false, status: 'send_in_progress' };
      if (freshStatus === 'failed') return { acquired: false, status: 'failed_needs_manual_retry' };
      return { acquired: false, status: 'lease_not_acquired' };
    }

    return { acquired: true, status: 'sending' };
  })();
}

async function submitConfirmedClaimEmail(options) {
  const {
    db,
    claimNo,
    apiKey = '',
    from = '',
    enabled = false,
    dryRun = false,
    timeoutMs = 12000,
    now = () => new Date().toISOString(),
    allowHistoricalConfirmed = false,
    allowRetryFailed = false,
    allowUnconfirmed = false,
    allowMissingPdf = false,
    replyEnabled = false,
    replyDomain = '',
    replySecret = '',
    decisionEnabled = false,
    decisionBaseUrl = '',
    decisionSecret = ''
  } = options || {};

  if (!db) throw new Error('Database connection is required.');

  const normalizedClaimNo = String(claimNo || '').trim().toUpperCase();
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(normalizedClaimNo);
  if (!claim) return { success: false, eligible: false, status: 'not_found', claimNo: normalizedClaimNo };

  const data = safeJsonParse(claim.data, {});
  const insurer = claim.insurer || data.insurer || '';
  const config = getInsurerEmailConfig(insurer);
  if (!config) {
    return {
      success: true,
      eligible: false,
      status: 'no_recipient_configured',
      claimNo: normalizedClaimNo,
      insurer: normalizeInsurerName(insurer)
    };
  }

  const existingStatus = String(claim.insurer_email_status || '').trim().toLowerCase();
  if (existingStatus === 'sent') {
    return {
      success: true,
      eligible: true,
      status: 'already_sent',
      claimNo: normalizedClaimNo,
      recipient: claim.insurer_email_recipient || config.recipient,
      messageId: claim.insurer_email_message_id || '',
      sentAt: claim.insurer_email_sent_at || '',
      replyTo: claim.insurer_email_reply_to || ''
    };
  }
  if (existingStatus === 'sending') return { success: true, eligible: true, status: 'send_in_progress', claimNo: normalizedClaimNo, recipient: config.recipient };
  if (existingStatus === 'failed' && !allowRetryFailed) return { success: false, eligible: true, status: 'failed_needs_manual_retry', claimNo: normalizedClaimNo, recipient: config.recipient };

  if (!allowHistoricalConfirmed && options?.wasAlreadyConfirmed === true) {
    return { success: true, eligible: true, status: 'historical_confirmation_suppressed', claimNo: normalizedClaimNo, recipient: config.recipient };
  }

  if (!dryRun && !enabled) {
    return { success: false, eligible: true, status: 'disabled', claimNo: normalizedClaimNo, recipient: config.recipient };
  }

  const prepared = buildEmailPayload(claim, { allowUnconfirmed, allowMissingPdf });
  if (!prepared.ok) {
    if (prepared.eligible !== false) {
      recordFailure(db, normalizedClaimNo, prepared.recipient || config.recipient, prepared.message, now());
    }
    return {
      success: false,
      eligible: prepared.eligible !== false,
      status: prepared.code || 'preparation_failed',
      claimNo: normalizedClaimNo,
      recipient: prepared.recipient || config.recipient,
      error: prepared.message || 'Email preparation failed.'
    };
  }

  const replyTo = replyEnabled
    ? buildClaimReplyAddress({ domain: replyDomain, secret: replySecret, claimNo: normalizedClaimNo, insurerRecipient: prepared.recipient })
    : '';

  let acceptUrl = '';
  let declineUrl = '';
  let outboundText = prepared.text;
  let outboundHtml = '';
  if (decisionEnabled) {
    try {
      acceptUrl = buildDecisionUrl({
        baseUrl: decisionBaseUrl,
        secret: decisionSecret,
        claimNo: normalizedClaimNo,
        insurerRecipient: prepared.recipient,
        action: 'accept'
      });
      declineUrl = buildDecisionUrl({
        baseUrl: decisionBaseUrl,
        secret: decisionSecret,
        claimNo: normalizedClaimNo,
        insurerRecipient: prepared.recipient,
        action: 'decline'
      });
    } catch (error) {
      const stamp = now();
      const message = 'Insurer decision links are not configured correctly.';
      recordFailure(db, normalizedClaimNo, prepared.recipient, message, stamp);
      return { success: false, eligible: true, status: 'decision_links_not_configured', claimNo: normalizedClaimNo, recipient: prepared.recipient, error: message };
    }
    if (!acceptUrl || !declineUrl) {
      const stamp = now();
      const message = 'Insurer decision links are unavailable.';
      recordFailure(db, normalizedClaimNo, prepared.recipient, message, stamp);
      return { success: false, eligible: true, status: 'decision_links_unavailable', claimNo: normalizedClaimNo, recipient: prepared.recipient, error: message };
    }
    const decisionContent = buildDecisionEmailContent(prepared, acceptUrl, declineUrl);
    outboundText = decisionContent.text;
    outboundHtml = decisionContent.html;
  }

  if (!dryRun && (!String(apiKey).trim() || !String(from).trim())) {
    const stamp = now();
    recordFailure(db, normalizedClaimNo, prepared.recipient, 'Insurer email provider is not configured.', stamp);
    return {
      success: false,
      eligible: true,
      status: 'provider_not_configured',
      claimNo: normalizedClaimNo,
      recipient: prepared.recipient,
      error: 'Insurer email provider is not configured.'
    };
  }

  const lease = acquireSendLease(db, normalizedClaimNo, prepared.recipient, prepared.idempotencyKey, replyTo, now(), allowRetryFailed);
  if (!lease.acquired) {
    return {
      success: lease.status === 'already_sent' || lease.status === 'send_in_progress',
      eligible: true,
      status: lease.status,
      claimNo: normalizedClaimNo,
      recipient: prepared.recipient,
      messageId: lease.messageId || '',
      sentAt: lease.sentAt || ''
    };
  }

  if (dryRun) {
    const stamp = now();
    const messageId = `dry-run-${prepared.insurerCanonical}-${normalizedClaimNo}`;
    db.prepare(`
      UPDATE claims
      SET insurer_email_status=?,
          insurer_email_sent_at=?,
          insurer_email_recipient=?,
          insurer_email_message_id=?,
          insurer_email_error='',
          insurer_processing_status=?,
          insurer_decision_status=CASE WHEN ?=1 THEN 'awaiting_decision' ELSE insurer_decision_status END,
          insurer_decision_at=CASE WHEN ?=1 THEN NULL ELSE insurer_decision_at END,
          insurer_decision_reason=CASE WHEN ?=1 THEN '' ELSE insurer_decision_reason END,
          insurer_decision_recipient=CASE WHEN ?=1 THEN ? ELSE insurer_decision_recipient END,
          insurer_reply_status=CASE WHEN ?=1 THEN NULL ELSE insurer_reply_status END,
          updated_at=?
      WHERE claim_no=?
    `).run(
      'sent',
      stamp,
      prepared.recipient,
      messageId,
      'submitted',
      decisionEnabled ? 1 : 0,
      decisionEnabled ? 1 : 0,
      decisionEnabled ? 1 : 0,
      decisionEnabled ? 1 : 0,
      prepared.recipient,
      decisionEnabled ? 1 : 0,
      stamp,
      normalizedClaimNo
    );

    return {
      success: true,
      eligible: true,
      status: 'dry_run_sent',
      claimNo: normalizedClaimNo,
      insurer: prepared.insurerDisplayName,
      recipient: prepared.recipient,
      subject: prepared.subject,
      attachmentFilename: prepared.attachmentFilename,
      attachmentPath: prepared.pdfPath,
      attachmentSize: prepared.attachmentSize,
      attachmentMime: prepared.attachmentMime,
      idempotencyKey: prepared.idempotencyKey,
      replyTo,
      messageId
    };
  }

  let providerMessageId = '';
  try {
    const mail = {
      from: String(from).trim(),
      to: [prepared.recipient],
      subject: prepared.subject,
      text: outboundText
    };
    if (outboundHtml) mail.html = outboundHtml;
    if (replyTo) mail.reply_to = replyTo;
    if (prepared.hasAttachment) {
      mail.attachments = [
        {
          content: fs.readFileSync(prepared.pdfPath).toString('base64'),
          filename: prepared.attachmentFilename,
          content_type: prepared.attachmentMime
        }
      ];
    }
    const response = await axios.post(
      RESEND_EMAIL_URL,
      mail,
      {
        headers: {
          Authorization: `Bearer ${String(apiKey).trim()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': prepared.idempotencyKey
        },
        timeout: Number(timeoutMs) > 0 ? Number(timeoutMs) : 12000,
        maxBodyLength: 50 * 1024 * 1024
      }
    );

    providerMessageId = String(response?.data?.id || '').trim();
    if (!providerMessageId) throw new Error('Email provider did not return a message ID.');
  } catch (error) {
    const stamp = now();
    const message = safeErrorMessage(error);
    recordFailure(db, normalizedClaimNo, prepared.recipient, message, stamp);
    return {
      success: false,
      eligible: true,
      status: 'send_failed',
      claimNo: normalizedClaimNo,
      recipient: prepared.recipient,
      error: message
    };
  }

  try {
    const stamp = now();
    db.prepare(`
      UPDATE claims
      SET insurer_email_status=?,
          insurer_email_sent_at=?,
          insurer_email_recipient=?,
          insurer_email_message_id=?,
          insurer_email_error='',
          insurer_processing_status=?,
          insurer_decision_status=CASE WHEN ?=1 THEN 'awaiting_decision' ELSE insurer_decision_status END,
          insurer_decision_at=CASE WHEN ?=1 THEN NULL ELSE insurer_decision_at END,
          insurer_decision_reason=CASE WHEN ?=1 THEN '' ELSE insurer_decision_reason END,
          insurer_decision_recipient=CASE WHEN ?=1 THEN ? ELSE insurer_decision_recipient END,
          insurer_reply_status=CASE
            WHEN ?=1 THEN NULL
            WHEN ?<>'' THEN 'awaiting_reply'
            ELSE insurer_reply_status
          END,
          updated_at=?
      WHERE claim_no=?
    `).run(
      'sent',
      stamp,
      prepared.recipient,
      providerMessageId,
      'submitted',
      decisionEnabled ? 1 : 0,
      decisionEnabled ? 1 : 0,
      decisionEnabled ? 1 : 0,
      decisionEnabled ? 1 : 0,
      prepared.recipient,
      decisionEnabled ? 1 : 0,
      replyTo,
      stamp,
      normalizedClaimNo
    );

    return {
      success: true,
      eligible: true,
      status: 'sent',
      claimNo: normalizedClaimNo,
      insurer: prepared.insurerDisplayName,
      recipient: prepared.recipient,
      subject: prepared.subject,
      attachmentFilename: prepared.attachmentFilename,
      attachmentPath: prepared.pdfPath,
      attachmentSize: prepared.attachmentSize,
      attachmentMime: prepared.attachmentMime,
      idempotencyKey: prepared.idempotencyKey,
      replyTo,
      messageId: providerMessageId,
      sentAt: stamp
    };
  } catch (error) {
    const stamp = now();
    const message = `Provider accepted email but delivery state could not be recorded: ${safeErrorMessage(error)}`;
    try { recordFailure(db, normalizedClaimNo, prepared.recipient, message, stamp, providerMessageId); } catch (_) {}
    return {
      success: false,
      eligible: true,
      status: 'provider_sent_db_update_failed',
      claimNo: normalizedClaimNo,
      recipient: prepared.recipient,
      messageId: providerMessageId,
      error: message
    };
  }
}

module.exports = {
  INSURER_EMAIL_RECIPIENTS,
  OLD_MUTUAL_EMAIL_RECIPIENT,
  normalizeInsurerName,
  getInsurerEmailConfig,
  isOldMutualInsurer,
  buildEmailPayload,
  submitConfirmedClaimEmail,
  submitOldMutualClaimEmail: submitConfirmedClaimEmail
};

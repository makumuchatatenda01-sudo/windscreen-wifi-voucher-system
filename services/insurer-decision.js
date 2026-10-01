'use strict';

const Database = require('better-sqlite3');
const axios = require('axios');
const { verifyDecision } = require('./insurer-decision-utils');

const RESEND_EMAIL_URL = 'https://api.resend.com/emails';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageShell({ title, body, accent = '#0f766e', status = 200 }) {
  return {
    status,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#0f172a;font-family:Arial,Helvetica,sans-serif}
.wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
.card{width:min(620px,100%);background:#fff;border:1px solid #dbe3ef;border-radius:22px;padding:32px;box-shadow:0 16px 45px rgba(15,23,42,.08)}
.badge{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;background:#eef2ff;font-size:12px;font-weight:700;letter-spacing:.04em;color:#334155}
h1{font-size:28px;margin:16px 0 10px}.lead{color:#475569;line-height:1.6;margin:0 0 24px}
.meta{background:#f8fafc;border-radius:14px;padding:15px 16px;margin:18px 0 24px;font-size:14px;color:#475569}
.meta strong{color:#0f172a}
textarea{width:100%;min-height:150px;border:1px solid #cbd5e1;border-radius:14px;padding:14px;font:inherit;resize:vertical}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
button{border:0;border-radius:12px;padding:13px 20px;font-size:15px;font-weight:700;cursor:pointer}
.primary{background:${accent};color:#fff}.secondary{background:#e2e8f0;color:#0f172a}
.note{font-size:13px;color:#64748b;line-height:1.5;margin-top:16px}
.spinner{width:32px;height:32px;border:4px solid #dbe3ef;border-top-color:${accent};border-radius:50%;animation:s 1s linear infinite;margin:20px auto}
@keyframes s{to{transform:rotate(360deg)}}a{color:#2563eb}
</style>
</head>
<body><div class="wrap"><main class="card">${body}</main></div></body>
</html>`
  };
}

function successPage(action, claimNo, reason, comment) {
  const accepted = action === 'accept';
  const label = accepted ? 'Accepted' : 'Declined';
  const accent = accepted ? '#16a34a' : '#dc2626';
  const commentHtml = comment
    ? `<div class="meta"><strong>Comment / Excess:</strong><br>${esc(comment)}</div>`
    : '';
  const reasonHtml = !accepted && reason
    ? `<div class="meta"><strong>Reason:</strong><br>${esc(reason)}</div>`
    : '';
  return pageShell({
    title: `${label} - ${claimNo}`,
    accent,
    body: `
      <div class="badge">WINDSCREEN FITMENT CENTRE</div>
      <h1 style="color:${accent}">Response received. Thank you.</h1>
      <p class="lead">Claim <strong>${esc(claimNo)}</strong> has been recorded as <strong>${label}</strong>.</p>
      ${commentHtml}
      ${reasonHtml}
      <p class="note">You can close this page. The workshop dashboard has been updated automatically.</p>`
  });
}

function alreadyPage(claimNo, current, reason, comment) {
  const label = current === 'accepted' ? 'Accepted' : 'Declined';
  const commentHtml = comment
    ? `<div class="meta"><strong>Recorded comment / excess:</strong><br>${esc(comment)}</div>`
    : '';
  const reasonHtml = current === 'declined' && reason
    ? `<div class="meta"><strong>Recorded reason:</strong><br>${esc(reason)}</div>`
    : '';
  return pageShell({
    title: `Decision already recorded - ${claimNo}`,
    accent: current === 'accepted' ? '#16a34a' : '#dc2626',
    body: `
      <div class="badge">WINDSCREEN FITMENT CENTRE</div>
      <h1>Decision already recorded</h1>
      <p class="lead">Claim <strong>${esc(claimNo)}</strong> is already <strong>${label}</strong>. No changes were made.</p>
      ${commentHtml}
      ${reasonHtml}
      <p class="note">Please contact Windscreen Fitment Centre if this decision needs to be changed.</p>`
  });
}

function invalidPage(message) {
  return pageShell({
    title: 'Unable to record response',
    accent: '#dc2626',
    status: 400,
    body: `
      <div class="badge">WINDSCREEN FITMENT CENTRE</div>
      <h1>Unable to record response</h1>
      <p class="lead">${esc(message || 'This response link is invalid or has expired.')}</p>`
  });
}

function mountInsurerDecisionRoutes(app, options = {}) {
  const db = options.db || new Database(String(options.dbPath || ''));
  const secret = String(options.secret || '').trim();
  const resendApiKey = String(options.resendApiKey || '').trim();
  const from = String(options.from || '').trim();
  const timeoutMs = Number(options.timeoutMs || 12000);

  function loadAndVerify(req, action) {
    const claimNo = String(req.method === 'POST' ? req.body?.claim : req.query?.claim || '').trim().toUpperCase();
    const token = String(req.method === 'POST' ? req.body?.token : req.query?.token || '').trim();
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return { ok: false, message: 'Claim not found.' };
    const recipient = String(claim.insurer_email_recipient || '').trim();
    if (String(claim.insurer_email_status || '').trim().toLowerCase() !== 'sent' || !recipient) {
      return { ok: false, message: 'This claim has not been submitted to an insurer.' };
    }
    const verified = verifyDecision({ secret, claimNo, insurerRecipient: recipient, action, token });
    if (!verified.ok) return { ok: false, message: 'This decision link is invalid.' };
    return { ok: true, claim, claimNo, token };
  }

  function sendHtml(res, page) {
    res.status(page.status || 200);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Referrer-Policy', 'no-referrer');
    return res.send(page.html);
  }

  function safeProviderError(error) {
    const providerMessage = error?.response?.data?.message || error?.response?.data?.error || '';
    return String(providerMessage || error?.message || 'Unable to send acknowledgement email.')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  async function sendDecisionAcknowledgement(claimNo, expectedDecision) {
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return { ok: false, status: 'claim_not_found' };

    const current = String(claim.insurer_decision_status || '').trim().toLowerCase();
    if (current !== expectedDecision) {
      return { ok: false, status: 'decision_mismatch' };
    }

    const existingMessageId = String(claim.insurer_decision_ack_message_id || '').trim();
    if (existingMessageId) {
      return { ok: true, status: 'already_sent', messageId: existingMessageId };
    }

    const recipient = String(claim.insurer_decision_recipient || claim.insurer_email_recipient || '').trim();
    if (!recipient || !resendApiKey || !from) {
      const message = 'Decision acknowledgement email provider is not configured.';
      db.prepare('UPDATE claims SET insurer_decision_ack_error=?, updated_at=? WHERE claim_no=?')
        .run(message, new Date().toISOString(), claimNo);
      return { ok: false, status: 'provider_not_configured', error: message };
    }

    const label = current === 'accepted' ? 'Accepted' : 'Declined';
    const reason = String(claim.insurer_decision_reason || '').trim();
    const comment = String(claim.insurer_decision_comment || '').trim();
    const subject = `Windscreen Fitment Centre | Response received | ${claimNo} | ${label}`;
    const text = [
      'Dear Claims Team,',
      '',
      'Thank you. Your response has been received successfully.',
      '',
      `Claim Reference: ${claimNo}`,
      `Decision: ${label}`,
      ...(comment ? [`Comment / Excess: ${comment}`] : []),
      ...(current === 'declined' ? [`Reason: ${reason || 'No reason provided.'}`] : []),
      '',
      'No further action is required on this response.',
      '',
      'Kind regards,',
      'Windscreen Fitment Centre'
    ].join('\n');

    const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe3ef;border-radius:16px">
        <tr><td style="padding:30px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:8px">WINDSCREEN FITMENT CENTRE</div>
          <h2 style="margin:0 0 14px;font-size:24px;color:#0f172a">Response received. Thank you.</h2>
          <p style="margin:0 0 20px;line-height:1.6;color:#475569">Your response for claim <strong>${esc(claimNo)}</strong> has been recorded successfully.</p>
          <div style="border-radius:12px;padding:16px 18px;background:${current === 'accepted' ? '#effaf4' : '#fff4f5'};color:${current === 'accepted' ? '#117048' : '#a62f3b'}">
            <strong>Decision: ${esc(label)}</strong>
            ${comment ? `<div style="margin-top:8px"><strong>Comment / Excess:</strong> ${esc(comment)}</div>` : ''}
            ${current === 'declined' ? `<div style="margin-top:8px"><strong>Reason:</strong> ${esc(reason || 'No reason provided.')}</div>` : ''}
          </div>
          <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b">No further action is required on this response.</p>
          <p style="margin:24px 0 0;line-height:1.6;color:#475569">Kind regards,<br><strong>Windscreen Fitment Centre</strong></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      const response = await axios.post(
        RESEND_EMAIL_URL,
        {
          from,
          to: [recipient],
          subject,
          text,
          html
        },
        {
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `insurer-decision-ack/${claimNo}/${current}`
          },
          timeout: timeoutMs > 0 ? timeoutMs : 12000
        }
      );
      const messageId = String(response?.data?.id || '').trim();
      if (!messageId) throw new Error('Email provider did not return a message ID.');
      const stamp = new Date().toISOString();
      db.prepare(`
        UPDATE claims SET
          insurer_decision_ack_message_id=?,
          insurer_decision_ack_sent_at=?,
          insurer_decision_ack_error='',
          updated_at=?
        WHERE claim_no=?
      `).run(messageId, stamp, stamp, claimNo);
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(claimNo, 'insurer_decision_ack', `Decision acknowledgement email sent to ${recipient}.`, 'resend', stamp);
      } catch (_) {}
      return { ok: true, status: 'sent', messageId, sentAt: stamp };
    } catch (error) {
      const message = safeProviderError(error);
      const stamp = new Date().toISOString();
      db.prepare('UPDATE claims SET insurer_decision_ack_error=?, updated_at=? WHERE claim_no=?')
        .run(message, stamp, claimNo);
      return { ok: false, status: 'send_failed', error: message };
    }
  }

  function recordDecision(claim, action, reason = '', comment = '') {
    const current = String(claim.insurer_decision_status || '').trim().toLowerCase();
    if (current === 'accepted' || current === 'declined') {
      return {
        changed: false,
        current,
        reason: String(claim.insurer_decision_reason || ''),
        comment: String(claim.insurer_decision_comment || '')
      };
    }

    const stamp = new Date().toISOString();
    const status = action === 'accept' ? 'accepted' : 'declined';
    const internalStatus = action === 'accept' ? 'insurance_accepted' : 'insurance_declined';
    const cleanReason = action === 'decline' ? String(reason || '').trim().slice(0, 1200) : '';
    const cleanComment = String(comment || '').trim().slice(0, 1200);

    db.transaction(() => {
      const fresh = db.prepare('SELECT insurer_decision_status FROM claims WHERE claim_no=?').get(claim.claim_no);
      const freshStatus = String(fresh?.insurer_decision_status || '').trim().toLowerCase();
      if (freshStatus === 'accepted' || freshStatus === 'declined') return;

      db.prepare(`
        UPDATE claims SET
          insurer_decision_status=?,
          insurer_decision_at=?,
          insurer_decision_reason=?,
          insurer_decision_comment=?,
          insurer_processing_status=?,
          status=?,
          updated_at=?
        WHERE claim_no=?
      `).run(status, stamp, cleanReason, cleanComment, status, internalStatus, stamp, claim.claim_no);

      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(
            claim.claim_no,
            'insurer_decision',
            action === 'accept'
              ? `Insurer selected ACCEPT from the claim email.${cleanComment ? ' Comment / Excess: ' + cleanComment : ''}`
              : `Insurer selected DECLINE from the claim email.${cleanComment ? ' Comment / Excess: ' + cleanComment : ''}${cleanReason ? ' Reason: ' + cleanReason : ' No reason provided.'}`,
            'insurer_decision_link',
            stamp
          );
      } catch (_) {}
    })();

    const after = db.prepare('SELECT insurer_decision_status, insurer_decision_reason, insurer_decision_comment FROM claims WHERE claim_no=?').get(claim.claim_no);
    const finalStatus = String(after?.insurer_decision_status || '').trim().toLowerCase();
    return {
      changed: finalStatus === status,
      current: finalStatus,
      reason: String(after?.insurer_decision_reason || ''),
      comment: String(after?.insurer_decision_comment || '')
    };
  }

  app.get('/insurance-response/accept', (req, res) => {
    const check = loadAndVerify(req, 'accept');
    if (!check.ok) return sendHtml(res, invalidPage(check.message));

    const current = String(check.claim.insurer_decision_status || '').trim().toLowerCase();
    if (current === 'accepted' || current === 'declined') {
      return sendHtml(
        res,
        alreadyPage(
          check.claimNo,
          current,
          check.claim.insurer_decision_reason || '',
          check.claim.insurer_decision_comment || ''
        )
      );
    }

    const page = pageShell({
      title: `Accept claim ${check.claimNo}`,
      accent: '#16a34a',
      body: `
        <div class="badge">WINDSCREEN FITMENT CENTRE</div>
        <h1>Accept claim</h1>
        <p class="lead">Claim <strong>${esc(check.claimNo)}</strong>. Add any excess or insurer comment, then confirm acceptance.</p>
        <form method="post" action="/insurance-response/accept">
          <input type="hidden" name="claim" value="${esc(check.claimNo)}">
          <input type="hidden" name="token" value="${esc(check.token)}">
          <label for="comment"><strong>Comment / Excess</strong> <span style="color:#64748b;font-size:12px">(optional)</span></label>
          <textarea id="comment" name="comment" maxlength="1200" placeholder="Example: 33% excess or Nil excess"></textarea>
          <div class="actions">
            <button class="primary" type="submit">Confirm Accept</button>
          </div>
        </form>
        <p class="note">The decision and comment will update the workshop dashboard automatically.</p>`
    });
    return sendHtml(res, page);
  });

  app.post('/insurance-response/accept', async (req, res) => {
    const check = loadAndVerify(req, 'accept');
    if (!check.ok) return sendHtml(res, invalidPage(check.message));
    const comment = String(req.body?.comment || '').trim();
    const result = recordDecision(check.claim, 'accept', '', comment);
    if (!result.changed && result.current !== 'accepted') {
      return sendHtml(res, alreadyPage(check.claimNo, result.current, result.reason, result.comment));
    }
    await sendDecisionAcknowledgement(check.claimNo, 'accepted');
    return sendHtml(res, successPage('accept', check.claimNo, '', result.comment));
  });

  app.get('/insurance-response/decline', (req, res) => {
    const check = loadAndVerify(req, 'decline');
    if (!check.ok) return sendHtml(res, invalidPage(check.message));

    const current = String(check.claim.insurer_decision_status || '').trim().toLowerCase();
    if (current === 'accepted' || current === 'declined') {
      return sendHtml(
        res,
        alreadyPage(
          check.claimNo,
          current,
          check.claim.insurer_decision_reason || '',
          check.claim.insurer_decision_comment || ''
        )
      );
    }

    const page = pageShell({
      title: `Decline claim ${check.claimNo}`,
      accent: '#dc2626',
      body: `
        <div class="badge">WINDSCREEN FITMENT CENTRE</div>
        <h1>Decline claim</h1>
        <p class="lead">Claim <strong>${esc(check.claimNo)}</strong>. Add any excess or insurer comment, then submit the decline.</p>
        <form method="post" action="/insurance-response/decline">
          <input type="hidden" name="claim" value="${esc(check.claimNo)}">
          <input type="hidden" name="token" value="${esc(check.token)}">

          <label for="comment"><strong>Comment / Excess</strong> <span style="color:#64748b;font-size:12px">(optional)</span></label>
          <textarea id="comment" name="comment" maxlength="1200" placeholder="Example: 33% excess or Nil excess"></textarea>

          <div style="height:16px"></div>
          <label for="reason"><strong>Reason for declining</strong> <span style="color:#64748b;font-size:12px">(optional)</span></label>
          <textarea id="reason" name="reason" maxlength="1200" placeholder="Type the decline reason here…"></textarea>

          <div class="actions">
            <button class="primary" type="submit" name="mode" value="submit">Confirm Decline</button>
            <button class="secondary" type="submit" name="mode" value="skip">Decline without reason</button>
          </div>
        </form>
        <p class="note">The decision, comment and any decline reason will update the workshop dashboard automatically.</p>`
    });
    return sendHtml(res, page);
  });

  app.post('/insurance-response/decline', async (req, res) => {
    const check = loadAndVerify(req, 'decline');
    if (!check.ok) return sendHtml(res, invalidPage(check.message));
    const skip = String(req.body?.mode || '').toLowerCase() === 'skip';
    const reason = skip ? '' : String(req.body?.reason || '').trim();
    const comment = String(req.body?.comment || '').trim();
    const result = recordDecision(check.claim, 'decline', reason, comment);
    if (!result.changed && result.current !== 'declined') {
      return sendHtml(res, alreadyPage(check.claimNo, result.current, result.reason, result.comment));
    }
    await sendDecisionAcknowledgement(check.claimNo, 'declined');
    return sendHtml(res, successPage('decline', check.claimNo, result.reason, result.comment));
  });

  return { db };
}

module.exports = { mountInsurerDecisionRoutes };

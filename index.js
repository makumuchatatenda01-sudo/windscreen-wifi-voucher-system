require('dotenv').config();

// VP_SECRET_LOG_REDACTOR_V1
try {
  if (!global.__VP_SECRET_LOG_REDACTOR_V1__) {
    global.__VP_SECRET_LOG_REDACTOR_V1__ = true;

    const util = require('util');
    const rawLog = console.log.bind(console);
    const rawInfo = console.info.bind(console);
    const rawWarn = console.warn.bind(console);
    const rawError = console.error.bind(console);

    function vpRedactLogArg(arg) {
      let out = typeof arg === 'string'
        ? arg
        : util.inspect(arg, { depth: 5, colors: false, maxArrayLength: 50 });

      const secrets = [
        process.env.YCLOUD_API_KEY,
        process.env.DEEPSEEK_API_KEY,
        process.env.ADMIN_PIN,
        process.env.STUDIO_PIN,
        process.env.ADMIN_PASSWORD,
        process.env.RESEND_API_KEY,
        process.env.RESEND_WEBHOOK_SECRET,
        process.env.INSURER_REPLY_SECRET,
        process.env.YCLOUD_WEBHOOK_SECRET,
        process.env.DOCUMENT_VERIFY_API_KEY,
        process.env.KTPOS_API_KEY,
        process.env.KEITHSTOPS_API_KEY
      ].filter(Boolean);

      for (const secret of secrets) {
        out = out.split(secret).join('***HIDDEN***');
      }

      out = out
        .replace(/X-API-Key:\s*[^\r\n'"]+/gi, 'X-API-Key: ***HIDDEN***')
        .replace(/("X-API-Key"\s*:\s*")[^"]+(")/gi, '$1***HIDDEN***$2')
        .replace(/Authorization:\s*(?:Bearer|Token)\s+[^\s,'"]+/gi, 'Authorization: ***HIDDEN***')
        .replace(/("Authorization"\s*:\s*")[^"]+(")/gi, '$1***HIDDEN***$2')
        .replace(/(YCLOUD_API_KEY=).+/gi, '$1***HIDDEN***')
        .replace(/(DEEPSEEK_API_KEY=).+/gi, '$1***HIDDEN***');

      return out;
    }

    console.log = (...args) => rawLog(...args.map(vpRedactLogArg));
    console.info = (...args) => rawInfo(...args.map(vpRedactLogArg));
    console.warn = (...args) => rawWarn(...args.map(vpRedactLogArg));
    console.error = (...args) => rawError(...args.map(vpRedactLogArg));
  }
} catch (e) {
  console.error('LOG_REDACTOR_INIT_ERROR');
}


const express = require('express');
const axios = require('axios');
const https = require('https');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
let sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
const fs = require('fs');
const keithstops = require('./integrations/keithstops');
const insurerEmail = require('./services/old-mutual-email');
const insurerInboundEmail = require('./services/insurer-inbound-email');
const insurerDecision = require('./services/insurer-decision');
const monthlyStatsReport = require('./services/monthly-stats-report');
const path = require('path');
const crypto = require('crypto');

const app = express();

// INSURER_INBOUND_EMAIL_V1
// Must be mounted before express.json() so Svix verifies the untouched raw body.
const insurerInboundRuntime = insurerInboundEmail.mountInsurerInboundWebhook(app, express, {
  dbPath: '/opt/auto-glass-bot/data/workshop.db',
  apiKey: process.env.RESEND_API_KEY || '',
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
  replySecret: process.env.INSURER_REPLY_SECRET || '',
  replyDomain: process.env.INSURER_REPLY_DOMAIN || 'autoglassinsurance.visionpixels.autos',
  from: process.env.OLD_MUTUAL_EMAIL_FROM || '',
  enabled: String(process.env.INSURER_REPLY_ENABLED || '').trim().toLowerCase() === 'true'
});

// VP_FINAL_EXACT_CLAIM_MEDIA_DISPLAY_V3
function vpFinalClaimRef(item) {
  return item?.claim_no || item?.claimNo || item?.claim_ref || item?.claimRef || item?.ref || item?.reference || item?.id || '';
}

function vpFinalPublicFileUrl(absPath) {
  try {
    const publicRoot = path.join(__dirname, 'public');
    const rel = path.relative(publicRoot, absPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) return null;
    return `/files/${rel}`;
  } catch (_) {
    return null;
  }
}

let vpFinalClaimImageIndex = { builtAt: 0, map: new Map() };

function vpFinalBuildClaimImageIndex() {
  const map = new Map();
  const roots = [
    path.join(__dirname, 'public', 'uploads', 'whatsapp'),
    path.join(__dirname, 'public', 'claim-role-images')
  ];

  for (const dir of roots) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }

    for (const entry of entries) {
      if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
      const match = entry.name.match(/^(.+?)-image-/i);
      if (!match) continue;
      const ref = String(match[1] || '').toLowerCase();
      if (!ref) continue;
      const url = vpFinalPublicFileUrl(path.join(dir, entry.name));
      if (!url) continue;
      const row = {
        url,
        path: url,
        filename: entry.name,
        name: entry.name,
        claim_ref: match[1],
        claimNo: match[1],
        type: 'image'
      };
      if (!map.has(ref)) map.set(ref, []);
      map.get(ref).push(row);
    }
  }

  for (const rows of map.values()) {
    rows.sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
  }
  vpFinalClaimImageIndex = { builtAt: Date.now(), map };
}

function vpFinalFindClaimImagesByRef(ref) {
  if (!ref) return [];
  // A single response can contain many claims. Rebuild at most once per second
  // instead of recursively walking the entire public tree once per claim.
  if (!vpFinalClaimImageIndex.builtAt || Date.now() - vpFinalClaimImageIndex.builtAt > 1000) {
    vpFinalBuildClaimImageIndex();
  }
  const rows = vpFinalClaimImageIndex.map.get(String(ref).toLowerCase()) || [];
  return rows.map(row => ({ ...row, claim_ref: ref, claimNo: ref }));
}

function vpFinalCleanSingleClaimMedia(claim) {
  if (!claim || typeof claim !== 'object') return claim;

  const ref = vpFinalClaimRef(claim);
  if (!ref) return claim;

  const exactImages = vpFinalFindClaimImagesByRef(ref);

  // Dashboard image cards must ONLY use exact claim images
  claim.photos = exactImages;
  claim.images = exactImages;
  claim.media = exactImages;
  claim.claimPhotos = exactImages;

  // Documents must stay PDF only
  if (Array.isArray(claim.documents)) {
    claim.documents = claim.documents.filter(doc => {
      const text = typeof doc === 'string'
        ? doc
        : String(doc?.url || doc?.path || doc?.filename || doc?.name || '');

      return /\.pdf(\?|$)/i.test(text);
    });
  }

  return claim;
}

function vpFinalCleanClaimPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload.claims)) {
    payload.claims = payload.claims.map(vpFinalCleanSingleClaimMedia);
  }

  if (payload.claim && typeof payload.claim === 'object') {
    payload.claim = vpFinalCleanSingleClaimMedia(payload.claim);
  }

  for (const key of Object.keys(payload)) {
    const value = payload[key];

    if (value && typeof value === 'object') {
      vpFinalCleanClaimPayload(value);
    }
  }

  return payload;
}

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    try {
      body = vpFinalCleanClaimPayload(body);
    } catch (e) {
      console.error('VP_FINAL_EXACT_CLAIM_MEDIA_DISPLAY_ERROR', e.message);
    }

    return originalJson(body);
  };

  next();
});


// VP_STRICT_CLAIM_MEDIA_FILTER_V2
function vpClaimRefOf(item) {
  return item?.claim_no || item?.claimNo || item?.claim_ref || item?.claimRef || item?.ref || item?.reference || item?.id || '';
}

function vpMediaBelongsToClaim(media, claimRef) {
  if (!media || !claimRef) return false;

  const ref = String(claimRef).toLowerCase();

  if (typeof media === 'string') {
    return media.toLowerCase().includes(ref) && /\.(png|jpe?g|webp|pdf)(\?|$)/i.test(media);
  }

  const direct = vpClaimRefOf(media);
  if (direct && String(direct).toLowerCase() === ref) return true;

  const fileText = String(media.url || media.path || media.filename || media.name || media.file || '').toLowerCase();
  if (fileText.includes(ref) && /\.(png|jpe?g|webp|pdf)(\?|$)/i.test(fileText)) return true;

  try {
    const txt = JSON.stringify(media).toLowerCase();
    const safe = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`"(claim_no|claimNo|claim_ref|claimRef|ref|reference)"\\s*:\\s*"${safe}"`, 'i').test(txt);
  } catch (_) {
    return false;
  }
}

function vpCleanClaimObjectImages(claim) {
  if (!claim || typeof claim !== 'object') return claim;

  const ref = vpClaimRefOf(claim);
  const keys = ['photos', 'images', 'media', 'attachments', 'claimPhotos', 'claimImages'];

  for (const key of keys) {
    if (!Array.isArray(claim[key])) continue;
    claim[key] = claim[key].filter(item => vpMediaBelongsToClaim(item, ref));
  }

  if (Array.isArray(claim.documents)) {
    claim.documents = claim.documents.filter(item => {
      const text = typeof item === 'string'
        ? item
        : String(item?.url || item?.path || item?.filename || item?.name || '');

      if (/\.pdf(\?|$)/i.test(text)) return true;
      return vpMediaBelongsToClaim(item, ref);
    });
  }

  return claim;
}

function vpCleanClaimPayloadImages(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  if (Array.isArray(payload.claims)) {
    payload.claims = payload.claims.map(vpCleanClaimObjectImages);
  }

  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') vpCleanClaimPayloadImages(value);
  }

  return payload;
}

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    try {
      body = vpCleanClaimPayloadImages(body);
    } catch (_) {}

    return originalJson(body);
  };

  next();
});

function vpCaptureRawWebhookBody(req, res, buf) {
  try {
    const routePath = String(req.originalUrl || req.url || '').split('?')[0];
    if (routePath === '/webhook') req.vpRawWebhookBody = Buffer.from(buf || []);
  } catch (_) {}
}

app.use(express.json({ limit: '30mb', verify: vpCaptureRawWebhookBody }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));


app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (String(req.path || '').startsWith('/api/')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

const PORT = Number(process.env.PORT || 3015);
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Auto Glass Workshop';
const SENDER = process.env.YCLOUD_SENDER_NUMBER;
const ADMIN = process.env.ADMIN_WHATSAPP_NUMBER;
const API_KEY = process.env.YCLOUD_API_KEY;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const ADMIN_PIN = process.env.ADMIN_PIN || '';

const DOCUMENT_VERIFY_API_URL = process.env.DOCUMENT_VERIFY_API_URL || '';
const DOCUMENT_VERIFY_API_KEY = process.env.DOCUMENT_VERIFY_API_KEY || '';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');

const ROOT = '/opt/auto-glass-bot';
const DB_PATH = path.join(ROOT, 'data', 'workshop.db');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PDF_DIR = path.join(PUBLIC_DIR, 'pdfs');
const LOGO_DIR = path.join(PUBLIC_DIR, 'logos');

fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(LOGO_DIR, { recursive: true });

app.get('/files/renovation/sidebar-v1/index.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'renovation', 'sidebar-v1', 'index.html'));
});

app.use('/files', express.static(PUBLIC_DIR, {
  maxAge: '1d',
  fallthrough: false
}));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  phone TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_no TEXT UNIQUE NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  vehicle TEXT,
  reg_no TEXT,
  service TEXT,
  job_type TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'new_booking',
  fitter TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_no TEXT UNIQUE NOT NULL,
  job_no TEXT,
  customer_phone TEXT NOT NULL,
  insurer TEXT,
  status TEXT NOT NULL DEFAULT 'claim_form_received',
  data TEXT NOT NULL DEFAULT '{}',
  pdf_url TEXT,
  pdf_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  job_no TEXT,
  claim_no TEXT,
  type TEXT,
  media_id TEXT,
  url TEXT,
  caption TEXT,
  raw TEXT,
  created_at TEXT NOT NULL
);
`);

function tryAlter(sql) {
  try { db.exec(sql); } catch (err) {
    if (!String(err.message || '').includes('duplicate column name')) throw err;
  }
}
tryAlter('ALTER TABLE claims ADD COLUMN pdf_url TEXT;');
tryAlter('ALTER TABLE claims ADD COLUMN pdf_path TEXT;');


// Phase 2A KEITH TECH POS workflow columns
[
  ['claims', 'keithstops_status', 'TEXT'],
  ['claims', 'keithstops_reference', 'TEXT'],
  ['claims', 'keithstops_last_sync', 'TEXT'],
  ['claims', 'keithstops_error', 'TEXT'],
  ['claims', 'insurer_processing_status', 'TEXT'],
  ['claims', 'old_mutual_email_status', 'TEXT'],
  ['claims', 'old_mutual_email_sent_at', 'TEXT'],
  ['claims', 'old_mutual_email_recipient', 'TEXT'],
  ['claims', 'old_mutual_email_message_id', 'TEXT'],
  ['claims', 'old_mutual_email_error', 'TEXT'],
  ['claims', 'old_mutual_email_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['claims', 'old_mutual_email_idempotency_key', 'TEXT'],
  ['claims', 'insurer_email_status', 'TEXT'],
  ['claims', 'insurer_email_sent_at', 'TEXT'],
  ['claims', 'insurer_email_recipient', 'TEXT'],
  ['claims', 'insurer_email_message_id', 'TEXT'],
  ['claims', 'insurer_email_error', 'TEXT'],
  ['claims', 'insurer_email_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['claims', 'insurer_email_idempotency_key', 'TEXT'],
  ['claims', 'insurer_email_reply_to', 'TEXT'],
  ['claims', 'insurer_reply_status', 'TEXT'],
  ['claims', 'insurer_reply_received_at', 'TEXT'],
  ['claims', 'insurer_reply_email_id', 'TEXT'],
  ['claims', 'insurer_reply_from', 'TEXT'],
  ['claims', 'insurer_reply_message_id', 'TEXT'],
  ['claims', 'insurer_reply_ack_message_id', 'TEXT'],
  ['claims', 'insurer_decision_status', 'TEXT'],
  ['claims', 'insurer_decision_at', 'TEXT'],
  ['claims', 'insurer_decision_reason', 'TEXT'],
  ['claims', 'insurer_decision_comment', 'TEXT'],
  ['claims', 'insurer_decision_recipient', 'TEXT'],
  ['claims', 'insurer_decision_ack_message_id', 'TEXT'],
  ['claims', 'insurer_decision_ack_sent_at', 'TEXT'],
  ['claims', 'insurer_decision_ack_error', 'TEXT'],
  ['jobs', 'keithstops_status', 'TEXT'],
  ['jobs', 'keithstops_reference', 'TEXT'],
  ['jobs', 'keithstops_last_sync', 'TEXT'],
  ['jobs', 'keithstops_error', 'TEXT'],
  ['jobs', 'invoice_status', 'TEXT'],
  ['jobs', 'processing_status', 'TEXT']
].forEach(([table, col, type]) => {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
  } catch (e) {}
});

const insurerDecisionRuntime = insurerDecision.mountInsurerDecisionRoutes(app, {
  db,
  secret: process.env.INSURER_DECISION_SECRET || process.env.INSURER_REPLY_SECRET || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  from: process.env.OLD_MUTUAL_EMAIL_FROM || '',
  timeoutMs: 12000
});

function now() {
  return new Date().toISOString();
}

function harareDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function safeJsonParse(str, fallback = {}) {
  try { return JSON.parse(str || '{}'); } catch { return fallback; }
}


const INSURER_LOGO_PAGES = {
  'Old Mutual': 'https://ibb.co/zTfSxKpm',
  'Zimnat': 'https://ibb.co/N60F3Sth',
  'Moovah': 'https://ibb.co/b5X83LfG',
  'Evolution': 'https://ibb.co/xKsddXTP',
  'Cell': 'https://ibb.co/VYbq4Wbn'
};

async function resolveImgBbDirectImage(pageUrl) {
  if (!pageUrl) return null;

  try {
    const res = await axios.get(pageUrl, { timeout: 20000 });
    const html = String(res.data || '');

    const m =
      html.match(/property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/content="([^"]+)"\s+property="og:image"/i);

    return m ? m[1] : null;
  } catch (err) {
    console.error('LOGO_RESOLVE_ERROR:', pageUrl, err.message);
    return null;
  }
}


async function cleanLogoBackground(inputPath, outputPath) {
  if (!sharp || !inputPath || !fs.existsSync(inputPath)) return inputPath;

  try {
    const raw = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const data = raw.data;
    const info = raw.info;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Remove white / off-white / light grey logo backgrounds.
      if (r > 225 && g > 225 && b > 225 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18) {
        data[i + 3] = 0;
      }
    }

    await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);

    return outputPath;
  } catch (err) {
    console.error('LOGO_CLEAN_ERROR:', err.message);
    return inputPath;
  }
}

async function getInsurerLogoPath(insurer) {
  const safe = insurer.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const rawPath = path.join(LOGO_DIR, `${safe}-raw.png`);
  const oldPath = path.join(LOGO_DIR, `${safe}.png`);
  const cleanPath = path.join(LOGO_DIR, `${safe}-clean.png`);

  if (fs.existsSync(cleanPath)) return cleanPath;

  if (fs.existsSync(rawPath)) {
    return cleanLogoBackground(rawPath, cleanPath);
  }

  if (fs.existsSync(oldPath)) {
    return cleanLogoBackground(oldPath, cleanPath);
  }

  const pageUrl = INSURER_LOGO_PAGES[insurer];
  if (!pageUrl) return null;

  try {
    const imgUrl = await resolveImgBbDirectImage(pageUrl);
    if (!imgUrl) return null;

    const res = await axios.get(imgUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });

    fs.writeFileSync(rawPath, Buffer.from(res.data));
    return cleanLogoBackground(rawPath, cleanPath);
  } catch (err) {
    console.error('LOGO_DOWNLOAD_ERROR:', insurer, err.message);
    return null;
  }
}

function drawLabelValue(doc, x, y, w, label, value, opts = {}) {
  const labelColor = opts.labelColor || '#475569';
  const valueColor = opts.valueColor || '#0f172a';
  const lineColor = opts.lineColor || '#e2e8f0';

  doc.font('Helvetica-Bold').fontSize(8).fillColor(labelColor).text(label, x, y, { width: w });
  doc.font('Helvetica').fontSize(10).fillColor(valueColor).text(String(value || '-'), x, y + 11, { width: w });

  if (opts.line !== false) {
    doc.save();
    doc.moveTo(x, y + 29).lineTo(x + w, y + 29).strokeColor(lineColor).lineWidth(0.7).stroke();
    doc.restore();
  }
}

function drawSectionHeader(doc, y, title, color = '#0f766e') {
  doc.save();
  doc.roundedRect(40, y, 515, 20, 6).fill(color);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(title, 50, y + 6);
  doc.restore();
  return y + 28;
}

function drawInfoCard(doc, y, h = 88) {
  doc.save();
  doc.roundedRect(40, y, 515, h, 10)
    .fillAndStroke('#ffffff', '#dbe4ee');
  doc.restore();
  return y + 10;
}

function drawSmallPill(doc, text, x, y, w = 110) {
  doc.save();
  doc.roundedRect(x, y, w, 18, 9).fill('#ecfeff');
  doc.fillColor('#155e75').font('Helvetica-Bold').fontSize(8).text(text, x + 8, y + 5, { width: w - 16, align: 'center' });
  doc.restore();
}


function normPhone(v) {
  if (!v) return '';
  let s = String(v).trim();
  if (s.startsWith('whatsapp:')) s = s.replace('whatsapp:', '');
  s = s.replace(/[^\d+]/g, '');
  if (!s.startsWith('+') && s.length > 7) s = '+' + s;
  return s;
}

function isAdmin(phone) {
  return normPhone(phone) === normPhone(ADMIN);
}

function getSession(phone) {
  const row = db.prepare('SELECT * FROM sessions WHERE phone=?').get(phone);
  if (!row) return { phone, state: 'idle', data: {} };
  return { phone, state: row.state, data: safeJsonParse(row.data) };
}

function setSession(phone, state, data = {}) {
  db.prepare(`
    INSERT INTO sessions (phone, state, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      state=excluded.state,
      data=excluded.data,
      updated_at=excluded.updated_at
  `).run(phone, state, JSON.stringify(data), now());
}

function resetSession(phone) {
  setSession(phone, 'idle', {});
}

db.exec(`
  CREATE TABLE IF NOT EXISTS number_sequences (
    prefix TEXT PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);

const vpNextNumberTxn = db.transaction((prefix, table, column) => {
  const startIndex = prefix.length + 2; // SQLite SUBSTR is 1-based; skip "XX-".
  const maxRow = db.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(${column}, ?) AS INTEGER)), 0) AS max_value
    FROM ${table}
    WHERE ${column} GLOB ?
  `).get(startIndex, `${prefix}-[0-9]*`);
  const sequence = db.prepare('SELECT last_value FROM number_sequences WHERE prefix=?').get(prefix);
  const base = Math.max(Number(maxRow?.max_value || 0), Number(sequence?.last_value || 0));
  const nextValue = base + 1;
  db.prepare(`
    INSERT INTO number_sequences (prefix, last_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(prefix) DO UPDATE SET
      last_value=excluded.last_value,
      updated_at=excluded.updated_at
  `).run(prefix, nextValue, now());
  return nextValue;
});

function nextNo(prefix, table) {
  const allowed = {
    jobs: { prefix: 'JC', column: 'job_no' },
    claims: { prefix: 'CL', column: 'claim_no' }
  };
  const spec = allowed[table];
  if (!spec || prefix !== spec.prefix) throw new Error('Unsupported sequence request.');
  const nextValue = vpNextNumberTxn(prefix, table, spec.column);
  return `${prefix}-${String(nextValue).padStart(4, '0')}`;
}

// YCLOUD_IPV4_STABILITY_V1
// api.ycloud.com resolves IPv6 first on this VPS. Intermittent IPv6 TLS
// handshakes have caused customer-facing WhatsApp reply delays/failures.
// Keep this scoped to YCloud only; the rest of the app keeps normal DNS behavior.
const vpYcloudHttpsAgent = new https.Agent({ family: 4 });

async function ycloud(payload) {
  if (!API_KEY || !SENDER) {
    console.log('YCLOUD_NOT_CONFIGURED', { type: payload?.type || 'unknown' });
    return null;
  }

  try {
    const res = await axios.post(
      'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly',
      { from: SENDER, ...payload },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        httpsAgent: vpYcloudHttpsAgent,
        timeout: 20000
      }
    );
    return res.data;
  } catch (err) {
    console.error('YCLOUD_SEND_ERROR:', err.response?.status, JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}

async function sendText(to, text) {
  // VP_SAFE_CLIENT_DEMO_SENDTEXT_FILTER_V2
  try {
    if (typeof text === 'string') {
      text = text.replace(/^Received:\s*/i, '').trim();
    }

    const __vpCustomerMsg = String(text || '');

    if (/KEITH TECH POS|POS SUBMISSION|submitted_to_keith_tech_pos|already exists in KEITH TECH POS|KEITH TECH POS Ref|Triggered by:|Result: This claim already exists/i.test(__vpCustomerMsg)) {
      console.log('CLIENT_DEMO_SUPPRESSED_POS_CUSTOMER_MESSAGE');
      return { ok: true, suppressed: true };
    }

    if (/Claim pack submitted for processing/i.test(__vpCustomerMsg)) {
      console.log('CLIENT_DEMO_SUPPRESSED_EXTRA_PROCESSING_MESSAGE');
      return { ok: true, suppressed: true };
    }

    if (/message didn.?t come through clearly/i.test(__vpCustomerMsg)) {
      let __vpSess = null;
      try {
        if (typeof getSession === 'function') __vpSess = getSession(arguments[0]);
      } catch {}

      if (__vpSess && /^(claim_|book_|quote_)/i.test(String(__vpSess.state || ''))) {
        console.log('CLIENT_DEMO_SUPPRESSED_AI_FALLBACK_DURING_FLOW', __vpSess.state);
        return { ok: true, suppressed: true };
      }
    }
  } catch (e) {
    console.error('CLIENT_DEMO_SENDTEXT_FILTER_ERROR:', e.message);
  }


  return ycloud({
    to,
    type: 'text',
    text: { body: text }
  });
}


// VP_TAP_BUTTON_HINT_V1
function vpTapButtonHintText(text, mode = 'button', buttonText = '', buttons = []) {
  let clean = String(text || '').trim();

  // Remove older repeated button guidance if present.
  clean = clean
    .replace(/\n*👇\s*Please tap[\s\S]*?below to continue\.\s*$/i, '')
    .replace(/\n*Tap\s+\*?Open Menu\*?\s+below to choose what you need\.\s*/i, '\n')
    .replace(/\n*Please choose an option below:\s*/i, '\n')
    .trim();

  const buttonLabels = Array.isArray(buttons)
    ? buttons.map(b => String(b?.title || b?.text || b?.label || b?.id || '').toLowerCase())
    : [];

  const isTypingQuestion =
    /type your answer below/i.test(clean) ||
    /please type/i.test(clean) ||
    /example:/i.test(clean);

  const onlyNavigationButtons =
    buttonLabels.length > 0 &&
    buttonLabels.every(x => /back|menu|previous|cancel/.test(x));

  // For questions where the customer must type, Back/Menu buttons are only navigation.
  // Do not tell them to tap buttons.
  if (mode === 'button' && (isTypingQuestion || onlyNavigationButtons)) {
    return clean;
  }

  if (mode === 'list') {
    const btn = String(buttonText || 'Open Menu').replace(/\*/g, '').trim();
    return `${clean}\n\n👇 Please tap *${btn}* below to continue.`;
  }

  return `${clean}\n\n👇 Please tap one of the buttons below to continue.`;
}


async function sendButtons(to, text, buttons) {
  text = vpTapButtonHintText(text, 'button', '', buttons);
  // VP_STORE_LAST_INTERACTIVE_BUTTONS_V1
  try {
    const __ids = Array.isArray(buttons) ? buttons.map(b => String(b?.id || '').toLowerCase()) : [];
    const __skipStore =
      __ids.includes('ai_continue_flow') ||
      __ids.includes('flow_continue') ||
      __ids.includes('flow_talk_team') ||
      __ids.some(x => x.startsWith('ai_route_'));
    const __session = typeof getSession === 'function' ? getSession(to) : null;

    if (__session && !__skipStore) {
      __session.lastInteractiveStep = {
        mode: 'buttons',
        text,
        buttons: JSON.parse(JSON.stringify(buttons || [])),
        at: Date.now()
      };
    }
  } catch (e) {
    console.error('STORE_LAST_BUTTON_STEP_ERROR:', e.message);
  }

  return ycloud({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: {
        buttons: buttons.slice(0, 3).map(b => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) }
        }))
      }
    }
  });
}

async function sendList(to, bodyText, buttonText, rows, sectionTitle = 'Options') {
  bodyText = vpTapButtonHintText(bodyText, 'list', buttonText);
  // VP_STORE_LAST_INTERACTIVE_LIST_V1
  try {
    const __session = typeof getSession === 'function' ? getSession(to) : null;

    if (__session) {
      __session.lastInteractiveStep = {
        mode: 'list',
        bodyText,
        buttonText,
        rows: JSON.parse(JSON.stringify(rows || [])),
        sectionTitle,
        at: Date.now()
      };
    }
  } catch (e) {
    console.error('STORE_LAST_LIST_STEP_ERROR:', e.message);
  }

  return ycloud({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: [{
          title: sectionTitle.slice(0, 24),
          rows: rows.slice(0, 10).map(r => ({
            id: r.id,
            title: r.title.slice(0, 24),
            description: (r.description || '').slice(0, 72)
          }))
        }]
      }
    }
  });
}

async function sendDocument(to, url, filename, caption = '') {
  try {
    return await ycloud({
      to,
      type: 'document',
      document: {
        link: url,
        filename,
        caption
      }
    });
  } catch (err) {
    console.error('DOCUMENT_SEND_FAILED_FALLING_BACK_TO_LINK');
    return sendText(to, `${caption ? caption + '\n\n' : ''}${filename}\n${url}`);
  }
}


async function sendGuidedPrompt(to, body, backId = 'back_prev') {
  // VP_SAVE_LAST_FLOW_PROMPT_V2
  try {
    const __vpSession = typeof getSession === 'function' ? getSession(arguments[0]) : null;
    if (__vpSession) {
      __vpSession.lastFlowPrompt = String(arguments[1] || '').trim();
      __vpSession.lastFlowPromptAt = Date.now();
    }
  } catch (e) {
    console.error('SAVE_LAST_FLOW_PROMPT_ERROR:', e.message);
  }


  return sendButtons(to,
`${body}

✍️ Type your answer below.

↩️ Use Back if you need to correct the previous step.`,
    [
      { id: backId, title: '↩️ Back' },
      { id: 'back_main', title: ' Menu' }
    ]
  );
}

async function sendUploadPrompt(to, body, backId = 'back_prev') {
  return sendButtons(to,
`${body}

📎 Upload it below.

Tip: Please send it as a normal photo/document, not view-once.`,
    [
      { id: backId, title: '↩️ Back' },
      { id: 'back_main', title: ' Menu' }
    ]
  );
}

// VP_ANTISMASH_PHOTO_ONLY_PROMPT_V1
async function sendPhotoOnlyPrompt(to, body, backId = 'back_prev') {
  return sendButtons(to,
`${body}

📎 Upload the photo below.

Tip: Please send it as a normal photo, not view-once.`,
    [
      { id: backId, title: '↩️ Back' },
      { id: 'back_main', title: ' Menu' }
    ]
  );
}

async function insuranceCompanyList(to) {
  setSession(to, 'claim_choose_insurer', {});
  return sendList(
    to,
    ' Which insurance company claim form do you need?',
    'Insurers',
    [
      { id: 'claim_old_mutual', title: '🏦 Old Mutual', description: 'Motor glass claim form' },
      { id: 'claim_zimnat', title: '🟢 Zimnat', description: 'Insurance claim form' },
      { id: 'claim_moovah', title: '🚗 Moovah', description: 'Insurance claim form' },
      { id: 'claim_evolution', title: '🛡️ Evolution', description: 'Insurance claim form' },
      { id: 'claim_cell', title: '📱 Cell', description: 'Insurance claim form' },
      { id: 'claim_alliance', title: '🤝 Alliance Insurance', description: 'Insurance claim form' },
      { id: 'claim_not_sure', title: '❓ Not Sure', description: 'Let the team assist' }
    ],
    'Insurance Companies'
  );
}

async function askJobType(to, data) {
  setSession(to, data.__purpose === 'quote' ? 'quote_type' : 'book_type', data);
  return sendButtons(to, ' Is this a cash job or insurance job?', [
    { id: 'job_cash', title: 'Cash Job' },
    { id: 'job_insurance', title: 'Insurance Job' },
    { id: 'job_not_sure', title: '❓ Not Sure' }
  ]);
}

async function askBookingDate(to, data) {
  setSession(to, 'book_date', data);
  return sendButtons(to, '📅 When do you need this done?', [
    { id: 'date_today', title: 'Today' },
    { id: 'date_tomorrow', title: 'Tomorrow' },
    { id: 'date_choose', title: 'Choose Date' }
  ]);
}


async function alertAdmin(text) {
  if (!ADMIN) return null;
  try { return await sendText(ADMIN, text); } catch { return null; }
}

function extractInbound(body) {
  const msg =
    body?.whatsappInboundMessage ||
    body?.data?.whatsappInboundMessage ||
    body?.message ||
    body?.data?.message ||
    body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    body?.messages?.[0] ||
    body?.data?.messages?.[0] ||
    body;

  const from = normPhone(
    msg.from ||
    msg.customerPhone ||
    msg.customer?.phone ||
    msg.waId ||
    msg.wa_id ||
    body.from ||
    body.customerPhone ||
    body?.data?.from
  );

  const interactiveId =
    msg?.interactive?.list_reply?.id ||
    msg?.interactive?.button_reply?.id ||
    msg?.list_reply?.id ||
    msg?.button_reply?.id ||
    msg?.buttonReply?.id ||
    msg?.listReply?.id ||
    msg?.reply?.id;

  const interactiveTitle =
    msg?.interactive?.list_reply?.title ||
    msg?.interactive?.button_reply?.title ||
    msg?.list_reply?.title ||
    msg?.button_reply?.title ||
    msg?.buttonReply?.title ||
    msg?.listReply?.title ||
    msg?.reply?.title;

  const text =
    interactiveId ||
    interactiveTitle ||
    msg?.text?.body ||
    msg?.text ||
    msg?.button?.text ||
    msg?.messageBody ||
    msg?.body ||
    msg?.content?.text ||
    body?.text?.body ||
    body?.text ||
    '';

  const type =
    msg?.type ||
    (msg?.image ? 'image' : null) ||
    (msg?.video ? 'video' : null) ||
    (msg?.document ? 'document' : null) ||
    (msg?.location ? 'location' : null) ||
    'text';

  const media = msg?.image || msg?.video || msg?.document || msg?.audio || msg?.sticker || null;
  const location = msg?.location || null;

  return {
    from,
    text: String(text || '').trim(),
    type,
    media,
    location,
    raw: msg
  };
}

async function mainMenu(to) {
  resetSession(to);
  return sendList(
    to,
    `👋 Welcome to ${BUSINESS_NAME}\n\n*Welcome to Auto Glass Workshop*

We help with:
• Windscreen replacement
• Auto glass repairs
• Tinting
• Vehicle alarms
• Aircon, trackers and car audio

Tap *Open Menu* below to choose what you need.

You can type *menu* anytime to return here.`,
    'Open Menu',
    [
      { id: 'menu_book', title: '🚗 Book a Job', description: 'Create booking and job card' },
      { id: 'menu_claim', title: '🛡️ Insurance Claim', description: 'Digital claim + PDF' },
      { id: 'menu_quote', title: '💰 Get a Quote', description: 'Send details and damage photos' },
      { id: 'menu_track', title: '🔎 Track Job/Claim', description: 'Check job card or claim status' },
      { id: 'menu_services', title: '🛠️ Our Services', description: 'View available services' },
      { id: 'menu_team', title: '👤 Talk to Team', description: 'Request human help' }
    ],
    'Main Menu'
  );
}

const serviceNames = {
  svc_windscreen_replace: '🪟 Windscreen Replacement',
  svc_windscreen_repair: '🔧 Windscreen Repair',
  svc_side_glass: '🚪 Side / Door Glass',
  svc_rear_glass: '🚙 Rear Glass',
  svc_ceramic_tint: '🎨 Ceramic Tint',
  svc_antismash: 'Anti-Smash & Grab',
  svc_alarm: '🔔 Alarm Installation',
  svc_aircon: '❄️ Aircon Service',
  svc_tracker: '📍 Tracker Installation',
  svc_audio: '🔊 Car Audio'
};

async function serviceList(to, purpose) {
  setSession(to, purpose === 'quote' ? 'quote_service' : 'book_service', {});
  return sendList(
    to,
    'What service do you need?',
    'Services',
    [
      { id: 'svc_windscreen_replace', title: '🪟 Windscreen Replace', description: 'Full windscreen replacement' },
      { id: 'svc_windscreen_repair', title: '🔧 Windscreen Repair', description: 'Chip/crack repair' },
      { id: 'svc_side_glass', title: '🚪 Side / Door Glass', description: 'Door glass replacement' },
      { id: 'svc_rear_glass', title: '🚙 Rear Glass', description: 'Rear screen replacement' },
      { id: 'svc_ceramic_tint', title: '🎨 Ceramic Tint', description: 'Premium tinting' },
      { id: 'svc_antismash', title: '🛡️ Anti-Smash Grab', description: 'Safety film' },
      { id: 'svc_alarm', title: '🔔 Alarm Install', description: 'Vehicle alarms' },
      { id: 'svc_aircon', title: '❄️ Aircon Service', description: 'Vehicle aircon' },
      { id: 'svc_tracker', title: '📍 Tracker Install', description: 'Tracking devices' },
      { id: 'svc_audio', title: '🔊 Car Audio', description: 'Audio installation' }
    ],
    'Services'
  );
}

function saveAttachment(phone, inbound, jobNo = null, claimNo = null) {
  const media = inbound.media || {};
  const url = media.url || media.link || inbound.raw?.url || inbound.raw?.mediaUrl || '';
  const mediaId = media.id || inbound.raw?.mediaId || inbound.raw?.id || '';
  const caption = media.caption || inbound.raw?.caption || '';

  db.prepare(`
    INSERT INTO attachments (phone, job_no, claim_no, type, media_id, url, caption, raw, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(phone, jobNo, claimNo, inbound.type || 'media', mediaId, url, caption, JSON.stringify(inbound.raw || inbound), now());

  return { url, mediaId, type: inbound.type || 'media' };
}

async function createJob(to, data, status = 'new_booking') {
  const jobNo = nextNo('JC', 'jobs');
  const bookingDate = String(data.bookingDate || data.preferredDate || '').trim();
  const bookingTime = String(data.bookingTime || data.preferredTime || '').trim();

  data.bookingDate = bookingDate;
  data.bookingTime = bookingTime;

  db.prepare(`
    INSERT INTO jobs (job_no, customer_phone, customer_name, vehicle, reg_no, service, job_type, location, status, booking_date, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobNo,
    to,
    data.name || '',
    data.vehicle || '',
    data.reg || '',
    data.service || '',
    data.jobType || '',
    data.location || '',
    status,
    bookingDate,
    JSON.stringify(data),
    now(),
    now()
  );

  db.prepare(`
    UPDATE attachments
    SET job_no=?
    WHERE phone=? AND job_no IS NULL AND claim_no IS NULL
  `).run(jobNo, to);

  // Rebind locally persisted WhatsApp media captured before a booking/job number
  // existed. Restrict by customer phone and the explicit PENDING staging ref.
  try {
    db.prepare(`
      UPDATE studio_documents
      SET ref=?
      WHERE customer_phone=? AND source='whatsapp' AND ref LIKE 'PENDING:%'
    `).run(jobNo, to);
    db.prepare(`
      UPDATE studio_booking_media
      SET ref=?
      WHERE customer_phone=? AND source='whatsapp' AND ref LIKE 'PENDING:%'
    `).run(jobNo, to);
  } catch (e) {
    console.error('PENDING_MEDIA_REBIND_ERROR:', e.message);
  }

  if (/quote/i.test(String(status || ''))) {
    try {
      vpRefreshSmartQuoteDraftForJob(jobNo);
    } catch (error) {
      console.error('SMART_QUOTE_DRAFT_ON_CREATE_ERROR', jobNo, error.message);
    }
  }

  await alertAdmin(
`🚗 NEW JOB / BOOKING

Job Card: ${jobNo}
Customer: ${data.name || 'Not provided'}
Phone: ${to}
Service: ${data.service || 'Not provided'}
Type: ${data.jobType || 'Not provided'}
Vehicle: ${data.vehicle || 'Not provided'}
Vehicle Type: ${data.bodyType || 'Not provided'}
Reg: ${data.reg || 'Not provided'}
Location: ${data.location || 'Not provided'}

Status: ${status}`
  );

  return jobNo;
}

// VP_ANTISMASH_BODY_CONFIRM_FLOW_V1
const VP_ANTISMASH_BODY_TYPES = {
  body_sedan: 'Sedan',
  body_hatchback: 'Hatchback',
  body_suv: 'SUV',
  body_single_cab: 'Single Cab Pickup',
  body_twin_cab: 'Twin Cab Pickup',
  body_minibus_van: 'Minibus / Van',
  body_other: 'Other'
};

function vpIsAntiSmashCashBooking(data) {
  return (
    /anti[-\\s]?smash|smash.*grab/i.test(String(data?.service || '')) &&
    /^cash job$/i.test(String(data?.jobType || ''))
  );
}

async function vpSendAntiSmashBodyTypeList(to, data) {
  setSession(to, 'book_vehicle_body', data);

  return sendList(
    to,
    `Vehicle Type

Please select the vehicle body type for this Anti-Smash & Grab booking.`,
    'Vehicle Type',
    [
      { id: 'body_sedan', title: 'Sedan', description: 'Standard saloon vehicle' },
      { id: 'body_hatchback', title: 'Hatchback', description: 'Compact vehicle with rear hatch' },
      { id: 'body_suv', title: 'SUV', description: 'Sport utility vehicle' },
      { id: 'body_single_cab', title: 'Single Cab Pickup', description: 'Pickup with one seating row' },
      { id: 'body_twin_cab', title: 'Twin Cab Pickup', description: 'Pickup with two seating rows' },
      { id: 'body_minibus_van', title: 'Minibus / Van', description: 'Passenger or commercial van' },
      { id: 'body_other', title: 'Other', description: 'Other vehicle body type' }
    ],
    'Vehicle Body Types'
  );
}

async function vpSendAntiSmashBookingConfirmation(to, data) {
  setSession(to, 'book_confirm', data);

  return sendButtons(
    to,
    `BOOKING SUMMARY

Customer: ${data.name || 'Not provided'}
Phone: ${to}
Service: ${data.service || 'Anti-Smash & Grab'}
Job Type: ${data.jobType || 'Cash Job'}
Vehicle: ${data.vehicle || 'Not provided'}
Vehicle Type: ${data.bodyType || 'Not provided'}
Registration: ${data.reg || 'Not provided'}
Preferred Date: ${data.preferredDate || 'Not provided'}
Location: ${data.location || 'Not provided'}
Vehicle Photo: ${Number(data.mediaCount || 0) > 0 ? 'Received' : 'Not received'}
ID / Licence: ${data.idUploaded ? 'Received' : 'Skipped'}

Please confirm your booking.`,
    [
      { id: 'book_confirm_yes', title: 'Confirm Booking' },
      { id: 'menu_team', title: 'Talk to Team' }
    ]
  );
}


// VP_ALL_DEPARTMENT_BOOKING_BRANCHES_PDF_V1
const VP_BOOKING_BRANCHES_V2 = {
  windscreen_replacement: {
    label: 'Windscreen Replacement',
    media: {
      types: ['image', 'video'],
      prompt: 'Please upload one clear photo or short video showing the full windscreen and the affected area.'
    },
    questions: [
      {
        key: 'glassCondition',
        label: 'Windscreen condition',
        prompt: 'What best describes the windscreen condition?',
        options: [
          ['wr_cracked', 'Cracked', 'Cracked but still in place'],
          ['wr_shattered', 'Shattered', 'Glass is badly shattered'],
          ['wr_leaking', 'Leaking', 'Water or air is entering'],
          ['wr_removed', 'Already Removed', 'Windscreen is already removed']
        ],
        values: {
          wr_cracked: 'Cracked',
          wr_shattered: 'Shattered',
          wr_leaking: 'Leaking',
          wr_removed: 'Already removed'
        }
      },
      {
        key: 'sensorCamera',
        label: 'Sensor or camera',
        prompt: 'Does the windscreen have a rain sensor or camera?',
        options: [
          ['wr_sensor_yes', 'Yes', 'Sensor or camera is fitted'],
          ['wr_sensor_no', 'No', 'No sensor or camera'],
          ['wr_sensor_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          wr_sensor_yes: 'Yes',
          wr_sensor_no: 'No',
          wr_sensor_unsure: 'Not sure'
        }
      }
    ]
  },
  windscreen_repair: {
    label: 'Windscreen Repair',
    media: {
      types: ['image'],
      prompt: 'Please upload one clear close-up photo of the chip or crack.'
    },
    questions: [
      {
        key: 'damageType',
        label: 'Damage type',
        prompt: 'What type of windscreen damage needs repair?',
        options: [
          ['wrep_chip', 'Chip', 'Small stone chip'],
          ['wrep_short', 'Short Crack', 'Short visible crack'],
          ['wrep_long', 'Long Crack', 'Long or spreading crack'],
          ['wrep_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          wrep_chip: 'Chip',
          wrep_short: 'Short crack',
          wrep_long: 'Long crack',
          wrep_unsure: 'Not sure'
        }
      },
      {
        key: 'damageSize',
        label: 'Approximate size',
        prompt: 'What is the approximate size of the damage?',
        options: [
          ['wrep_coin', 'Coin Size', 'About the size of a coin'],
          ['wrep_hand', 'Hand Size', 'Larger than a coin'],
          ['wrep_wide', 'Across Glass', 'Crack runs across the glass'],
          ['wrep_size_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          wrep_coin: 'Coin size',
          wrep_hand: 'Larger than a coin',
          wrep_wide: 'Runs across the glass',
          wrep_size_unsure: 'Not sure'
        }
      },
      {
        key: 'damagePosition',
        label: 'Damage position',
        prompt: 'Where is the damage positioned?',
        options: [
          ['wrep_driver', 'Driver Side', 'In front of the driver'],
          ['wrep_passenger', 'Passenger Side', 'In front of passenger'],
          ['wrep_centre', 'Centre', 'Near the centre'],
          ['wrep_edge', 'Near Edge', 'Close to the glass edge']
        ],
        values: {
          wrep_driver: 'Driver side',
          wrep_passenger: 'Passenger side',
          wrep_centre: 'Centre',
          wrep_edge: 'Near edge'
        }
      }
    ]
  },
  side_door_glass: {
    label: 'Side / Door Glass',
    media: {
      types: ['image', 'video'],
      prompt: 'Please upload one clear photo or short video showing the affected side or door glass.'
    },
    questions: [
      {
        key: 'glassSide',
        label: 'Vehicle side',
        prompt: 'Which side of the vehicle is affected?',
        options: [
          ['side_left', 'Left Side', 'Passenger side on many vehicles'],
          ['side_right', 'Right Side', 'Driver side on many vehicles'],
          ['side_both', 'Both Sides', 'More than one side'],
          ['side_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          side_left: 'Left side',
          side_right: 'Right side',
          side_both: 'Both sides',
          side_unsure: 'Not sure'
        }
      },
      {
        key: 'doorPosition',
        label: 'Glass position',
        prompt: 'Which glass position needs attention?',
        options: [
          ['door_front', 'Front Door', 'Front door window'],
          ['door_rear', 'Rear Door', 'Rear door window'],
          ['door_quarter', 'Quarter Glass', 'Small fixed side glass'],
          ['door_multiple', 'Multiple', 'More than one glass']
        ],
        values: {
          door_front: 'Front door',
          door_rear: 'Rear door',
          door_quarter: 'Quarter glass',
          door_multiple: 'Multiple side glasses'
        }
      },
      {
        key: 'sideGlassCondition',
        label: 'Glass condition',
        prompt: 'What is wrong with the side or door glass?',
        options: [
          ['side_broken', 'Broken', 'Glass is broken or missing'],
          ['side_cracked', 'Cracked', 'Glass is cracked'],
          ['side_stuck', 'Stuck', 'Window will not move'],
          ['side_scratched', 'Scratched', 'Glass is badly scratched']
        ],
        values: {
          side_broken: 'Broken or missing',
          side_cracked: 'Cracked',
          side_stuck: 'Window is stuck',
          side_scratched: 'Badly scratched'
        }
      }
    ]
  },
  rear_glass: {
    label: 'Rear Glass',
    media: {
      types: ['image', 'video'],
      prompt: 'Please upload one clear photo or short video showing the rear glass and the affected area.'
    },
    questions: [
      {
        key: 'rearGlassCondition',
        label: 'Rear-glass condition',
        prompt: 'What best describes the rear glass?',
        options: [
          ['rear_cracked', 'Cracked', 'Rear glass is cracked'],
          ['rear_shattered', 'Shattered', 'Rear glass is shattered'],
          ['rear_leaking', 'Leaking', 'Water or air is entering'],
          ['rear_missing', 'Missing', 'Rear glass is missing']
        ],
        values: {
          rear_cracked: 'Cracked',
          rear_shattered: 'Shattered',
          rear_leaking: 'Leaking',
          rear_missing: 'Missing'
        }
      },
      {
        key: 'rearDemister',
        label: 'Demister lines',
        prompt: 'Does the rear glass have heater or demister lines?',
        options: [
          ['rear_demister_yes', 'Yes', 'Heater lines are present'],
          ['rear_demister_no', 'No', 'No heater lines'],
          ['rear_demister_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          rear_demister_yes: 'Yes',
          rear_demister_no: 'No',
          rear_demister_unsure: 'Not sure'
        }
      }
    ]
  },
  ceramic_tint: {
    label: 'Ceramic Tint',
    media: null,
    questions: [
      {
        key: 'bodyType',
        label: 'Vehicle body type',
        prompt: 'What is the vehicle body type?',
        options: [
          ['tint_sedan', 'Sedan', 'Standard saloon vehicle'],
          ['tint_hatch', 'Hatchback', 'Compact rear-hatch vehicle'],
          ['tint_suv', 'SUV', 'Sport utility vehicle'],
          ['tint_pickup', 'Pickup / Twin Cab', 'Single or twin cab pickup'],
          ['tint_van', 'Minibus / Van', 'Van or minibus'],
          ['tint_other', 'Other', 'Another vehicle body type']
        ],
        values: {
          tint_sedan: 'Sedan',
          tint_hatch: 'Hatchback',
          tint_suv: 'SUV',
          tint_pickup: 'Pickup / Twin Cab',
          tint_van: 'Minibus / Van',
          tint_other: 'Other'
        }
      },
      {
        key: 'tintWindows',
        label: 'Windows to tint',
        prompt: 'Which windows need ceramic tint?',
        options: [
          ['tint_all', 'All Windows', 'Complete vehicle tint'],
          ['tint_sides', 'Side Windows', 'Side windows only'],
          ['tint_rear', 'Rear Section', 'Rear doors and rear glass'],
          ['tint_front', 'Front Pair', 'Front door windows'],
          ['tint_unsure', 'Recommendation', 'Workshop should recommend']
        ],
        values: {
          tint_all: 'All windows',
          tint_sides: 'Side windows',
          tint_rear: 'Rear section',
          tint_front: 'Front pair',
          tint_unsure: 'Workshop recommendation'
        }
      },
      {
        key: 'tintShade',
        label: 'Tint preference',
        prompt: 'What tint shade do you prefer?',
        options: [
          ['shade_light', 'Light', 'Light shade'],
          ['shade_medium', 'Medium', 'Medium shade'],
          ['shade_dark', 'Dark', 'Dark shade'],
          ['shade_recommend', 'Recommendation', 'Workshop should recommend']
        ],
        values: {
          shade_light: 'Light',
          shade_medium: 'Medium',
          shade_dark: 'Dark',
          shade_recommend: 'Workshop recommendation'
        }
      },
      {
        key: 'oldTintRemoval',
        label: 'Existing tint',
        prompt: 'Does old tint need to be removed first?',
        options: [
          ['old_tint_yes', 'Yes', 'Old tint is installed'],
          ['old_tint_no', 'No', 'No old tint'],
          ['old_tint_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          old_tint_yes: 'Yes',
          old_tint_no: 'No',
          old_tint_unsure: 'Not sure'
        }
      }
    ]
  },
  anti_smash: {
    label: 'Anti-Smash & Grab',
    media: {
      types: ['image'],
      prompt: 'Please upload one clear photo showing the full vehicle.'
    },
    idBeforeQuestions: true,
    questions: [
      {
        key: 'bodyType',
        label: 'Vehicle body type',
        prompt: 'Please select the vehicle body type for this Anti-Smash & Grab booking.',
        options: [
          ['asm_sedan', 'Sedan', 'Standard saloon vehicle'],
          ['asm_hatch', 'Hatchback', 'Compact rear-hatch vehicle'],
          ['asm_suv', 'SUV', 'Sport utility vehicle'],
          ['asm_single', 'Single Cab Pickup', 'Pickup with one seating row'],
          ['asm_twin', 'Twin Cab Pickup', 'Pickup with two seating rows'],
          ['asm_van', 'Minibus / Van', 'Van or minibus'],
          ['asm_other', 'Other', 'Another vehicle body type']
        ],
        values: {
          asm_sedan: 'Sedan',
          asm_hatch: 'Hatchback',
          asm_suv: 'SUV',
          asm_single: 'Single Cab Pickup',
          asm_twin: 'Twin Cab Pickup',
          asm_van: 'Minibus / Van',
          asm_other: 'Other'
        }
      }
    ]
  },
  alarm_installation: {
    label: 'Alarm Installation',
    media: null,
    questions: [
      {
        key: 'alarmWork',
        label: 'Alarm work required',
        prompt: 'What alarm work do you need?',
        options: [
          ['alarm_new', 'New Installation', 'Install a new alarm'],
          ['alarm_repair', 'Repair', 'Repair an existing alarm'],
          ['alarm_upgrade', 'Upgrade', 'Upgrade the current system'],
          ['alarm_diagnose', 'Diagnosis', 'Find the fault first']
        ],
        values: {
          alarm_new: 'New installation',
          alarm_repair: 'Repair',
          alarm_upgrade: 'Upgrade',
          alarm_diagnose: 'Diagnosis'
        }
      },
      {
        key: 'centralLocking',
        label: 'Central locking',
        prompt: 'Does the vehicle central locking currently work?',
        options: [
          ['locking_yes', 'Yes', 'Central locking works'],
          ['locking_no', 'No', 'Central locking does not work'],
          ['locking_none', 'Not Fitted', 'No central locking'],
          ['locking_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          locking_yes: 'Working',
          locking_no: 'Not working',
          locking_none: 'Not fitted',
          locking_unsure: 'Not sure'
        }
      },
      {
        key: 'existingAlarm',
        label: 'Existing alarm',
        prompt: 'Is an alarm already installed?',
        options: [
          ['existing_alarm_yes', 'Yes', 'Alarm is already installed'],
          ['existing_alarm_no', 'No', 'No alarm installed'],
          ['existing_alarm_unsure', 'Not Sure', 'Workshop should inspect']
        ],
        values: {
          existing_alarm_yes: 'Yes',
          existing_alarm_no: 'No',
          existing_alarm_unsure: 'Not sure'
        }
      },
      {
        key: 'alarmFeatures',
        label: 'Required features',
        prompt: 'Which alarm features are most important?',
        options: [
          ['alarm_siren', 'Siren / Panic', 'Alarm siren and panic'],
          ['alarm_immob', 'Immobiliser', 'Engine immobilisation'],
          ['alarm_remote', 'Remote Locking', 'Remote lock and unlock'],
          ['alarm_full', 'Complete System', 'Full security package'],
          ['alarm_recommend', 'Recommendation', 'Workshop should recommend']
        ],
        values: {
          alarm_siren: 'Siren / panic',
          alarm_immob: 'Immobiliser',
          alarm_remote: 'Remote locking',
          alarm_full: 'Complete system',
          alarm_recommend: 'Workshop recommendation'
        }
      }
    ]
  },
  aircon_service: {
    label: 'Aircon Service',
    media: null,
    questions: [
      {
        key: 'airconIssue',
        label: 'Aircon problem',
        prompt: 'What is the main aircon problem?',
        options: [
          ['air_not_cooling', 'Not Cooling', 'Air is not cold'],
          ['air_weak', 'Weak Airflow', 'Airflow is weak'],
          ['air_noise', 'Noise', 'Unusual noise'],
          ['air_smell', 'Bad Smell', 'Unpleasant smell'],
          ['air_regas', 'Regas / Leak', 'Gas refill or leak check'],
          ['air_diagnose', 'Diagnosis', 'General inspection']
        ],
        values: {
          air_not_cooling: 'Not cooling',
          air_weak: 'Weak airflow',
          air_noise: 'Unusual noise',
          air_smell: 'Bad smell',
          air_regas: 'Regas or leak check',
          air_diagnose: 'General diagnosis'
        }
      },
      {
        key: 'airconDuration',
        label: 'Problem duration',
        prompt: 'How long has the aircon problem been present?',
        options: [
          ['air_days', 'A Few Days', 'Started recently'],
          ['air_weeks', 'A Few Weeks', 'Present for several weeks'],
          ['air_months', 'Several Months', 'Long-term problem'],
          ['air_unknown', 'Not Sure', 'Duration is unknown']
        ],
        values: {
          air_days: 'A few days',
          air_weeks: 'A few weeks',
          air_months: 'Several months',
          air_unknown: 'Not sure'
        }
      }
    ]
  },
  tracker_installation: {
    label: 'Tracker Installation',
    media: null,
    questions: [
      {
        key: 'trackerScope',
        label: 'Vehicle use',
        prompt: 'Is this for a personal vehicle or a fleet?',
        options: [
          ['tracker_personal', 'Personal Vehicle', 'One privately used vehicle'],
          ['tracker_business', 'Business Vehicle', 'One company vehicle'],
          ['tracker_fleet', 'Fleet', 'Multiple vehicles']
        ],
        values: {
          tracker_personal: 'Personal vehicle',
          tracker_business: 'Business vehicle',
          tracker_fleet: 'Fleet'
        }
      },
      {
        key: 'vehicleCount',
        label: 'Number of vehicles',
        prompt: 'How many vehicles need tracker work?',
        type: 'text'
      },
      {
        key: 'trackerWork',
        label: 'Tracker work required',
        prompt: 'What tracker work do you need?',
        options: [
          ['tracker_new', 'New Installation', 'Install a new tracker'],
          ['tracker_replace', 'Replacement', 'Replace an existing tracker'],
          ['tracker_inspect', 'Inspection', 'Inspect or diagnose'],
          ['tracker_recommend', 'Recommendation', 'Workshop should recommend']
        ],
        values: {
          tracker_new: 'New installation',
          tracker_replace: 'Replacement',
          tracker_inspect: 'Inspection',
          tracker_recommend: 'Workshop recommendation'
        }
      },
      {
        key: 'trackerPurpose',
        label: 'Tracking purpose',
        prompt: 'What is the main tracking requirement?',
        options: [
          ['track_live', 'Live Tracking', 'View live vehicle location'],
          ['track_recovery', 'Recovery', 'Theft recovery support'],
          ['track_fleet', 'Fleet Monitoring', 'Manage multiple vehicles'],
          ['track_recommend', 'Recommendation', 'Workshop should recommend']
        ],
        values: {
          track_live: 'Live tracking',
          track_recovery: 'Theft recovery',
          track_fleet: 'Fleet monitoring',
          track_recommend: 'Workshop recommendation'
        }
      }
    ]
  },
  car_audio: {
    label: 'Car Audio',
    media: null,
    questions: [
      {
        key: 'audioWork',
        label: 'Audio work required',
        prompt: 'What car-audio work do you need?',
        options: [
          ['audio_install', 'Installation', 'Install new equipment'],
          ['audio_repair', 'Repair', 'Repair existing equipment'],
          ['audio_upgrade', 'Upgrade', 'Upgrade the current system'],
          ['audio_diagnose', 'Diagnosis', 'Find the fault first']
        ],
        values: {
          audio_install: 'Installation',
          audio_repair: 'Repair',
          audio_upgrade: 'Upgrade',
          audio_diagnose: 'Diagnosis'
        }
      },
      {
        key: 'audioComponent',
        label: 'Audio component',
        prompt: 'Which audio component needs attention?',
        options: [
          ['audio_radio', 'Radio / Head Unit', 'Radio or screen unit'],
          ['audio_speakers', 'Speakers', 'Door or rear speakers'],
          ['audio_amp', 'Amplifier', 'Amplifier installation or repair'],
          ['audio_sub', 'Subwoofer', 'Subwoofer work'],
          ['audio_complete', 'Complete System', 'Full audio setup']
        ],
        values: {
          audio_radio: 'Radio / head unit',
          audio_speakers: 'Speakers',
          audio_amp: 'Amplifier',
          audio_sub: 'Subwoofer',
          audio_complete: 'Complete system'
        }
      },
      {
        key: 'equipmentSource',
        label: 'Equipment supply',
        prompt: 'Who will supply the audio equipment?',
        options: [
          ['audio_customer', 'Customer Supplied', 'Customer has the equipment'],
          ['audio_workshop', 'Workshop Supply', 'Workshop should supply'],
          ['audio_advice', 'Need Advice', 'Customer needs a recommendation']
        ],
        values: {
          audio_customer: 'Customer supplied',
          audio_workshop: 'Workshop supply',
          audio_advice: 'Need advice'
        }
      }
    ]
  }
};

function vpBookingServiceKey(service) {
  const value = String(service || '').toLowerCase();
  if (/windscreen.*replace/.test(value)) return 'windscreen_replacement';
  if (/windscreen.*repair/.test(value)) return 'windscreen_repair';
  if (/(side|door).*glass/.test(value)) return 'side_door_glass';
  if (/rear.*glass/.test(value)) return 'rear_glass';
  if (/ceramic.*tint/.test(value)) return 'ceramic_tint';
  if (/anti[-\s]?smash|smash.*grab/.test(value)) return 'anti_smash';
  if (/alarm/.test(value)) return 'alarm_installation';
  if (/aircon|air con|air conditioning/.test(value)) return 'aircon_service';
  if (/tracker|tracking/.test(value)) return 'tracker_installation';
  if (/car audio|audio/.test(value)) return 'car_audio';
  return '';
}

function vpBookingBranch(data) {
  const key = data.bookingServiceKey || vpBookingServiceKey(data.service);
  data.bookingServiceKey = key;
  return VP_BOOKING_BRANCHES_V2[key] || null;
}

function vpBookingNeedsId(data) {
  return String(data.jobType || '').toLowerCase() === 'insurance job' ||
    vpBookingServiceKey(data.service) === 'anti_smash';
}

function vpBookingQuestionValue(question, input) {
  const answer = String(input || '').trim();
  if (question.type === 'text') return answer;
  return question.values?.[answer] || '';
}

async function vpSendBookingQuestion(to, data, index = 0) {
  const branch = vpBookingBranch(data);
  if (!branch) {
    return sendText(to, 'This service branch is not available. Please reply MENU and try again.');
  }

  const question = branch.questions[index];
  if (!question) {
    data.bookingQuestionsComplete = true;
    if (vpBookingNeedsId(data) && !data.idStepComplete) {
      setSession(to, 'book_id_upload', data);
      return sendUploadPrompt(
        to,
        'Please upload the driver’s licence or National ID as a normal photo/document. If this is a cash job and the document is unavailable, type SKIP.',
        'back_prev'
      );
    }
    return vpSendBookingConfirmation(to, data);
  }

  data.bookingQuestionIndex = index;
  setSession(to, 'book_service_detail', data);

  if (question.type === 'text') {
    return sendGuidedPrompt(to, question.prompt, 'back_prev');
  }

  return sendList(
    to,
    question.prompt,
    'Choose Option',
    question.options.map(([id, title, description]) => ({ id, title, description })),
    branch.label
  );
}

async function vpStartBookingBranch(to, data) {
  const branch = vpBookingBranch(data);
  if (!branch) {
    return sendText(to, 'This service branch is not available. Please reply MENU and try again.');
  }

  data.bookingQuestionIndex = 0;
  data.bookingQuestionsComplete = false;

  if (branch.media) {
    setSession(to, 'book_media', data);
    if (branch.media.types.length === 1 && branch.media.types[0] === 'image') {
      return sendPhotoOnlyPrompt(to, branch.media.prompt, 'back_prev');
    }
    return sendUploadPrompt(to, branch.media.prompt, 'back_prev');
  }

  return vpSendBookingQuestion(to, data, 0);
}

function vpBookingSummaryLines(data) {
  const branch = vpBookingBranch(data);
  const lines = [
    ['Customer', data.name],
    ['Phone', data.customerPhone],
    ['Service', branch?.label || data.service],
    ['Job Type', data.jobType],
    ['Vehicle', data.vehicle],
    ['Registration', data.reg],
    ['Preferred Date', data.bookingDate || data.preferredDate],
    ['Preferred Time', data.bookingTime || data.preferredTime],
    ['Location', data.location]
  ];

  for (const question of branch?.questions || []) {
    lines.push([question.label, data[question.key]]);
  }

  lines.push(['Service media received', data.mediaCount ? `Yes (${data.mediaCount})` : 'Not required']);
  lines.push(['ID / licence received', data.idUploaded ? 'Yes' : (data.idStepComplete ? 'Skipped / not required' : 'Pending')]);

  return lines;
}

async function vpSendBookingConfirmation(to, data) {
  data.customerPhone = to;
  const branch = vpBookingBranch(data);
  const detailText = vpBookingSummaryLines(data)
    .map(([label, value]) => `${label}: ${value || 'Not provided'}`)
    .join('\n');

  setSession(to, 'book_confirm', data);

  return sendButtons(
    to,
`BOOKING SUMMARY

${detailText}

Please confirm your booking.`,
    [
      { id: 'book_confirm_yes', title: 'Confirm Booking' },
      { id: 'menu_team', title: 'Talk to Team' }
    ]
  );
}

async function vpGenerateBookingConfirmationPdf(jobNo, to, data) {
  const pdfDir = path.join(__dirname, 'public', 'pdfs');
  const logoPath = path.join(__dirname, 'public', 'branding', 'windscreen-fitment-centre-logo.png');
  fs.mkdirSync(pdfDir, { recursive: true });

  const filename = `${jobNo}-${crypto.randomBytes(8).toString('hex')}-booking-confirmation.pdf`;
  const pdfPath = path.join(pdfDir, filename);
  const pdfUrl = `${BASE_URL}/files/pdfs/${filename}`;
  const branch = vpBookingBranch(data);
  const rows = vpBookingSummaryLines(data);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const out = fs.createWriteStream(pdfPath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
    doc.pipe(out);

    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 42, 32, { fit: [155, 78] });
      } catch (error) {
        console.error('BOOKING_PDF_LOGO_ERROR', error.message);
      }
    }

    doc.font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#111827')
      .text('BOOKING CONFIRMATION', 245, 42, { width: 305, align: 'right' });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor('#475569')
      .text('Windscreen Fitment Centre', 245, 68, { width: 305, align: 'right' });

    doc.moveTo(42, 120).lineTo(553, 120).strokeColor('#1e3a8a').lineWidth(1.2).stroke();

    doc.roundedRect(42, 136, 511, 48, 7)
      .fillAndStroke('#eff6ff', '#bfdbfe');

    doc.font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#1e3a8a')
      .text(`Job Card: ${jobNo}`, 58, 150, { width: 270 });

    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#166534')
      .text('STATUS: CONFIRMED', 340, 152, { width: 195, align: 'right' });

    let y = 205;
    doc.font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#111827')
      .text('Booking Details', 42, y);

    y += 24;

    for (const [label, value] of rows) {
      if (y > 745) {
        doc.addPage();
        y = 48;
      }

      doc.font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#475569')
        .text(label, 42, y, { width: 175 });

      doc.font('Helvetica')
        .fontSize(9.5)
        .fillColor('#111827')
        .text(String(value || 'Not provided'), 220, y, { width: 333 });

      doc.moveTo(42, y + 18)
        .lineTo(553, y + 18)
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .stroke();

      y += 27;
    }

    y += 10;
    doc.roundedRect(42, y, 511, 66, 6)
      .fillAndStroke('#f8fafc', '#cbd5e1');

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#0f172a')
      .text('Confirmation', 56, y + 13);

    const confirmationText = String(data.source || '').toLowerCase() === 'studio_dashboard'
      ? `This booking was created by the workshop team from the dashboard on ${dayjs().format('DD MMMM YYYY [at] HH:mm')}. The request is ready for workshop processing.`
      : `This booking was confirmed by the customer through WhatsApp on ${dayjs().format('DD MMMM YYYY [at] HH:mm')}. The request has been submitted to the workshop for processing.`;

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor('#334155')
      .text(
        confirmationText,
        56,
        y + 31,
        { width: 480 }
      );

    doc.font('Helvetica')
      .fontSize(7.5)
      .fillColor('#64748b')
      .text(
        `Generated by Windscreen Fitment Centre • ${jobNo}`,
        42,
        806,
        { width: 511, align: 'center' }
      );

    doc.end();
  });

  const current = db.prepare('SELECT data FROM jobs WHERE job_no=?').get(jobNo);
  const storedData = safeJsonParse(current?.data, {});
  storedData.bookingPdfUrl = pdfUrl;
  storedData.bookingPdfPath = pdfPath;
  storedData.bookingConfirmedAt = now();
  storedData.bookingServiceKey = data.bookingServiceKey || vpBookingServiceKey(data.service);

  db.prepare('UPDATE jobs SET data=?, updated_at=? WHERE job_no=?')
    .run(JSON.stringify(storedData), now(), jobNo);

  db.prepare(`
    INSERT INTO attachments
    (phone, job_no, claim_no, type, media_id, url, caption, raw, created_at)
    VALUES (?, ?, NULL, 'document', '', ?, ?, ?, ?)
  `).run(
    to,
    jobNo,
    pdfUrl,
    'Booking Confirmation PDF',
    JSON.stringify({ filename, mimeType: 'application/pdf', source: 'booking_confirmation' }),
    now()
  );

  db.prepare(`
    CREATE TABLE IF NOT EXISTS studio_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      type TEXT,
      filename TEXT,
      mime_type TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT
    )
  `).run();
  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_documents_unique_source_url
    ON studio_documents(source, url)
  `).run();

  db.prepare(`
    INSERT INTO studio_documents
    (ref, customer_phone, customer_name, type, filename, mime_type, url, source, created_at)
    VALUES (?, ?, ?, 'document', ?, 'application/pdf', ?, 'booking_confirmation', ?)
  `).run(
    jobNo,
    to,
    data.name || 'WhatsApp Customer',
    filename,
    pdfUrl,
    now()
  );

  try {
    db.prepare(`
      INSERT INTO studio_notes
      (ref, type, note, actor, created_at)
      VALUES (?, 'document', ?, 'bot', ?)
    `).run(jobNo, `Booking confirmation PDF generated: ${filename}`, now());
  } catch (error) {
    console.error('BOOKING_PDF_STUDIO_NOTE_ERROR', error.message);
  }

  return { filename, pdfPath, pdfUrl };
}

async function vpFinalizeConfirmedBooking(to, data) {
  data.customerPhone = to;
  data.confirmationStatus = 'confirmed';
  data.bookingConfirmedAt = now();

  const jobNo = await createJob(to, data, 'new_booking');
  let pdf = null;

  try {
    pdf = await vpGenerateBookingConfirmationPdf(jobNo, to, data);
    await sendDocument(
      to,
      pdf.pdfUrl,
      pdf.filename,
      `Booking confirmation\n\nJob Card: ${jobNo}\nService: ${vpBookingBranch(data)?.label || data.service}`
    );
  } catch (error) {
    console.error('BOOKING_CONFIRMATION_PDF_ERROR', jobNo, error.message);
    await sendText(
      to,
      `Your booking ${jobNo} was confirmed, but the PDF could not be delivered automatically. The team has been notified.`
    );
  }

  resetSession(to);

  return sendButtons(
    to,
`BOOKING CONFIRMED

Job Card: ${jobNo}
Customer: ${data.name || 'Not provided'}
Phone: ${to}
Service: ${vpBookingBranch(data)?.label || data.service || 'Not provided'}
Vehicle: ${data.vehicle || 'Not provided'}
Registration: ${data.reg || 'Not provided'}
Preferred Date: ${data.preferredDate || 'Not provided'}
Location: ${data.location || 'Not provided'}
PDF: ${pdf ? 'Sent to this chat and saved to the dashboard' : 'Delivery needs team attention'}

Our team has been notified.`,
    [
      { id: 'menu_track', title: 'Track Job/Claim' },
      { id: 'menu_quote', title: 'Get Quote' },
      { id: 'menu_team', title: 'Talk to Team' }
    ]
  );
}

async function vpHandleCustomBookingBack(to, state, data) {
  if (state === 'book_service_detail') {
    const index = Number(data.bookingQuestionIndex || 0);
    const branch = vpBookingBranch(data);

    if (index > 0) {
      const current = branch?.questions?.[index];
      if (current) delete data[current.key];
      await vpSendBookingQuestion(to, data, index - 1);
      return true;
    }

    setSession(to, 'book_location', data);
    await sendGuidedPrompt(
      to,
      'Please send the vehicle location pin or type the address.\n\nExample: 24 Samora Machel Avenue, Harare',
      'back_prev'
    );
    return true;
  }

  if (state === 'book_id_upload') {
    const branch = vpBookingBranch(data);

    if (branch?.idBeforeQuestions) {
      setSession(to, 'book_media', data);
      if (branch.media?.types?.length === 1 && branch.media.types[0] === 'image') {
        await sendPhotoOnlyPrompt(to, branch.media.prompt, 'back_prev');
      } else {
        await sendUploadPrompt(to, branch.media?.prompt || 'Please upload the required service photo.', 'back_prev');
      }
      return true;
    }

    const lastIndex = Math.max((branch?.questions?.length || 1) - 1, 0);
    await vpSendBookingQuestion(to, data, lastIndex);
    return true;
  }

  if (state === 'book_confirm' || state === 'book_vehicle_body') {
    const branch = vpBookingBranch(data);
    const lastIndex = Math.max((branch?.questions?.length || 1) - 1, 0);
    await vpSendBookingQuestion(to, data, lastIndex);
    return true;
  }

  return false;
}

async function handleBooking(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};
  inbound = inbound || { type: 'text', location: null };

  if (s.state === 'book_service') {
    data.service = serviceNames[input] || input;
    data.bookingServiceKey = vpBookingServiceKey(data.service);

    if (!vpBookingBranch(data)) {
      return serviceList(to, 'book');
    }

    setSession(to, 'book_type', data);
    return sendButtons(to, 'Is this a cash job or insurance job?', [
      { id: 'job_cash', title: 'Cash Job' },
      { id: 'job_insurance', title: 'Insurance Job' },
      { id: 'job_not_sure', title: 'Not Sure' }
    ]);
  }

  if (s.state === 'book_type') {
    data.jobType =
      input === 'job_cash'
        ? 'Cash Job'
        : input === 'job_insurance'
          ? 'Insurance Job'
          : 'Not Sure';

    setSession(to, 'book_date', data);

    return sendButtons(to, 'When do you need this done?', [
      { id: 'date_today', title: 'Today' },
      { id: 'date_tomorrow', title: 'Tomorrow' },
      { id: 'date_choose', title: 'Choose Date' }
    ]);
  }

  if (s.state === 'book_date') {
    if (input === 'date_today') {
      data.preferredDate = dayjs().format('YYYY-MM-DD');
      data.bookingDate = data.preferredDate;
    } else if (input === 'date_tomorrow') {
      data.preferredDate = dayjs().add(1, 'day').format('YYYY-MM-DD');
      data.bookingDate = data.preferredDate;
    } else {
      setSession(to, 'book_custom_date', data);
      return sendGuidedPrompt(
        to,
        'Please type your preferred booking date.\n\nExample: 2026-09-25',
        'back_prev'
      );
    }

    setSession(to, 'book_time', data);
    return sendGuidedPrompt(
      to,
      'What time should we book you for?\n\nExample: 10:30am',
      'back_prev'
    );
  }

  if (s.state === 'book_custom_date') {
    data.preferredDate = String(input || '').trim();
    data.bookingDate = data.preferredDate;
    setSession(to, 'book_time', data);
    return sendGuidedPrompt(
      to,
      'What time should we book you for?\n\nExample: 10:30am',
      'back_prev'
    );
  }

  if (s.state === 'book_time') {
    const bookingTime = String(input || '').trim();
    if (!bookingTime) {
      setSession(to, 'book_time', data);
      return sendGuidedPrompt(
        to,
        'Please type the booking time.\n\nExample: 10:30am',
        'back_prev'
      );
    }
    data.preferredTime = bookingTime;
    data.bookingTime = bookingTime;
    data.bookingDate = String(data.bookingDate || data.preferredDate || '').trim();
    setSession(to, 'book_name', data);
    return sendGuidedPrompt(
      to,
      'Please type your full name.\n\nExample: Tafadzwa Moyo',
      'back_prev'
    );
  }

  if (s.state === 'book_name') {
    data.name = String(input || '').trim();
    setSession(to, 'book_vehicle', data);
    return sendGuidedPrompt(
      to,
      'Please type your vehicle make/model/year.\n\nExample: Toyota Aqua 2015',
      'back_prev'
    );
  }

  if (s.state === 'book_vehicle') {
    data.vehicle = String(input || '').trim();
    setSession(to, 'book_reg', data);
    return sendGuidedPrompt(
      to,
      'Please type the vehicle registration number.\n\nExample: ADF 1234',
      'back_prev'
    );
  }

  if (s.state === 'book_reg') {
    data.reg = String(input || '').trim();
    setSession(to, 'book_location', data);
    return sendGuidedPrompt(
      to,
      'Please send the vehicle location pin or type the address.\n\nExample: 24 Samora Machel Avenue, Harare',
      'back_prev'
    );
  }

  if (s.state === 'book_location') {
    data.location = inbound.location
      ? `${inbound.location.latitude},${inbound.location.longitude}`
      : String(input || '').trim();

    data.mediaCount = 0;
    data.idUploaded = false;
    data.idStepComplete = false;
    data.bookingAnswers = {};

    return vpStartBookingBranch(to, data);
  }

  if (s.state === 'book_media') {
    const branch = vpBookingBranch(data);
    const allowed = branch?.media?.types || [];

    if (!allowed.includes(String(inbound.type || ''))) {
      if (allowed.length === 1 && allowed[0] === 'image') {
        return sendPhotoOnlyPrompt(to, branch.media.prompt, 'back_prev');
      }
      return sendUploadPrompt(to, branch?.media?.prompt || 'Please upload the required service media.', 'back_prev');
    }

    saveAttachment(to, inbound);
    data.mediaCount = Number(data.mediaCount || 0) + 1;
    data.serviceMediaReceived = true;

    if (branch.idBeforeQuestions) {
      setSession(to, 'book_id_upload', data);
      return sendUploadPrompt(
        to,
        'Please upload the driver’s licence or National ID as a normal photo/document. If it is unavailable for this cash booking, type SKIP.',
        'back_prev'
      );
    }

    return vpSendBookingQuestion(to, data, 0);
  }

  if (s.state === 'book_service_detail') {
    const branch = vpBookingBranch(data);
    const index = Number(data.bookingQuestionIndex || 0);
    const question = branch?.questions?.[index];

    if (!question) {
      return vpSendBookingQuestion(to, data, index);
    }

    const value = vpBookingQuestionValue(question, input);

    if (!value) {
      return vpSendBookingQuestion(to, data, index);
    }

    data[question.key] = value;
    data.bookingAnswers = data.bookingAnswers || {};
    data.bookingAnswers[question.key] = value;

    return vpSendBookingQuestion(to, data, index + 1);
  }

  if (s.state === 'book_id_upload') {
    if (['image', 'document'].includes(String(inbound.type || ''))) {
      saveAttachment(to, inbound);
      data.idUploaded = true;
      data.idStepComplete = true;
    } else if (String(input || '').trim().toLowerCase() === 'skip') {
      if (String(data.jobType || '').toLowerCase() === 'insurance job') {
        return sendUploadPrompt(
          to,
          'For an insurance booking, the ID or driver’s licence is required. Please upload it as a normal photo/document.',
          'back_prev'
        );
      }

      data.idUploaded = false;
      data.idStepComplete = true;
    } else {
      return sendUploadPrompt(
        to,
        'Please upload the ID or driver’s licence as a normal photo/document, or type SKIP for a cash booking.',
        'back_prev'
      );
    }

    const branch = vpBookingBranch(data);

    if (branch?.idBeforeQuestions && !data.bookingQuestionsComplete) {
      return vpSendBookingQuestion(to, data, 0);
    }

    return vpSendBookingConfirmation(to, data);
  }

  if (s.state === 'book_vehicle_body') {
    data.bookingQuestionIndex = 0;
    setSession(to, 'book_service_detail', data);
    return vpSendBookingQuestion(to, data, 0);
  }

  if (s.state === 'book_confirm') {
    if (input === 'menu_team') {
      const summary = vpBookingSummaryLines(data)
        .map(([label, value]) => `${label}: ${value || 'Not provided'}`)
        .join('\n');

      return teamHandoff(
        to,
        `Customer requested help before confirming a booking.\n\n${summary}`
      );
    }

    if (
      input !== 'book_confirm_yes' &&
      String(input || '').trim().toLowerCase() !== 'confirm'
    ) {
      return vpSendBookingConfirmation(to, data);
    }

    return vpFinalizeConfirmedBooking(to, data);
  }
}


const claimFields = [
  ['policyNo', 'Please type the policy number.', 'Example: POL123456'],
  ['agency', 'Please type the agency or broker name. If not applicable, type NONE.', 'Example: Direct / Broker name / NONE'],
  ['externalClaimNo', ' Please type the insurance claim number. If not available, type NOT SURE.', 'Example: CLM88991 or NOT SURE'],
  ['insuredName', '👤 Please type the name of insured.', 'Example: Tafadzwa Moyo'],
  ['occupation', ' Please type the occupation.', 'Example: Business owner'],
  ['address', '📍 Please type the address.', 'Example: 24 Samora Machel Avenue, Harare'],
  ['email', '📧 Please type the email address.', 'Example: taffy@email.com'],
  ['telephone', '📞 Please type the contact phone number.', 'Example: +263772935746'],
  ['driverName', ' Please type the driver name at time of occurrence.', 'Example: Tafadzwa Moyo'],
  ['driverDob', '🎂 Please type the driver date of birth.', 'Example: 14 May 1988'],
  ['driverAddress', '📍 Please type the driver address.', 'Example: 24 Samora Machel Avenue, Harare'],
  ['licenceNo', ' Please type the driver licence number.', 'Example: DL123456ZW'],
  ['vehicle', '🚗 Please type vehicle make/model/year.', 'Example: Toyota Aqua 2015'],
  ['reg', '🔢 Please type vehicle registration number.', 'Example: ADF 1234'],
  ['bodyType', '🚙 Please type body type.', 'Example: Sedan, SUV, Truck'],
  ['vehicleUse', '🛣️ What was the vehicle being used for?', 'Example: Personal use / company delivery / school run'],
  ['damageDate', 'Please type the date of occurrence.', 'Example: 12 June 2026'],
  ['damageTime', 'Please type the time of occurrence.', 'Example: 8:30pm'],
  ['damagePlace', 'Please type the place of occurrence.', 'Example: Harare Drive'],
  ['cause', '💥 Please type the cause of breakage.', 'Example: Stone hit windscreen while driving'],
  ['otherDamage', 'Was there any other damage to the vehicle? If none, type NONE.', 'Example: NONE / dashboard scratched / door panel damaged'],
  ['glassType', 'Was the windscreen or glass clear, tinted or shaded?', 'Example: Clear / Tinted / Shaded'],
  ['replacementInstructions', 'Have you given instructions for a replacement to be fitted?', 'Example: Yes / No / Not yet'],
  ['estimatedCost', 'Please type the estimated cost, if known.', 'Example: USD 120 or NOT SURE']
];

function claimQuestion(idx) {
  const item = claimFields[idx];
  if (!item) return 'Please continue.';
  return `${item[1]}

${item[2]}`;
}


async function sendClaimQuestion(to, idx) {
  const item = claimFields[idx];

  if (!item) return sendText(to, 'Please continue.');

  const key = item[0];
  const body = claimQuestion(idx);

  /* upload option removed for otherDamage and glassType */


  return sendGuidedPrompt(to, body, idx === 0 ? 'back_claim_insurers' : 'back_prev');
}

async function startClaimExtraPhotoUpload(to) {
  const s = getSession(to);
  const data = s.data || {};
  const state = s.state || '';

  if (!state.startsWith('claim_field_')) {
    return sendText(to, 'Please continue with the claim form, or reply MENU to restart.');
  }

  const idx = Number(state.replace('claim_field_', ''));
  const item = claimFields[idx] || [];
  const fieldKey = item[0] || '';
  const fieldLabel = item[1] || 'this question';

  data.photoReturnState = state;
  data.photoReturnIndex = idx;
  data.photoForField = fieldKey;
  data.photoForLabel = fieldLabel;

  setSession(to, 'claim_extra_photo_upload', data);

  return sendUploadPrompt(to,
`📸 Please upload the supporting photo for this claim question.

After receiving it, I will bring you back to the same question so you can type the answer.`,
    'back_prev'
  );
}

async function handleClaimExtraPhotoUpload(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};
  const returnState = data.photoReturnState || 'claim_field_0';
  const returnIndex = Number(data.photoReturnIndex || String(returnState).replace('claim_field_', '') || 0);

  if (!['image', 'document', 'video'].includes(inbound.type)) {
    return sendUploadPrompt(to,
`📸 Please upload a photo, document, or short video.

If you do not want to upload, press Back.`,
      'back_prev'
    );
  }

  const saved = saveAttachment(to, inbound, null, data.claimNoInternal || null);

  data.extraPhotos = Array.isArray(data.extraPhotos) ? data.extraPhotos : [];
  data.extraPhotos.push({
    field: data.photoForField || '',
    label: data.photoForLabel || '',
    url: saved.url || '',
    mediaId: saved.mediaId || '',
    type: saved.type || inbound.type,
    addedAt: now()
  });

  delete data.photoReturnState;
  delete data.photoReturnIndex;

  setSession(to, returnState, data);

  await sendText(to, 'Photo received ');

  return sendClaimQuestion(to, returnIndex);
}

async function startClaim(to, insurer = 'Old Mutual') {
  setSession(to, 'claim_field_0', { insurer });
  await sendText(to,
` ${insurer} Motor Glass Claim Form

We will guide you step by step.

After the form, the customer will upload:
1. National ID photo
2. Driver's licence photo
3. The system will generate a PDF
4. Customer confirms if the PDF is correct`
  );

  return sendClaimQuestion(to, 0);
}

async function handleClaim(to, input) {
  const s = getSession(to);
  const data = s.data || {};
  const idx = Number(s.state.replace('claim_field_', ''));

  const [key] = claimFields[idx];
  data[key] = input;

  const nextIdx = idx + 1;

  if (nextIdx < claimFields.length) {
    setSession(to, `claim_field_${nextIdx}`, data);
    return sendClaimQuestion(to, nextIdx);
  }

  const claimNo = nextNo('CL', 'claims');

  data.claimNoInternal = claimNo;
  data.idPhotoReceived = false;
  data.licencePhotoReceived = false;
  data.documentVerification = 'pending_upload';
  data.customerConfirmation = 'pending';

  db.prepare(`
    INSERT INTO claims (claim_no, customer_phone, insurer, status, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(claimNo, to, data.insurer || 'Old Mutual', 'awaiting_id_photo', JSON.stringify(data), now(), now());

  setSession(to, 'claim_upload_id', data);

  return sendUploadPrompt(to,
`Claim details captured.

Claim Reference: ${claimNo}

 Next step:
Please upload a clear photo of the customer's National ID.

Example:
A clear photo showing the full ID card, name, ID number and photo.`,
    'back_prev'
  );
}

async function verifyClaimDocuments(claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) return { status: 'not_found', summary: 'Claim not found.' };

  const claimData = safeJsonParse(claim.data, {});
  const attachments = db.prepare('SELECT * FROM attachments WHERE claim_no=? ORDER BY id ASC').all(claimNo);

  if (!DOCUMENT_VERIFY_API_URL) {
    return {
      status: 'pending_manual_verification',
      summary: 'No verification API configured. Documents captured for manual verification.'
    };
  }

  try {
    const res = await axios.post(
      DOCUMENT_VERIFY_API_URL,
      {
        claimNo,
        insurer: claim.insurer,
        customerPhone: claim.customer_phone,
        claimData,
        attachments: attachments.map(a => ({
          type: a.type,
          url: a.url,
          mediaId: a.media_id,
          caption: a.caption
        }))
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(DOCUMENT_VERIFY_API_KEY ? { Authorization: `Bearer ${DOCUMENT_VERIFY_API_KEY}` } : {})
        },
        timeout: 30000
      }
    );

    const body = res.data || {};
    const rawStatus = String(body.status || body.result || body.decision || '').toLowerCase();

    let status = 'api_checked_pending_manual_review';
    if (['approved', 'verified', 'pass', 'passed', 'valid'].includes(rawStatus)) status = 'verified';
    if (['rejected', 'failed', 'fail', 'invalid'].includes(rawStatus)) status = 'rejected';

    return {
      status,
      score: body.score || body.confidence || null,
      summary: body.summary || body.message || 'Verification API checked the documents.',
      raw: body
    };
  } catch (err) {
    console.error('DOCUMENT_VERIFY_API_ERROR:', err.response?.status, JSON.stringify(err.response?.data || err.message, null, 2));
    return {
      status: 'api_error_pending_manual_verification',
      summary: 'Verification API failed. Documents captured for manual verification.'
    };
  }
}

function pdfLine(doc, label, value) {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value || '-');
}


async function fetchAttachmentBuffer(att) {
  if (!att || !att.url) return null;

  try {
    const res = await axios.get(att.url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
      maxRedirects: 3
    });

    return {
      buffer: Buffer.from(res.data),
      type: att.type || '',
      caption: att.caption || '',
      url: att.url || ''
    };
  } catch (err) {
    console.error('ATTACHMENT_DOWNLOAD_ERROR:', att.id || '', err.message);
    return null;
  }
}

function drawFormLine(doc, x, y, label, value, width = 470) {
  const safeValue = String(value || '').trim() || '-';

  doc.font('Helvetica').fontSize(9).fillColor('#111827').text(label, x, y, { continued: true });
  const labelWidth = doc.widthOfString(label) + 6;
  const lineX = x + labelWidth;

  doc.moveTo(lineX, y + 10).lineTo(x + width, y + 10).strokeColor('#111827').lineWidth(0.35).dash(1.5, { space: 1.5 }).stroke().undash();

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(safeValue, lineX + 4, y, {
    width: Math.max(40, x + width - lineX - 6),
    continued: false
  });
}

function drawBoxTick(doc, x, y, label, checked = false) {
  doc.rect(x, y, 10, 10).strokeColor('#111827').lineWidth(0.7).stroke();
  if (checked) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('✓', x + 1.8, y - 1.5);
  }
  doc.font('Helvetica').fontSize(8).fillColor('#111827').text(label, x + 14, y - 1);
}

function drawClaimPageHeader(doc, claim, logoPath) {
  doc.rect(0, 0, 595, 842).fill('#ffffff');

  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 35, 30, { fit: [170, 55] });
    } catch (e) {
      console.error('LOGO_RENDER_ERROR:', e.message);
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f766e').text(claim.insurer || 'INSURER', 35, 45);
  }

  doc.font('Helvetica-Bold').fontSize(17).fillColor('#000000')
    .text('MOTOR GLASS CLAIM FORM', 300, 45, { width: 245, align: 'right' });

  doc.moveTo(35, 100).lineTo(560, 100).strokeColor('#111827').lineWidth(0.6).stroke();
}

function drawFormSectionTitle(doc, y, title) {
  doc.moveTo(35, y).lineTo(560, y).strokeColor('#111827').lineWidth(0.55).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(title, 35, y + 7, { width: 525, align: 'center' });
  return y + 26;
}

function drawVehicleTable(doc, y, data) {
  const x = 35;
  const widths = [76, 90, 82, 70, 72, 135];
  const headers = [
    'Registration\\nNumber',
    'Make of Vehicle',
    'Type of Body',
    'Year of Make',
    'Horse Power\\nor c.c.',
    'For what exact purpose was vehicle\\nbeing used?'
  ];

  let cx = x;
  doc.font('Helvetica-Bold').fontSize(7.4).fillColor('#111827');

  for (let i = 0; i < widths.length; i++) {
    doc.rect(cx, y, widths[i], 42).strokeColor('#111827').lineWidth(0.55).stroke();
    doc.text(headers[i], cx + 3, y + 8, { width: widths[i] - 6, align: 'center' });
    cx += widths[i];
  }

  cx = x;
  const rowY = y + 42;
  const values = [
    data.reg || '',
    data.vehicle || '',
    data.bodyType || '',
    data.yearOfMake || '',
    data.engineSize || '',
    data.vehicleUse || ''
  ];

  doc.font('Helvetica').fontSize(8).fillColor('#0f172a');

  for (let i = 0; i < widths.length; i++) {
    doc.rect(cx, rowY, widths[i], 40).strokeColor('#111827').lineWidth(0.55).stroke();
    doc.text(String(values[i] || '-'), cx + 3, rowY + 8, { width: widths[i] - 6, align: 'center' });
    cx += widths[i];
  }

  return rowY + 56;
}

function drawImageCard(doc, title, img, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 8).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(title, x + 10, y + 10, { width: w - 20 });

  if (!img || !img.buffer) {
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('Image not available / unsupported document type', x + 10, y + 38, { width: w - 20 });
    return;
  }

  try {
    doc.image(img.buffer, x + 10, y + 34, { fit: [w - 20, h - 48], align: 'center', valign: 'center' });
  } catch (e) {
    doc.font('Helvetica').fontSize(9).fillColor('#dc2626').text('Could not render image in PDF. File may be unsupported.', x + 10, y + 38, { width: w - 20 });
  }
}


function pdfSafe(v, fallback = '') {
  const t = String(v || '').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

function pdfClip(v, max = 80) {
  const t = pdfSafe(v, '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function pdfField(doc, x, y, w, label, value, opts = {}) {
  const labelSize = opts.labelSize || 6.4;
  const valueSize = opts.valueSize || 7.2;
  const max = opts.max || 70;

  doc.font('Helvetica').fontSize(labelSize).fillColor('#111827').text(label, x, y, {
    width: w,
    height: 8,
    ellipsis: true
  });

  doc.save();
  doc.moveTo(x, y + 16)
    .lineTo(x + w, y + 16)
    .strokeColor('#111827')
    .lineWidth(0.35)
    .dash(1.4, { space: 1.3 })
    .stroke()
    .undash();
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(valueSize).fillColor('#0f172a').text(pdfClip(value, max), x + 2, y + 8, {
    width: w - 4,
    height: 9,
    ellipsis: true
  });
}

function pdfSection(doc, y, title) {
  doc.moveTo(32, y).lineTo(563, y).strokeColor('#111827').lineWidth(0.45).stroke();
  doc.font('Helvetica-Bold').fontSize(8.3).fillColor('#111827').text(title, 32, y + 5, {
    width: 531,
    align: 'center'
  });
  return y + 21;
}

function pdfTick(doc, x, y, label, checked) {
  doc.rect(x, y, 8, 8).strokeColor('#111827').lineWidth(0.45).stroke();
  if (checked) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#111827').text('✓', x + 1.2, y - 1);
  }
  doc.font('Helvetica').fontSize(6.8).fillColor('#111827').text(label, x + 11, y - 0.5, {
    width: 105,
    height: 10
  });
}

function pdfVehicleTable(doc, y, data) {
  const x = 32;
  const widths = [76, 92, 80, 62, 70, 151];
  const headers = [
    'Registration\\nNumber',
    'Make of Vehicle',
    'Type of Body',
    'Year of Make',
    'Horse Power\\nor c.c.',
    'For what exact purpose was vehicle\\nbeing used?'
  ];

  let cx = x;

  for (let i = 0; i < widths.length; i++) {
    doc.rect(cx, y, widths[i], 35).strokeColor('#111827').lineWidth(0.45).stroke();
    doc.font('Helvetica-Bold').fontSize(5.8).fillColor('#111827')
      .text(headers[i], cx + 2, y + 7, { width: widths[i] - 4, align: 'center' });
    cx += widths[i];
  }

  const values = [
    data.reg,
    data.vehicle,
    data.bodyType,
    data.yearOfMake || '',
    data.engineSize || '',
    data.vehicleUse
  ];

  cx = x;
  const rowY = y + 35;

  for (let i = 0; i < widths.length; i++) {
    doc.rect(cx, rowY, widths[i], 28).strokeColor('#111827').lineWidth(0.45).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor('#0f172a')
      .text(pdfClip(values[i], i === 5 ? 55 : 35), cx + 2, rowY + 9, {
        width: widths[i] - 4,
        align: 'center',
        height: 10,
        ellipsis: true
      });
    cx += widths[i];
  }

  return rowY + 42;
}

function pdfThumb(doc, title, img, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 5).strokeColor('#cbd5e1').lineWidth(0.55).stroke();
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#0f172a').text(title, x + 4, y + 4, {
    width: w - 8,
    height: 8,
    ellipsis: true
  });

  if (!img || !img.buffer) {
    doc.font('Helvetica').fontSize(6.2).fillColor('#64748b').text('Not available', x + 4, y + 22, {
      width: w - 8,
      align: 'center'
    });
    return;
  }

  try {
    doc.image(img.buffer, x + 4, y + 16, {
      fit: [w - 8, h - 20],
      align: 'center',
      valign: 'center'
    });
  } catch (e) {
    doc.font('Helvetica').fontSize(6.2).fillColor('#dc2626').text('Unsupported image', x + 4, y + 22, {
      width: w - 8,
      align: 'center'
    });
  }
}

async function generateClaimPdfFile(claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) throw new Error(`Claim not found: ${claimNo}`);

  const data = safeJsonParse(claim.data, {});
  const merged = { ...(data.fields || {}), ...data };
  const token = data.pdfToken || crypto.randomBytes(8).toString('hex');
  data.pdfToken = token;

  const filename = `${claimNo}-${token}-claim-form.pdf`;
  const absPath = path.join(PDF_DIR, filename);
  const pdfUrl = `${BASE_URL}/files/pdfs/${filename}`;
  const publicDir = (typeof PUBLIC_DIR !== 'undefined') ? PUBLIC_DIR : path.join(__dirname, 'public');
  const logoPath = (typeof getInsurerLogoPath === 'function') ? await getInsurerLogoPath(claim.insurer || merged.insurer || '') : null;

  const pick = (...names) => {
    for (const n of names) {
      const v = merged[n];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  const hasValue = v => v !== undefined && v !== null && String(v).trim() !== '';
  const cleanPhone = v => String(v || '').replace(/[^0-9+]/g, '');

  function localImagePath(value) {
    if (!value) return null;

    if (typeof value === 'object') {
      for (const k of ['path', 'filePath', 'filepath', 'localPath', 'absPath', 'url', 'src']) {
        const found = localImagePath(value[k]);
        if (found) return found;
      }
      return null;
    }

    let raw = String(value).trim();
    if (!raw) return null;
    if (!/\.(png|jpe?g|webp)$/i.test(raw)) return null;

    const tries = [];
    const add = p => { if (p && !tries.includes(p)) tries.push(p); };

    add(raw);
    add(path.join(__dirname, raw));
    add(path.join(publicDir, raw.replace(/^\/?files\//, '')));

    if (raw.startsWith(BASE_URL + '/files/')) {
      add(path.join(publicDir, raw.slice((BASE_URL + '/files/').length)));
    }

    try {
      const u = new URL(raw);
      if (u.pathname.startsWith('/files/')) add(path.join(publicDir, u.pathname.replace(/^\/files\//, '')));
    } catch (_) {}

    for (const p of tries) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      } catch (_) {}
    }

    return null;
  }

  function imageLabelFromKey(key, fallback = 'Extra Image') {
    const k = String(key || '').toLowerCase();

    if (/licen[cs]e|driver.*doc|driver.*photo|driver.*image/.test(k)) return "Driver's Licence";
    if (/national|identity|\bid\b|idphoto|id_photo|idimage|id_image/.test(k)) return 'National ID';
    if (/windscreen|damage|vehicle/.test(k)) return 'Vehicle / Damage Photo';

    return fallback;
  }

  function collectImagesFromObject(root) {
    const found = [];
    const seen = new Set();

    function push(label, filePath) {
      if (!filePath || seen.has(filePath)) return;
      seen.add(filePath);
      found.push({ label, path: filePath });
    }

    function walk(obj, trail = '') {
      if (!obj || found.length > 12) return;

      if (Array.isArray(obj)) {
        obj.forEach((v, i) => walk(v, `${trail} ${i}`));
        return;
      }

      if (typeof obj === 'object') {
        const maybe = localImagePath(obj);
        if (maybe) push(imageLabelFromKey(trail, 'Extra Image'), maybe);

        for (const [k, v] of Object.entries(obj)) {
          walk(v, `${trail} ${k}`);
        }

        return;
      }

      if (typeof obj === 'string') {
        const maybe = localImagePath(obj);
        if (maybe) push(imageLabelFromKey(trail, 'Extra Image'), maybe);
      }
    }

    walk(root, 'claim data');
    return found;
  }

  function collectImagesFromDatabase() {
    const out = [];
    const seen = new Set();
    const exactClaim = String(claimNo || '').toLowerCase();

    function rowBelongsToThisClaim(row) {
      const exactKeys = [
        'claim_no', 'claimNo', 'claim_ref', 'claimRef', 'ref', 'reference',
        'document_ref', 'documentRef', 'source_ref', 'sourceRef'
      ];

      for (const k of exactKeys) {
        if (row[k] && String(row[k]).toLowerCase() === exactClaim) return true;
      }

      try {
        const txt = JSON.stringify(row).toLowerCase();
        const safe = exactClaim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`"(claim_no|claimNo|claim_ref|claimRef|ref|reference)"\\s*:\\s*"${safe}"`, 'i').test(txt);
      } catch (_) {
        return false;
      }
    }

    function push(label, filePath) {
      if (!filePath || seen.has(filePath)) return;
      seen.add(filePath);
      out.push({ label, path: filePath });
    }

    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .map(x => x.name)
        .filter(Boolean);

      for (const table of tables) {
        if (!/media|document|upload|file|photo|image/i.test(table)) continue;
        if (!/^[A-Za-z0-9_]+$/.test(table)) continue;

        let rows = [];

        try {
          rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 500`).all();
        } catch (_) {
          continue;
        }

        for (const row of rows) {
          if (!rowBelongsToThisClaim(row)) continue;

          const imgs = collectImagesFromObject(row);
          imgs.forEach(img => push(img.label, img.path));
        }
      }
    } catch (_) {}

    return out;
  }

  function orderedImages() {
    const all = [];
    const seen = new Set();

    function add(img) {
      if (!img || !img.path || seen.has(img.path)) return;
      seen.add(img.path);
      all.push(img);
    }

    const explicitData = {};

    const allowedKeys = [
      'nationalId', 'nationalID', 'nationalIdImage', 'nationalIDImage',
      'nationalIdPhoto', 'nationalIDPhoto', 'identityImage', 'identityPhoto',
      'idImage', 'idPhoto', 'passportImage', 'passportPhoto',
      'driverLicence', 'driverLicense', 'driverLicenceImage', 'driverLicenseImage',
      'driverLicencePhoto', 'driverLicensePhoto', 'licenceImage', 'licenseImage',
      'licencePhoto', 'licensePhoto', 'vehicleRegPhoto', 'vehicleRegistrationPhoto',
      'damagedGlassPhoto', 'damageGlassPhoto', 'damagePhoto', 'glassDamagePhoto',
      'documents', 'claimDocuments', 'uploadedDocs'
    ];

    for (const k of allowedKeys) {
      if (data && data[k]) explicitData[k] = data[k];
      if (merged && merged[k]) explicitData[k] = merged[k];
    }

    collectImagesFromObject(explicitData).forEach(add);
    collectImagesFromDatabase().forEach(add);

    const priority = img => {
      const l = String(img.label || '').toLowerCase();
      const p = String(img.path || '').toLowerCase();

      if (l.includes('national') || /\bid\b/.test(l) || p.includes('national') || p.includes('id')) return 1;
      if (l.includes('passport') || p.includes('passport')) return 2;
      if (l.includes('licence') || l.includes('license') || p.includes('licence') || p.includes('license')) return 3;

      return 9;
    };

    all.sort((a, b) => priority(a) - priority(b));

    return all.slice(0, 4).map((img, index) => {
      const pr = priority(img);
      let label = index === 0 ? 'National ID' : "Driver's Licence";

      if (pr === 1) label = 'National ID';
      if (pr === 2) label = 'Passport / ID';
      if (pr === 3) label = "Driver's Licence";

      return { ...img, label };
    });
  }

  




function vpPdfCandidateValues(value) {
    const out = [];

    function walk(v) {
      if (!v) return;

      if (typeof v === 'string') {
        out.push(v);
        return;
      }

      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }

      if (typeof v === 'object') {
        [
          'localPath',
          'local_path',
          'path',
          'filePath',
          'file_path',
          'url',
          'src',
          'href',
          'downloadUrl',
          'download_url'
        ].forEach(k => {
          if (v[k]) out.push(v[k]);
        });

        Object.values(v).forEach(child => {
          if (typeof child === 'object') walk(child);
        });
      }
    }

    walk(value);

    return [...new Set(out.filter(Boolean).map(x => String(x).trim()))];
  }

  function vpPdfLooksLikeImageRef(raw) {
    if (!raw) return false;

    const v = String(raw);

    return /\.(png|jpe?g|webp)(\?|$)/i.test(v) ||
      /api\.ycloud\.com\/v2\/whatsapp\/media\/download/i.test(v) ||
      /\/whatsapp\/media\/download/i.test(v) ||
      /\/media\/download/i.test(v);
  }

  function vpPdfBufferLooksImage(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 12) return false;

    // JPG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;

    // PNG
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) return true;

    // WEBP
    if (
      buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'WEBP'
    ) return true;

    return false;
  }

  function vpPdfResolveLocal(value) {
    const publicRoot = path.join(__dirname, 'public');
    const candidates = [];

    function add(v) {
      if (v && !candidates.includes(v)) candidates.push(v);
    }

    for (const rawValue of vpPdfCandidateValues(value)) {
      if (!vpPdfLooksLikeImageRef(rawValue)) continue;

      // only local/file references can be resolved locally
      if (/^https?:\/\//i.test(rawValue) && !rawValue.includes(BASE_URL || '')) {
        continue;
      }

      add(rawValue);

      try {
        const u = new URL(rawValue);
        add(u.pathname);
      } catch (_) {}

      let clean = rawValue.split('?')[0];

      if (BASE_URL && clean.startsWith(BASE_URL)) {
        clean = clean.slice(String(BASE_URL).length);
      }

      clean = clean.replace(/^\/?files\//, '').replace(/^\/+/, '');

      add(path.join(publicRoot, clean));
      add(path.join(__dirname, clean));

      if (rawValue.startsWith('/uploads/') || rawValue.startsWith('uploads/')) {
        add(path.join(publicRoot, rawValue.replace(/^\/+/, '')));
      }

      if (rawValue.startsWith('/media/') || rawValue.startsWith('media/')) {
        add(path.join(publicRoot, rawValue.replace(/^\/+/, '')));
      }
    }

    for (const candidate of candidates) {
      try {
        const finalPath = path.isAbsolute(candidate) ? candidate : path.join(__dirname, candidate);
        if (fs.existsSync(finalPath) && fs.statSync(finalPath).isFile()) {
          return finalPath;
        }
      } catch (_) {}
    }

    return null;
  }

  function vpPdfAllowedRemoteImageUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      const host = url.hostname.toLowerCase();
      const baseHost = (() => { try { return new URL(BASE_URL).hostname.toLowerCase(); } catch (_) { return ''; } })();
      return host === 'api.ycloud.com' || (baseHost && host === baseHost);
    } catch (_) {
      return false;
    }
  }

  async function vpPdfLoadImage(value) {
    const local = vpPdfResolveLocal(value);
    if (local) return local;

    const urls = [];

    for (const raw of vpPdfCandidateValues(value)) {
      if (!vpPdfLooksLikeImageRef(raw)) continue;

      if (/^https?:\/\//i.test(raw)) {
        if (vpPdfAllowedRemoteImageUrl(raw)) urls.push(raw);
      } else if (raw.startsWith('/files/') && BASE_URL) {
        urls.push(`${BASE_URL}${raw}`);
      } else if (raw.startsWith('files/') && BASE_URL) {
        urls.push(`${BASE_URL}/${raw}`);
      } else if (raw.startsWith('/uploads/') && BASE_URL) {
        urls.push(`${BASE_URL}/files${raw}`);
      } else if (raw.startsWith('uploads/') && BASE_URL) {
        urls.push(`${BASE_URL}/files/${raw}`);
      }
    }

    const apiKey =
      process.env.YCLOUD_API_KEY ||
      process.env.YCLOUD_TOKEN ||
      process.env.YCLOUD_API_TOKEN ||
      process.env.YCLOUD_SECRET ||
      '';

    for (const url of [...new Set(urls)]) {
      try {
        if (!vpPdfAllowedRemoteImageUrl(url)) continue;
        const headers = {};
        const remoteHost = new URL(url).hostname.toLowerCase();

        // Never leak the YCloud credential to customer-controlled or unrelated hosts.
        if (apiKey && remoteHost === 'api.ycloud.com') {
          headers['X-API-Key'] = apiKey;
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 45000,
          headers,
          maxContentLength: 25 * 1024 * 1024,
          maxBodyLength: 25 * 1024 * 1024,
          maxRedirects: 3,
          validateStatus: status => status >= 200 && status < 400
        });

        const buf = Buffer.from(res.data || []);
        const type = String(res.headers?.['content-type'] || '').toLowerCase();

        if (buf.length > 100 && (type.startsWith('image/') || vpPdfBufferLooksImage(buf))) {
          return buf;
        }
      } catch (e) {
        console.error('VP_PDF_IMAGE_DOWNLOAD_FAILED', String(e.message || e).slice(0, 140));
      }
    }

    return null;
  }

  function vpPdfAttachmentRows() {
    try {
      const rows = db.prepare(`
        SELECT *
        FROM attachments
        WHERE claim_no=?
        ORDER BY
          COALESCE(role_order, 99),
          id ASC
      `).all(claimNo);

      return rows || [];
    } catch (_) {
      return [];
    }
  }

  function vpPdfRowsForRole(role) {
    const rows = vpPdfAttachmentRows();

    return rows.filter(row => {
      const r = String(row.claim_role || '').toLowerCase();
      return r === role;
    });
  }

  function vpPdfOrderedImageRows() {
    const rows = vpPdfAttachmentRows();

    return rows.filter(row => {
      const txt = JSON.stringify(row).toLowerCase();

      return /\.(png|jpe?g|webp)/i.test(txt) ||
        txt.includes('/whatsapp/media/download') ||
        txt.includes('/media/download');
    });
  }

  function vpPdfRoleCandidates(role, fallbackIndex) {
    const roles = data.claimImageRoles || merged.claimImageRoles || {};

    const fieldMap = {
      national_id: [
        roles.national_id,
        data.nationalIdPhoto,
        data.nationalIdImage,
        data.idPhoto,
        merged.nationalIdPhoto,
        merged.nationalIdImage,
        merged.idPhoto
      ],
      driver_licence: [
        roles.driver_licence,
        data.driverLicencePhoto,
        data.driverLicensePhoto,
        data.licencePhoto,
        data.licensePhoto,
        merged.driverLicencePhoto,
        merged.driverLicensePhoto,
        merged.licencePhoto,
        merged.licensePhoto
      ],
      vehicle_reg: [
        roles.vehicle_reg,
        data.vehicleRegPhoto,
        data.vehicleRegistrationPhoto,
        merged.vehicleRegPhoto,
        merged.vehicleRegistrationPhoto
      ],
      damage_glass: [
        roles.damage_glass,
        data.damagedGlassPhoto,
        data.damageGlassPhoto,
        data.glassDamagePhoto,
        data.damagePhoto,
        merged.damagedGlassPhoto,
        merged.damageGlassPhoto,
        merged.glassDamagePhoto,
        merged.damagePhoto
      ]
    };

    const roleRows = vpPdfRowsForRole(role);
    const orderedRows = vpPdfOrderedImageRows();

    return [
      ...(fieldMap[role] || []),
      ...roleRows,
      orderedRows[fallbackIndex]
    ].filter(Boolean);
  }

  const roleSpecs = [
    ['national_id', 'National ID'],
    ['driver_licence', "Driver's Licence"],
    ['vehicle_reg', 'Vehicle Registration Photo'],
    ['damage_glass', 'Damaged Glass Photo']
  ];

  const usedImageKeys = new Set();

  let images = [];

  for (let i = 0; i < roleSpecs.length; i++) {
    const [role, label] = roleSpecs[i];
    let imageAsset = null;

    for (const candidate of vpPdfRoleCandidates(role, i)) {
      const key = JSON.stringify(candidate);

      if (usedImageKeys.has(key)) continue;

      imageAsset = await vpPdfLoadImage(candidate);

      if (imageAsset) {
        usedImageKeys.add(key);
        break;
      }
    }

    images.push({
      label,
      path: imageAsset,
      missing: !imageAsset
    });
  }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const out = fs.createWriteStream(absPath);

    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
    doc.pipe(out);

    const pageW = 595.28;
    const pageH = 841.89;

    function resetPage() {
      doc.rect(0, 0, pageW, pageH).fill('#ffffff');
      doc.fillColor('#111827').strokeColor('#111827');
    }

    function textFit(text, x, y, opts = {}) {
      const { width = 120, size = 7.2, bold = false, color = '#111827', align = 'left', maxLines = 2 } = opts;
      const safe = hasValue(text) ? String(text) : '-';

      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(color)
        .text(safe, x, y, {
          width,
          align,
          lineBreak: true,
          height: size * 1.45 * maxLines,
          ellipsis: true
        });
    }

    function labelValue(x, y, w, label, value, opts = {}) {
      doc.font('Helvetica').fontSize(opts.labelSize || 5.7).fillColor('#111827').text(label, x, y, {
        width: w,
        height: 8,
        ellipsis: true
      });

      doc.moveTo(x, y + 18)
        .lineTo(x + w, y + 18)
        .dash(1, { space: 2 })
        .strokeColor('#6b7280')
        .lineWidth(0.55)
        .stroke()
        .undash();

      textFit(value, x + 2, y + 10, {
        width: w - 4,
        size: opts.valueSize || 6.4,
        bold: true,
        maxLines: opts.maxLines || 1
      });
    }

    function section(y, title) {
      doc.moveTo(32, y).lineTo(563, y).strokeColor('#111827').lineWidth(0.8).stroke();
      doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#111827').text(title, 32, y + 5, {
        width: 531,
        align: 'center'
      });
      return y + 19;
    }

    function checkbox(x, y, label, checked) {
      doc.rect(x, y, 8, 8).lineWidth(0.7).strokeColor('#111827').stroke();

      if (checked) {
        doc.moveTo(x + 1.5, y + 4)
          .lineTo(x + 3.5, y + 6.5)
          .lineTo(x + 7, y + 1.5)
          .strokeColor('#111827')
          .lineWidth(1)
          .stroke();
      }

      doc.font('Helvetica').fontSize(6.2).fillColor('#111827').text(label, x + 12, y - 1, { width: 125 });
    }

    function drawPageHeader() {
      if (logoPath && fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, 34, 35, { fit: [150, 50] });
        } catch (_) {}
      } else {
        doc.font('Helvetica-Bold')
          .fontSize(14)
          .fillColor('#0f766e')
          .text(String(claim.insurer || 'INSURER').toUpperCase(), 34, 45, { width: 180 });
      }

      doc.font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor('#000000')
        .text('MOTOR GLASS CLAIM FORM', 315, 43, { width: 245, align: 'right' });

      doc.moveTo(32, 92).lineTo(563, 92).strokeColor('#111827').lineWidth(0.85).stroke();
    }

    resetPage();
    drawPageHeader();

    let y = 110;

    labelValue(32, y, 170, 'Agency', pick('agency', 'broker', 'agent'));
    labelValue(220, y, 170, 'Policy No.', pick('policyNo', 'policyNumber'));
    labelValue(408, y, 155, 'Claim No.', pick('externalClaimNo', 'claimNoExternal', 'claimNumber') || claimNo);
    y += 32;

    labelValue(32, y, 315, 'Name of Insured', pick('insuredName', 'name', 'customerName'));
    labelValue(365, y, 198, 'Occupation', pick('occupation'));
    y += 32;

    labelValue(32, y, 315, 'Address', pick('address', 'customerAddress'));
    labelValue(365, y, 198, 'e-mail', pick('email'));
    y += 32;

    labelValue(32, y, 150, 'Telephone No: Bus', pick('telephone', 'phone'));
    labelValue(220, y, 150, 'Home', pick('homePhone', 'home'));
    labelValue(408, y, 155, 'Cell', pick('cell', 'mobile', 'whatsapp', 'phone') || claim.phone);
    y += 31;

    y = section(y, 'PARTICULARS OF DRIVER');

    labelValue(32, y, 320, 'Name of driver at time of occurrence', pick('driverName'));
    labelValue(408, y, 155, 'Date of Birth', pick('driverDob', 'driverDateOfBirth'));
    y += 32;

    labelValue(32, y, 531, 'Address of driver', pick('driverAddress'));
    y += 31;

    const relRaw = pick('driverRelation', 'relationToInsured').toLowerCase();
    const rel = relRaw.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const isEmployee = rel.includes('employee');
    const isRelative = rel.includes('relative') || rel.includes('friend');
    const isOwner = !isEmployee && !isRelative && rel.includes('owner');

    doc.font('Helvetica').fontSize(6.2).fillColor('#111827').text('Is driver', 32, y + 1);
    checkbox(90, y, '(a) owner', isOwner);
    checkbox(220, y, "(b) owner's employee", isEmployee);
    checkbox(380, y, "(c) owner's relative or friend", isRelative);
    y += 24;

    labelValue(32, y, 190, 'Has driver a full driving licence?', pick('fullLicence', 'hasFullLicence'));
    labelValue(245, y, 150, 'Licence No.', pick('licenceNo', 'licenseNo'));
    labelValue(420, y, 143, 'Date of Issue', pick('licenceIssueDate', 'licenseIssueDate'));
    y += 32;

    labelValue(32, y, 531, 'When and where was driver first licensed to drive?', pick('firstLicensed'));
    y += 32;

    labelValue(32, y, 531, 'Has driver ever been convicted of a driving offence? If so, give brief details and dates', pick('drivingConvictions', 'convictions'));
    y += 31;

    y = section(y, 'PARTICULARS OF INSURED VEHICLE');

    const tableY = y + 4;
    const cols = [32, 110, 205, 303, 370, 440, 563];
    const heads = ['Registration\\nNumber', 'Make of Vehicle', 'Type of Body', 'Year of Make', 'Horse Power\\nor c.c.', 'For what exact purpose was vehicle\\nbeing used?'];
    const vals = [
      pick('reg', 'registration'),
      pick('vehicle', 'vehicleMake', 'makeModel'),
      pick('bodyType'),
      pick('yearOfMake'),
      pick('horsePower', 'cc'),
      pick('vehicleUse')
    ];

    doc.lineWidth(0.7).strokeColor('#111827');
    doc.rect(32, tableY, 531, 62).stroke();
    doc.moveTo(32, tableY + 26).lineTo(563, tableY + 26).stroke();

    for (const cx of cols.slice(1, -1)) {
      doc.moveTo(cx, tableY).lineTo(cx, tableY + 62).stroke();
    }

    for (let i = 0; i < heads.length; i++) {
      textFit(heads[i], cols[i] + 3, tableY + 5, {
        width: cols[i + 1] - cols[i] - 6,
        size: 5.6,
        bold: true,
        align: 'center',
        maxLines: 2
      });

      textFit(vals[i], cols[i] + 3, tableY + 38, {
        width: cols[i + 1] - cols[i] - 6,
        size: 6.3,
        align: 'center',
        maxLines: 1
      });
    }

    y = tableY + 76;
    y = section(y, 'PARTICULARS OF DAMAGE');

    labelValue(32, y, 210, 'Date of occurrence', pick('damageDate') || pick('damageWhenWhere'));
    labelValue(260, y, 120, 'Time', pick('damageTime'));
    labelValue(398, y, 165, 'Place', pick('damagePlace'));
    y += 31;

    labelValue(32, y, 531, 'Cause of breakage', pick('cause'));
    y += 31;

    labelValue(32, y, 531, 'Was there any other damage to the vehicle? If yes, please give details', pick('otherDamage'), { maxLines: 2 });
    y += 31;

    labelValue(32, y, 531, 'Was the windscreen or glass in the car clear, tinted or shaded?', pick('glassType'));
    y += 31;

    labelValue(32, y, 531, 'Was it already damaged? If so, give details', pick('existingDamage', 'alreadyDamaged'));
    y += 31;

    labelValue(32, y, 531, 'Place where damaged vehicle can be seen', pick('damageViewPlace', 'vehicleLocation', 'address'));
    y += 31;

    labelValue(32, y, 330, 'Have you given instructions for a replacement to be fitted?', pick('replacementInstructions'));
    labelValue(408, y, 155, 'Estimated Cost $', pick('estimatedCost'));
    y += 36;

    doc.moveTo(32, y).lineTo(563, y).strokeColor('#111827').lineWidth(0.8).stroke();
    y += 10;

    doc.font('Helvetica')
      .fontSize(7.2)
      .fillColor('#111827')
      .text('I/We declare that, to the best of my/our knowledge and belief, these statements are true.', 32, y, { width: 531 });

    y += 22;

    labelValue(32, y, 180, 'Date', pick('signatureDate') || harareDate());

    // VP_CLAIM_DRAWN_SIGNATURE_PDF_V1
    const drawnSignaturePath = localImagePath(data.digitalSignaturePath || merged.digitalSignaturePath);
    doc.font('Helvetica').fontSize(5.7).fillColor('#111827').text('Signature of Insured', 260, y, {
      width: 303,
      height: 8,
      ellipsis: true
    });
    doc.moveTo(260, y + 25)
      .lineTo(563, y + 25)
      .dash(1, { space: 2 })
      .strokeColor('#6b7280')
      .lineWidth(0.55)
      .stroke()
      .undash();

    if (drawnSignaturePath) {
      try {
        doc.image(drawnSignaturePath, 266, y + 4, {
          fit: [210, 20],
          align: 'left',
          valign: 'bottom'
        });
        doc.font('Helvetica').fontSize(5.7).fillColor('#475569').text(
          pick('signatureOfInsured', 'insuredName'),
          482,
          y + 14,
          { width: 77, align: 'right', ellipsis: true }
        );
      } catch (_) {
        textFit(pick('signatureOfInsured', 'signature') || '____________________________', 262, y + 10, { width: 297, size: 6.4, bold: true, maxLines: 1 });
      }
    } else {
      textFit(pick('signatureOfInsured', 'signature') || '____________________________', 262, y + 10, { width: 297, size: 6.4, bold: true, maxLines: 1 });
    }

    doc.addPage({ size: 'A4', margin: 0 });
    resetPage();

    doc.font('Helvetica-Bold')
      .fontSize(15)
      .fillColor('#0f172a')
      .text('ATTACHED IDENTITY DOCUMENTS & IMAGES', 32, 34, { width: 531 });

    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#64748b')
      .text(`Claim Ref: ${claimNo} - Images enlarged for review/signing`, 32, 55, { width: 531 });

    function drawImageContain(file, x, y, w, h) {
      try {
        const img = doc.openImage(file);
        const scale = Math.min(w / img.width, h / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = x + (w - drawW) / 2;
        const dy = y + (h - drawH) / 2;

        doc.image(file, dx, dy, { width: drawW, height: drawH });
        return true;
      } catch (e) {
        doc.font('Helvetica')
          .fontSize(8)
          .fillColor('#ef4444')
          .text('Image could not be rendered', x + 12, y + 45, { width: w - 24, align: 'center' });

        return false;
      }
    }

    function drawImageCard(img, x, y, w, h) {
      doc.roundedRect(x, y, w, h, 10).fillAndStroke('#ffffff', '#cbd5e1');

      doc.font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#0f172a')
        .text(img.label || 'Image', x + 12, y + 10, { width: w - 24 });

      if (!img || !img.path) {
        doc.roundedRect(x + 18, y + 52, w - 36, h - 90, 8).fillAndStroke('#f8fafc', '#e2e8f0');

        doc.font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('#64748b')
          .text('Missing image', x + 24, y + (h / 2) - 12, {
            width: w - 48,
            align: 'center'
          });

        doc.font('Helvetica')
          .fontSize(7.5)
          .fillColor('#94a3b8')
          .text('Please resend this required image.', x + 24, y + (h / 2) + 8, {
            width: w - 48,
            align: 'center'
          });

        return;
      }

      drawImageContain(img.path, x + 12, y + 30, w - 24, h - 44);
    }

    drawImageCard(images[0], 32, 82, 252, 330);
    drawImageCard(images[1], 311, 82, 252, 330);
    drawImageCard(images[2], 32, 438, 252, 330);
    drawImageCard(images[3], 311, 438, 252, 330);

    doc.font('Helvetica')
      .fontSize(7)
      .fillColor('#94a3b8')
      .text(`Generated by ${BUSINESS_NAME} - Claim Ref: ${claimNo}`, 32, 812, { width: 531, align: 'center' });

    doc.end();
  });

  db.prepare('UPDATE claims SET data=?, pdf_url=?, pdf_path=?, updated_at=? WHERE claim_no=?')
    .run(JSON.stringify(data), pdfUrl, absPath, now(), claimNo);

  return { filename, absPath, pdfUrl, data };
}


const CLAIM_CORRECTION_FIELDS = [
  ['insuredName', 'Name of Insured'],
  ['occupation', 'Occupation'],
  ['address', 'Address'],
  ['email', 'Email'],
  ['telephone', 'Telephone / Cell'],
  ['driverName', 'Name of Driver'],
  ['driverDob', 'Driver Date of Birth'],
  ['driverAddress', 'Driver Address'],
  ['licenceNo', 'Driver Licence Number'],
  ['reg', 'Vehicle Registration Number'],
  ['vehicle', 'Vehicle Make / Model'],
  ['bodyType', 'Type of Body'],
  ['vehicleUse', 'Vehicle Use / Purpose'],
  ['damageWhenWhere', 'Date, Time and Place of Damage'],
  ['cause', 'Cause of Breakage'],
  ['otherDamage', 'Other Damage'],
  ['glassType', 'Glass Type'],
  ['estimatedCost', 'Estimated Cost'],
  ['policyNo', 'Policy Number'],
  ['agency', 'Agency / Broker'],
  ['homePhone', 'Home Telephone'],
  ['driverRelation', 'Driver Relationship'],
  ['fullLicence', 'Full Driving Licence'],
  ['licenceIssueDate', 'Licence Date of Issue'],
  ['firstLicensed', 'First Licensed To Drive'],
  ['drivingConvictions', 'Driving Convictions'],
  ['damageDate', 'Date of Occurrence'],
  ['damageTime', 'Time of Occurrence'],
  ['damagePlace', 'Place of Occurrence'],
  ['replacementInstructions', 'Replacement Instructions'],
  ['externalClaimNo', 'Insurance Claim Number']
];

function claimCorrectionMenuText(claimNo) {
  return `📝 What do you need to change on claim ${claimNo}?

Please reply with the number only.

${CLAIM_CORRECTION_FIELDS.map((f, i) => `${i + 1}. ${f[1]}`).join('\n')}

Example:
Type 6 to change Name of Driver.`;
}


async function sendClaimQuestion(to, idx) {
  const item = claimFields[idx];

  if (!item) return sendText(to, 'Please continue.');

  const key = item[0];
  const body = claimQuestion(idx);

  /* upload option removed for otherDamage and glassType */


  return sendGuidedPrompt(to, body, idx === 0 ? 'back_claim_insurers' : 'back_prev');
}

async function startClaimExtraPhotoUpload(to) {
  const s = getSession(to);
  const data = s.data || {};
  const state = s.state || '';

  if (!state.startsWith('claim_field_')) {
    return sendText(to, 'Please continue with the claim form, or reply MENU to restart.');
  }

  const idx = Number(state.replace('claim_field_', ''));
  const item = VP_STRICT_CLAIM_FIELDS[idx] || [];
  const fieldKey = item[0] || '';
  const fieldLabel = item[1] || 'this question';

  data.photoReturnState = state;
  data.photoReturnIndex = idx;
  data.photoForField = fieldKey;
  data.photoForLabel = fieldLabel;

  setSession(to, 'claim_extra_photo_upload', data);

  return sendUploadPrompt(to,
`📸 Please upload the supporting photo for this claim question.

After receiving it, I will bring you back to the same question so you can type the answer.`,
    'back_prev'
  );
}

async function handleClaimExtraPhotoUpload(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};
  const returnState = data.photoReturnState || 'claim_field_0';
  const returnIndex = Number(data.photoReturnIndex || String(returnState).replace('claim_field_', '') || 0);

  if (!['image', 'document', 'video'].includes(inbound.type)) {
    return sendUploadPrompt(to,
`📸 Please upload a photo, document, or short video.

If you do not want to upload, press Back.`,
      'back_prev'
    );
  }

  const saved = saveAttachment(to, inbound, null, data.claimNoInternal || null);

  data.extraPhotos = Array.isArray(data.extraPhotos) ? data.extraPhotos : [];
  data.extraPhotos.push({
    field: data.photoForField || '',
    label: data.photoForLabel || '',
    url: saved.url || '',
    mediaId: saved.mediaId || '',
    type: saved.type || inbound.type,
    addedAt: now()
  });

  delete data.photoReturnState;
  delete data.photoReturnIndex;

  setSession(to, returnState, data);

  await sendText(to, 'Photo received ');

  return sendClaimQuestion(to, returnIndex);
}

async function startClaimCorrection(to, claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);

  if (!claim) {
    resetSession(to);
    return sendText(to, `I could not find claim ${claimNo}. Please reply MENU.`);
  }

  setSession(to, 'claim_change_select_field', { claimNoInternal: claimNo });

  return sendText(to, claimCorrectionMenuText(claimNo));
}

async function handleClaimCorrection(to, input) {
  const s = getSession(to);
  const data = s.data || {};
  const claimNo = data.claimNoInternal || data.claimNo || data.claim || data.claimRef;

  if (!claimNo) {
    resetSession(to);
    return sendText(to, 'Claim correction session expired. Please reply MENU.');
  }

  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) {
    resetSession(to);
    return sendText(to, `I could not find claim ${claimNo}. Please reply MENU.`);
  }

  if (s.state === 'claim_change_select_field') {
    const n = Number(String(input || '').trim());

    if (!Number.isInteger(n) || n < 1 || n > CLAIM_CORRECTION_FIELDS.length) {
      return sendText(to, claimCorrectionMenuText(claimNo));
    }

    const [fieldKey, fieldLabel] = CLAIM_CORRECTION_FIELDS[n - 1];

    setSession(to, 'claim_change_enter_value', {
      claimNoInternal: claimNo,
      fieldKey,
      fieldLabel
    });

    const claimData = safeJsonParse(claim.data, {});
    const currentValue = claimData[fieldKey] || '';

    return sendText(to,
`You selected: ${fieldLabel}

Current value:
${currentValue || '(blank)'}

Please type the correct value now.`
    );
  }

  if (s.state === 'claim_change_enter_value') {
    const fieldKey = data.fieldKey;
    const fieldLabel = data.fieldLabel;

    if (!fieldKey) {
      setSession(to, 'claim_change_select_field', { claimNoInternal: claimNo });
      return sendText(to, claimCorrectionMenuText(claimNo));
    }

    const claimData = safeJsonParse(claim.data, {});
    claimData[fieldKey] = String(input || '').trim();
    claimData.customerConfirmation = 'pending';
    claimData.lastCorrection = {
      fieldKey,
      fieldLabel,
      value: claimData[fieldKey],
      updatedAt: now()
    };

    db.prepare('UPDATE claims SET data=?, status=?, updated_at=? WHERE claim_no=?')
      .run(JSON.stringify(claimData), 'customer_correction_received_regenerating_pdf', now(), claimNo);

    resetSession(to);

    await alertAdmin(
`📝 CLAIM CORRECTION RECEIVED

Claim: ${claimNo}
Phone: ${to}
Field: ${fieldLabel}
New Value: ${claimData[fieldKey]}

Regenerating PDF now.`
    );

    await sendText(to, `Thank you. I have updated ${fieldLabel}.

Regenerating the corrected PDF now...`);

    return finishClaimDocuments(to, claimNo);
  }

  resetSession(to);
  return sendText(to, 'Please reply MENU to restart.');
}

async function finishClaimDocuments(to, claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) return sendText(to, 'Claim not found. Please reply MENU.');

  const data = safeJsonParse(claim.data, {});
  const verification = await verifyClaimDocuments(claimNo);

  data.documentVerification = verification.status;
  data.verificationSummary = verification.summary || '';
  data.verificationScore = verification.score || null;
  data.customerConfirmation = 'pending';

  let status = 'documents_received_pending_confirmation';
  if (verification.status === 'verified') status = 'documents_verified_pending_customer_confirmation';
  if (verification.status === 'rejected') status = 'documents_rejected_pending_manual_review';

  db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
    .run(status, JSON.stringify(data), now(), claimNo);

  const pdf = await generateClaimPdfFile(claimNo);

  await alertAdmin(
` CLAIM PDF GENERATED

Claim: ${claimNo}
Insurer: ${data.insurer || claim.insurer || '-'}
Customer: ${data.insuredName || '-'}
Phone: ${to}
Vehicle: ${data.vehicle || '-'}
Reg: ${data.reg || '-'}

Documents:
ID photo received
Driver's licence received
 Verification: ${data.documentVerification}
${data.verificationSummary ? `Summary: ${data.verificationSummary}` : ''}

PDF:
${pdf.pdfUrl}`
  );

  await sendDocument(
    to,
    pdf.pdfUrl,
    `${claimNo}-claim-form.pdf`,
    ` Your digital claim form PDF has been generated.\n\nClaim Reference: ${claimNo}`
  );

  return sendButtons(to,
`Please review the PDF sent above carefully.

If everything is correct, tap Confirm Correct.

If anything is wrong, please contact the team for manual correction.`,
    [
      { id: `claim_confirm_${claimNo}`, title: 'Confirm Correct' },
      { id: 'menu_team', title: 'Talk to Team' }
    ]
  );
}

async function handleClaimUpload(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};
  const claimNo = data.claimNoInternal || data.claimNo || data.claim || data.claimRef;

  if (!claimNo) {
    resetSession(to);
    return sendText(to, 'Claim session expired. Please reply MENU and start again.');
  }

  if (s.state === 'claim_upload_id') {
    if (!['image', 'document'].includes(inbound.type)) {
      return sendUploadPrompt(to, ' Please upload a clear photo/document of the National ID.\n\nExample: clear full photo of the ID card.', 'back_prev');
    }

    saveAttachment(to, inbound, null, claimNo);

    data.idPhotoReceived = true;
    data.documentVerification = 'id_received_waiting_licence';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('awaiting_driver_licence', JSON.stringify(data), now(), claimNo);

    setSession(to, 'claim_upload_licence', data);

    return sendUploadPrompt(to,
`ID photo received 

 Now please upload a clear photo of the driver's licence.

Example:
A clear photo showing the full licence card, licence number and expiry date.`,
      'back_prev'
    );
  }

  if (s.state === 'claim_upload_licence') {
    if (!['image', 'document'].includes(inbound.type)) {
      return sendUploadPrompt(to, " Please upload a clear photo/document of the driver's licence.\n\nExample: clear full photo of the licence card.", 'back_prev');
    }

    saveAttachment(to, inbound, null, claimNo);

    data.licencePhotoReceived = true;
    data.documentVerification = 'documents_received_running_verification';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('generating_claim_pdf', JSON.stringify(data), now(), claimNo);

    resetSession(to);
    await sendText(to, 'Driver’s licence received \n\nGenerating your digital claim form PDF now...');
    return finishClaimDocuments(to, claimNo);
  }
}

async function handleQuote(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};

  if (s.state === 'quote_service') {
    data.service = serviceNames[input] || input;
    setSession(to, 'quote_type', data);

    return sendButtons(to, 'Is this a cash job or insurance job?', [
      { id: 'job_cash', title: 'Cash Job' },
      { id: 'job_insurance', title: 'Insurance Job' },
      { id: 'job_not_sure', title: '❓ Not Sure' }
    ]);
  }

  if (s.state === 'quote_type') {
    data.jobType = input === 'job_cash' ? 'Cash Job' : input === 'job_insurance' ? 'Insurance Job' : 'Not Sure';
    setSession(to, 'quote_name', data);
    return sendGuidedPrompt(to, '👤 Please type your full name.\n\nExample: Tafadzwa Moyo', 'back_prev');
  }

  if (s.state === 'quote_name') {
    data.name = input;
    setSession(to, 'quote_vehicle', data);
    return sendGuidedPrompt(to, '🚗 Please type vehicle make/model/year.\n\nExample: Toyota Aqua 2015', 'back_prev');
  }

  if (s.state === 'quote_vehicle') {
    data.vehicle = input;
    setSession(to, 'quote_location', data);
    return sendGuidedPrompt(to, '📍 Please send the vehicle location pin or type the address.\n\nExample: 24 Samora Machel Avenue, Harare', 'back_prev');
  }

  if (s.state === 'quote_location') {
    data.location = inbound.location ? `${inbound.location.latitude},${inbound.location.longitude}` : input;
    data.mediaCount = 0;
    setSession(to, 'quote_media', data);

    const isAntiSmash =
      /anti[-\s]?smash|smash.*grab/i.test(String(data.service || ''));

    if (isAntiSmash) {
      return sendPhotoOnlyPrompt(
        to,
        'Please upload one clear photo showing the full vehicle.',
        'back_prev'
      );
    }

    return sendUploadPrompt(to, '📸 Please upload damage photos or a short video.\n\nExample: close-up of damaged windscreen + full vehicle photo', 'back_prev');
  }

  if (s.state === 'quote_media') {
    const isAntiSmash =
      /anti[-\s]?smash|smash.*grab/i.test(String(data.service || ''));

    if (isAntiSmash && inbound.type !== 'image') {
      return sendPhotoOnlyPrompt(
        to,
        'Please upload one clear photo showing the full vehicle.\n\nVideos and documents are not required.',
        'back_prev'
      );
    }

    if (['image', 'video', 'document'].includes(inbound.type)) {
      saveAttachment(to, inbound);
      data.mediaCount = (data.mediaCount || 0) + 1;

      if (isAntiSmash) {
        const jobNo = await createJob(
          to,
          data,
          'quote_pending'
        );

        resetSession(to);

        console.log('ANTISMASH_QUOTE_PHOTO_ACCEPTED_COMPLETED', {
          to,
          jobNo,
          mediaCount: data.mediaCount
        });

        return sendButtons(to,
`Quote request received.

Reference: ${jobNo}
Service: ${data.service}
Vehicle: ${data.vehicle}

Our team has been notified.`,
          [
            { id: 'menu_track', title: 'Track Job/Claim' },
            { id: 'menu_book', title: 'Book Job' },
            { id: 'menu_team', title: 'Talk to Team' }
          ]
        );
      }

      setSession(to, 'quote_media', data);

      return sendButtons(to, `Received \n\nMedia files received: ${data.mediaCount}`, [
        { id: 'media_add_more', title: 'Add More' },
        { id: 'media_continue', title: 'Continue' },
        { id: 'menu_team', title: 'Talk to Team' }
      ]);
    }

    if (input === 'media_add_more') {
      return sendText(
        to,
        isAntiSmash
          ? 'Send the next clear vehicle photo now.'
          : 'Send the next photo/video now.'
      );
    }

    if (input === 'media_continue') {
      const jobNo = await createJob(to, data, 'quote_pending');
      resetSession(to);

      return sendButtons(to,
`💰 Quote request received.

Reference: ${jobNo}
Service: ${data.service}
Vehicle: ${data.vehicle}

Our team has been notified.`,
        [
          { id: 'menu_track', title: 'Track Job/Claim' },
          { id: 'menu_book', title: 'Book Job' },
          { id: 'menu_team', title: 'Talk to Team' }
        ]
      );
    }

    if (isAntiSmash) {
      return sendPhotoOnlyPrompt(
        to,
        'Please upload one clear photo showing the full vehicle.',
        'back_prev'
      );
    }

    return sendUploadPrompt(to, '📸 Please upload at least one photo/video first.\n\nExample: close-up of the damaged glass or full vehicle photo.', 'back_prev');
  }
}

function statusNextStep(status) {
  return {
    new_booking: 'Team will review the booking.',
    awaiting_photos: 'Waiting for photos/videos.',
    awaiting_id_photo: 'Waiting for National ID photo.',
    awaiting_driver_licence: "Waiting for driver's licence photo.",
    documents_received_pending_confirmation: 'Waiting for customer to confirm PDF.',
    documents_verified_pending_customer_confirmation: 'Documents checked. Waiting for customer to confirm PDF.',
    documents_rejected_pending_manual_review: 'Team must manually review documents.',
    claim_confirmed_by_customer: 'Customer confirmed the claim form.',
    claim_changes_requested: 'Customer requested changes.',
    quote_pending: 'Team will prepare quotation.',
    quote_sent: 'Waiting for customer approval.',
    approved: 'Fitter assignment is next.',
    fitter_assigned: 'Vehicle is scheduled for fitting.',
    in_progress: 'Work is currently in progress.',
    completed: 'Job is completed.',
    invoice_sent: 'Invoice has been sent.',
    paid: 'Payment received.',
    closed: 'Job closed.'
  }[status] || 'Team will update you soon.';
}



function cleanPublicClaimStatus(claim) {
  const claimStatus = String(claim.status || '').toLowerCase();
  const ktStatus = String(claim.keithstops_status || '').toLowerCase();
  const insurerStatus = String(claim.insurer_processing_status || '').toLowerCase();

  if (insurerStatus.includes('approved') || claimStatus.includes('approved')) return 'Approved';
  if (insurerStatus.includes('rejected') || claimStatus.includes('rejected')) return 'Needs Attention';
  if (insurerStatus.includes('submitted')) return 'Submitted to insurance';
  if (insurerStatus.includes('awaiting')) return 'Submitted for processing';
  if (ktStatus.includes('submitted') || ktStatus.includes('already')) return 'Submitted for processing';
  if (claimStatus.includes('confirmed')) return 'Confirmed and being processed';
  if (claimStatus.includes('pdf')) return 'Claim form generated';

  return 'In progress';
}

function cleanPublicNextStep(claim) {
  const claimStatus = String(claim.status || '').toLowerCase();
  const insurerStatus = String(claim.insurer_processing_status || '').toLowerCase();

  if (insurerStatus.includes('approved') || claimStatus.includes('approved')) {
    return 'The team will contact you for the next step.';
  }

  if (insurerStatus.includes('rejected') || claimStatus.includes('rejected')) {
    return 'The team will contact you to assist with the issue.';
  }

  if (insurerStatus.includes('submitted')) {
    return 'Waiting for insurance feedback.';
  }

  if (insurerStatus.includes('awaiting')) {
    return 'Awaiting insurance processing.';
  }

  return 'The team is reviewing your claim.';
}

function cleanPublicClaimMessage(claim, data, attCount) {
  const claimFormStatus = claim.pdf_url ? 'Generated' : 'Pending';
  const docsStatus = Number(attCount || 0) > 0 ? 'Received' : 'Pending';

  return `🔎 Claim Update

Claim: ${claim.claim_no}
Insurer: ${claim.insurer || data.insurer || '-'}
Vehicle: ${data.vehicleMakeModelYear || data.vehicle || data.vehicleDescription || '-'}
Registration: ${data.vehicleReg || data.reg || '-'}

Status: ${cleanPublicClaimStatus(claim)}
Next Step: ${cleanPublicNextStep(claim)}
Documents: ${docsStatus}
Claim Form: ${claimFormStatus}

For help, tap Talk to Team.`;
}

// VP_TRACKING_RETRY_LOOP_FIX_V1
function vpNormalizeTrackingReference(value) {
  const compact = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[–—_]/g, '-')
    .replace(/\s+/g, '');

  const match = compact.match(/^(JC|CL)-?(\d+)$/);
  if (!match) return compact;
  return `${match[1]}-${match[2].padStart(4, '0')}`;
}

function vpIsTrackingRetryText(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ['try', 'try again', 'retry', 'again', 'search again', 'track again', 'start again'].includes(text);
}

async function vpPromptForTrackingReference(to, intro = '') {
  setSession(to, 'track_waiting', {});
  const prefix = String(intro || '').trim();

  // VP_TRACKING_PROMPT_UNIQUE_BUTTON_FIX_V3
  // Use one explicit menu button. Passing back_main into sendGuidedPrompt
  // created two buttons with the same WhatsApp reply ID.
  return sendButtons(
    to,
`${prefix ? `${prefix}\n\n` : ''}Please type your job card or claim number.

Examples:
JC-0001
CL-0012

Type your answer below.`,
    [
      { id: 'back_main', title: 'Main Menu' }
    ]
  );
}

async function handleTrack(to, refInput) {
  const rawInput = String(refInput || '').trim();
  const lowerInput = rawInput.toLowerCase().replace(/\s+/g, ' ');

  // VP_TRACKING_INTERACTIVE_ACTION_FIX_V2
  // Tracking-session actions must be handled here because this session is
  // intentionally routed before the global menu-action handlers.
  if (lowerInput === 'menu_track') {
    console.log('TRACKING_RETRY_BUTTON_ACCEPTED', { to: `***${String(to).replace(/\D/g, '').slice(-4)}` });
    return vpPromptForTrackingReference(to, 'No problem. Let us try again.');
  }

  if (['menu_team', 'talk to team', 'team', 'help'].includes(lowerInput)) {
    console.log('TRACKING_TEAM_ACTION_ACCEPTED', { to: `***${String(to).replace(/\D/g, '').slice(-4)}` });
    return teamHandoff(to, rawInput);
  }

  if (
    [
      'back_main',
      'main_menu',
      'menu',
      'back',
      'cancel',
      'exit',
      'main menu',
      'home'
    ].includes(lowerInput)
  ) {
    console.log('TRACKING_TYPED_EXIT_ACCEPTED', { to: `***${String(to).replace(/\D/g, '').slice(-4)}` });
    return mainMenu(to);
  }

  if (!rawInput || vpIsTrackingRetryText(rawInput)) {
    console.log('TRACKING_RETRY_TEXT_ACCEPTED', { to: `***${String(to).replace(/\D/g, '').slice(-4)}`, empty: !rawInput });
    return vpPromptForTrackingReference(to, rawInput ? 'No problem. Let us try again.' : '');
  }

  const ref = vpNormalizeTrackingReference(rawInput);

  if (ref !== rawInput.toUpperCase()) {
    console.log('TRACKING_REFERENCE_NORMALIZED', { to: `***${String(to).replace(/\D/g, '').slice(-4)}`, reference: ref });
  }

  if (!/^(JC|CL)-\d{4,}$/.test(ref)) {
    setSession(to, 'track_waiting', {});
    return sendButtons(to,
`That does not look like a valid job card or claim number.

Please use a reference such as:
JC-0001
CL-0012`,
      [
        { id: 'menu_track', title: 'Try Again' },
        { id: 'menu_team', title: 'Talk to Team' },
        { id: 'back_main', title: 'Main Menu' }
      ]
    );
  }

  if (ref.startsWith('CL-')) {
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(ref);
    if (!claim) {
      setSession(to, 'track_waiting', {});
      return sendButtons(to, `I could not find claim ${ref}.`, [
        { id: 'menu_track', title: 'Try Again' },
        { id: 'menu_team', title: 'Talk to Team' },
        { id: 'back_main', title: 'Main Menu' }
      ]);
    }
    const data = safeJsonParse(claim.data, {});
    const attCount = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE claim_no=?').get(ref).c;
    return sendButtons(to, cleanPublicClaimMessage(claim, data, attCount), [
      { id: 'menu_track', title: 'Refresh' },
      { id: 'menu_team', title: 'Talk to Team' },
      { id: 'back_main', title: 'Menu' }
    ]);
  }

  const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(ref);
  if (!job) {
    setSession(to, 'track_waiting', {});
    return sendButtons(to, `I could not find job card ${ref}.`, [
      { id: 'menu_track', title: 'Try Again' },
      { id: 'menu_team', title: 'Talk to Team' },
      { id: 'back_main', title: 'Main Menu' }
    ]);
  }

  const data = safeJsonParse(job.data, {});
  const attCount = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE job_no=?').get(job.job_no).c;

  return sendButtons(to,
`🔎 Job Status

Job Card: ${job.job_no}
Customer: ${job.customer_name || '-'}
Vehicle: ${job.vehicle || '-'}
Registration: ${job.reg_no || '-'}
Service: ${job.service || '-'}
Location: ${job.location || '-'}

Status: ${job.status || '-'}
Quote: ${data.quoteAmount ? '$' + data.quoteAmount : '-'}
Fitter: ${job.fitter || '-'}
Documents / Photos: ${attCount}
Last Updated: ${job.updated_at || '-'}

If you need help, tap Talk to Team.`,
    [
      { id: 'menu_track', title: 'Refresh' },
      { id: 'menu_team', title: 'Talk to Team' },
      { id: 'back_main', title: 'Menu' }
    ]
  );
}

async function servicesMessage(to) {
  resetSession(to);

  return sendText(to,
`🛠️ Our Services

• Windscreen replacement
• Windscreen repair
• Side / door glass
• Rear glass
• Ceramic tint
• Anti-smash and grab film
• Alarms
• Aircon service
• Trackers
• Car audio

Reply MENU anytime to go back.

To continue with a booking, please reply with:
Name:
Vehicle:
Registration:
Location:

PHASE_9A_SERVICE_REPLY_NEXT_STEP`
  );
}

async function teamHandoff(to, reason = '') {
  setSession(to, 'handoff_notes', { reason });

  await alertAdmin(
`🙋 CUSTOMER NEEDS HUMAN HELP

Phone: ${to}
${reason ? `Reason: ${reason}` : ''}

Please respond to them.`
  );

  return sendText(to,
`👤 Sure, let me connect you with the team.

While I notify them, please type the specific help you need below.

Example:
I want to speak to the owner about my insurance claim.`
  );
}


function buildKeithstopsClaimPack(claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) return null;

  const claimData = safeJsonParse(claim.data, {});
  const job = claim.job_no ? db.prepare('SELECT * FROM jobs WHERE job_no=?').get(claim.job_no) : null;
  const attachments = db.prepare('SELECT * FROM attachments WHERE claim_no=? ORDER BY id ASC').all(claimNo);

  return {
    claimNo,
    jobNo: claim.job_no || '',
    insurer: claim.insurer || claimData.insurer || '',
    customerPhone: claim.customer_phone || claim.phone || '',
    customerName: claimData.insuredName || job?.customer_name || '',
    vehicle: claimData.vehicle || job?.vehicle || '',
    registration: claimData.reg || job?.reg_no || '',
    service: job?.service || 'Motor glass claim',
    claimStatus: claim.status || '',
    pdfUrl: claim.pdf_url || '',
    createdAt: claim.created_at || now(),
    claimData,
    job: job || null,
    attachments: attachments.map(a => ({
      type: a.type || '',
      url: a.url || '',
      mediaId: a.media_id || '',
      caption: a.caption || ''
    }))
  };
}

async function submitClaimToKeithstops(claimNo, triggeredBy = 'system') {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) {
    return {
      success: false,
      status: 'not_found',
      reference: '',
      message: `Claim not found: ${claimNo}`
    };
  }

  const existingStatus = String(claim.keithstops_status || '').toLowerCase();
  const existingRef = claim.keithstops_reference || '';

  if (
    triggeredBy !== 'force_resubmit' &&
    existingRef &&
    (
      existingStatus.includes('submitted') ||
      existingStatus.includes('already') ||
      existingStatus.includes('keith_tech_pos')
    )
  ) {
    return {
      success: true,
      status: 'already_submitted_for_processing',
      reference: existingRef,
      message: 'This claim is already recorded in KEITH TECH POS. No duplicate order was created.',
      raw: null
    };
  }

  const pack = buildKeithstopsClaimPack(claimNo);
  if (!pack) {
    return {
      success: false,
      status: 'pack_error',
      reference: '',
      message: 'Could not build claim pack.'
    };
  }

  db.prepare(`UPDATE claims SET keithstops_status=?, keithstops_error=?, keithstops_last_sync=?, updated_at=? WHERE claim_no=?`)
    .run('submitting', '', now(), now(), claimNo);

  if (claim.job_no) {
    try {
      db.prepare(`UPDATE jobs SET keithstops_status=?, keithstops_error=?, keithstops_last_sync=?, updated_at=? WHERE job_no=?`)
        .run('submitting', '', now(), now(), claim.job_no);
    } catch {}
  }

  const result = await keithstops.submitClaimPack(pack);

  const finalStatus = result.success ? (result.status || 'submitted') : (result.status || 'failed');
  const ref = result.reference || '';
  const error = result.success ? '' : (result.message || 'KEITH TECH POS submission failed.');
  const claimStatus = result.success ? 'submitted_for_processing' : 'keithstops_submission_failed';

  db.prepare(`
    UPDATE claims
    SET status=?, keithstops_status=?, keithstops_reference=?, keithstops_error=?, keithstops_last_sync=?, insurer_processing_status=?, updated_at=?
    WHERE claim_no=?
  `).run(
    claimStatus,
    finalStatus,
    ref,
    error,
    now(),
    result.success ? 'awaiting_insurance_processing' : 'not_submitted',
    now(),
    claimNo
  );

  if (claim.job_no) {
    try {
      db.prepare(`
        UPDATE jobs
        SET processing_status=?, keithstops_status=?, keithstops_reference=?, keithstops_error=?, keithstops_last_sync=?, updated_at=?
        WHERE job_no=?
      `).run(
        result.success ? 'submitted_to_keithstops' : 'keithstops_submission_failed',
        finalStatus,
        ref,
        error,
        now(),
        now(),
        claim.job_no
      );
    } catch {}
  }

  await alertAdmin(
`🔗 KEITH TECH POS SUBMISSION

Claim: ${claimNo}
Job: ${claim.job_no || '-'}
Triggered by: ${triggeredBy}
Status: ${finalStatus}
Reference: ${ref || '-'}
${error ? `Error: ${error}` : `Result: ${result.message || 'submitted successfully'}`}

Next: ${result.success ? 'Awaiting insurer submission / processing.' : 'Admin must retry or submit manually.'}`
  );

  return result;
}

async function handleClaimConfirmed(to, claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);

  if (!claim) {
    resetSession(to);
    return sendText(to, `I could not find claim ${claimNo}. Please reply MENU.`);
  }

  const data = safeJsonParse(claim.data, {});
  const wasAlreadyConfirmed = ['confirmed', 'confirmed_correct'].includes(
    String(data.customerConfirmation || '').trim().toLowerCase()
  );
  data.customerConfirmation = 'confirmed';
  data.confirmedAt = now();

  db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
    .run('customer_confirmed_claim_pack_ready', JSON.stringify(data), now(), claimNo);

  await sendText(to,
`Thank you. Your claim form has been confirmed.

We are now submitting your claim pack for workshop processing.`
  );

  const result = await submitClaimToKeithstops(claimNo, 'customer_confirmation');

  const insurerEmailEnabled = String(
    process.env.INSURER_EMAIL_ENABLED || process.env.OLD_MUTUAL_EMAIL_ENABLED || ''
  ).trim().toLowerCase() === 'true';
  const insurerEmailConfig = insurerEmail.getInsurerEmailConfig(claim.insurer || data.insurer || '');

  if (insurerEmailConfig && insurerEmailEnabled) {
    try {
      const emailResult = await insurerEmail.submitConfirmedClaimEmail({
        db,
        claimNo,
        apiKey: process.env.RESEND_API_KEY || '',
        from: process.env.OLD_MUTUAL_EMAIL_FROM || '',
        enabled: true,
        timeoutMs: 12000,
        now,
        wasAlreadyConfirmed,
        replyEnabled: false,
        replyDomain: process.env.INSURER_REPLY_DOMAIN || 'autoglassinsurance.visionpixels.autos',
        replySecret: process.env.INSURER_REPLY_SECRET || '',
        decisionEnabled: true,
        decisionBaseUrl: BASE_URL,
        decisionSecret: process.env.INSURER_DECISION_SECRET || process.env.INSURER_REPLY_SECRET || ''
      });

      if (emailResult.status === 'sent') {
        await alertAdmin(`INSURER CLAIM EMAILED\n\nClaim: ${claimNo}\nInsurer: ${insurerEmailConfig.displayName}\nRecipient: ${emailResult.recipient}\nStatus: Sent to Insurance\nMessage ID: ${emailResult.messageId || '-'}`);
      } else if (emailResult.status === 'already_sent' || emailResult.status === 'send_in_progress' || emailResult.status === 'historical_confirmation_suppressed') {
        console.log('INSURER_EMAIL_SUPPRESSED', { claimNo, insurer: insurerEmailConfig.canonical, status: emailResult.status });
      } else if (!emailResult.success) {
        await alertAdmin(`INSURER EMAIL FAILED / NEEDS ATTENTION\n\nClaim: ${claimNo}\nInsurer: ${insurerEmailConfig.displayName}\nRecipient: ${insurerEmailConfig.recipient}\nStatus: ${emailResult.status || 'failed'}\nReason: ${emailResult.error || 'Email submission is not available.'}`);
      }
    } catch (error) {
      console.error('INSURER_EMAIL_HANDLER_ERROR:', error.message);
      try {
        await alertAdmin(`INSURER EMAIL FAILED / NEEDS ATTENTION\n\nClaim: ${claimNo}\nInsurer: ${insurerEmailConfig.displayName}\nRecipient: ${insurerEmailConfig.recipient}\nReason: Internal email handler error. Manual review required.`);
      } catch (_) {}
    }
  } else if (!insurerEmailConfig) {
    console.log('INSURER_EMAIL_NOT_APPLICABLE', {
      claimNo,
      insurer: insurerEmail.normalizeInsurerName(claim.insurer || data.insurer || '')
    });
  }

  if (result.success) {
    resetSession(to);
    return sendButtons(to,
`Claim pack submitted for processing.

Claim: ${claimNo}
KEITH TECH POS Ref: ${result.reference || 'Submitted'}
Status: Awaiting insurer submission / processing.

The team has been notified.`,
      [
        { id: 'menu_track', title: 'Track Job/Claim' },
        { id: 'menu_team', title: 'Talk to Team' }
      ]
    );
  }

  resetSession(to);
  return sendButtons(to,
`⚠️ Your claim PDF was confirmed, but automatic workshop submission needs attention.

Claim: ${claimNo}
Reason: ${result.message || 'Submission failed'}

The team has been notified and will assist manually.`,
    [
      { id: 'menu_team', title: 'Talk to Team' },
      { id: 'menu_claim', title: '🛡️ Insurance Claim' }
    ]
  );
}

async function handleKeithstopsStatusCommand(from, refOrClaimNo) {
  const input = String(refOrClaimNo || '').trim().toUpperCase();

  if (!input) return sendText(from, 'Use: /keithstatus CL-0001\n/ktstatus CL-0001\n/claimstatus CL-0001\n/trackclaim CL-0001');

  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(input);

  if (claim) {
    return sendText(from,
`🔗 KEITH TECH POS Status

Claim: ${claim.claim_no}
Job: ${claim.job_no || '-'}
KEITH TECH POS Status: ${claim.keithstops_status || '-'}
KEITH TECH POS Ref: ${claim.keithstops_reference || '-'}
Insurer Processing: ${claim.insurer_processing_status || '-'}
Last Sync: ${claim.keithstops_last_sync || '-'}
Error: ${claim.keithstops_error || '-'}`
    );
  }

  const result = await keithstops.getStatus(input);

  return sendText(from,
`🔗 KEITH TECH POS Status

Reference: ${input}
Status: ${result.status || '-'}
Message: ${result.message || '-'}`
  );
}

async function adminCommand(from, text) {
  const [cmd, ...parts] = text.trim().split(/\s+/);
  const command = cmd.toLowerCase();

  if (command === '/submitkeith' || command === '/submitkt') {
    const ref = (parts[0] || '').toUpperCase();
    if (!ref) return sendText(from, 'Use: /submitkeith CL-0001\n/submitkt CL-0001');

    let claimNo = ref;

    if (ref.startsWith('JC-')) {
      const claim = db.prepare('SELECT * FROM claims WHERE job_no=? ORDER BY id DESC LIMIT 1').get(ref);
      if (!claim) return sendText(from, `No claim found for job ${ref}`);
      claimNo = claim.claim_no;
    }

    const result = await submitClaimToKeithstops(claimNo, 'admin_command');

    return sendText(from,
`🔗 KEITH TECH POS Submit Result

Claim: ${claimNo}
Status: ${result.status || '-'}
Reference: ${result.reference || '-'}
Message: ${result.message || '-'}`
    );
  }


  if (command === '/claimstatus' || command === '/trackclaim') {
    const claimNo = (parts[0] || '').toUpperCase();
    if (!claimNo) return sendText(from, 'Use: /claimstatus CL-0001');

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, `Claim not found: ${claimNo}`);

    const data = safeJsonParse(claim.data, {});
    const attCount = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE claim_no=?').get(claimNo).c;

    return sendText(from, cleanPublicClaimMessage(claim, data, attCount));
  }

  if (command === '/keithstatus' || command === '/ktstatus') {
    return handleKeithstopsStatusCommand(from, parts[0] || '');
  }

  if (command === '/insurerstatus') {
    const claimNo = (parts[0] || '').toUpperCase();
    const status = (parts[1] || '').toLowerCase();
    const note = parts.slice(2).join(' ');

    if (!claimNo || !status) return sendText(from, 'Use: /insurerstatus CL-0001 approved optional note');

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, `Claim not found: ${claimNo}`);

    const allowed = ['pending', 'submitted', 'approved', 'rejected', 'manual_review'];
    const finalStatus = allowed.includes(status) ? status : 'manual_review';

    db.prepare('UPDATE claims SET insurer_processing_status=?, status=?, updated_at=? WHERE claim_no=?')
      .run(finalStatus, `insurer_${finalStatus}`, now(), claimNo);

    await sendText(claim.customer_phone,
` Claim update

Claim: ${claimNo}
Status: ${finalStatus}
${note ? `Note: ${note}` : ''}`
    );

    return sendText(from, `Updated ${claimNo} insurer status to ${finalStatus}`);
  }


  if (command === '/help') {
    return sendText(from,
`🛠️ Admin Commands

/jobs
/job JC-0001
/quote JC-0001 120 Optional notes
/assign JC-0001 Tawanda
/status JC-0001 in_progress
/complete JC-0001
/invoice JC-0001
/paid JC-0001
/close JC-0001

/claims
/claim CL-0001
/claimpdf CL-0001
/resendclaimpdf CL-0001\n/submitkeith CL-0001\n/submitkt CL-0001\n/keithstatus CL-0001\n/ktstatus CL-0001\n/claimstatus CL-0001\n/trackclaim CL-0001\n/insurerstatus CL-0001 approved optional note
/verifyclaim CL-0001 approved
/verifyclaim CL-0001 rejected

/dashboard`
    );
  }

  if (command === '/jobs') {
    const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 10').all();
    if (!jobs.length) return sendText(from, 'No jobs yet.');
    return sendText(from, '📋 Latest Jobs\n\n' + jobs.map(j => `${j.job_no} - ${j.vehicle || '-'} - ${j.status}`).join('\n'));
  }

  if (command === '/job') {
    const jobNo = (parts[0] || '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    const attCount = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE job_no=?').get(jobNo).c;

    return sendText(from,
`🚗 ${job.job_no}

Customer: ${job.customer_name || '-'}
Phone: ${job.customer_phone}
Vehicle: ${job.vehicle || '-'}
Reg: ${job.reg_no || '-'}
Service: ${job.service || '-'}
Type: ${job.job_type || '-'}
Location: ${job.location || '-'}
Status: ${job.status}
Fitter: ${job.fitter || '-'}
Attachments: ${attCount}`
    );
  }

  if (command === '/status') {
    const jobNo = (parts[0] || '').toUpperCase();
    const status = parts[1];
    if (!jobNo || !status) return sendText(from, 'Use: /status JC-0001 in_progress');

    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run(status, now(), jobNo);
    await sendText(job.customer_phone, `🚗 Job update\n\nJob Card: ${jobNo}\nStatus: ${status}\n\n${statusNextStep(status)}`);
    return sendText(from, `Updated ${jobNo} to ${status}`);
  }

  if (command === '/assign') {
    const jobNo = (parts[0] || '').toUpperCase();
    const fitter = parts.slice(1).join(' ');
    if (!jobNo || !fitter) return sendText(from, 'Use: /assign JC-0001 Tawanda');

    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    db.prepare('UPDATE jobs SET fitter=?, status=?, updated_at=? WHERE job_no=?').run(fitter, 'fitter_assigned', now(), jobNo);
    await sendText(job.customer_phone, `👷 Fitter assigned\n\nJob Card: ${jobNo}\nFitter: ${fitter}\n\nYour job is now scheduled for fitting.`);
    return sendText(from, `Assigned ${jobNo} to ${fitter}`);
  }

  if (command === '/quote') {
    const jobNo = (parts[0] || '').toUpperCase();
    const amount = parts[1];
    const notes = parts.slice(2).join(' ');
    if (!jobNo || !amount) return sendText(from, 'Use: /quote JC-0001 120 Optional notes');

    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    const data = safeJsonParse(job.data, {});
    data.quoteAmount = amount;
    data.quoteCurrency = 'USD';
    data.quoteNotes = notes || '';

    db.prepare('UPDATE jobs SET status=?, data=?, updated_at=? WHERE job_no=?')
      .run('quote_sent', JSON.stringify(data), now(), jobNo);

    await sendButtons(job.customer_phone,
`💰 Your quote is ready.

Job Card: ${jobNo}
Vehicle: ${job.vehicle || '-'}
Service: ${job.service || '-'}
Amount: USD ${amount}
${notes ? '\nNote: ' + notes : ''}

Please choose an option:`,
      [
        { id: `quote_approve_${jobNo}`, title: 'Approve' },
        { id: `quote_question_${jobNo}`, title: 'Ask Question' },
        { id: `quote_decline_${jobNo}`, title: 'Decline' }
      ]
    );

    return sendText(from, `Quote sent to customer.\n\nJob: ${jobNo}\nAmount: USD ${amount}`);
  }

  if (command === '/complete') {
    const jobNo = (parts[0] || '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run('completed', now(), jobNo);
    await sendButtons(job.customer_phone,
`Your job has been completed.

Job Card: ${jobNo}

Please confirm:`,
      [
        { id: 'complete_all_good', title: 'All Good' },
        { id: 'complete_need_help', title: 'Need Help' },
        { id: 'complete_invoice', title: 'Send Invoice' }
      ]
    );
    return sendText(from, `Completed ${jobNo} and customer was notified.`);
  }

  if (command === '/invoice') {
    const jobNo = (parts[0] || '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run('invoice_sent', now(), jobNo);
    await sendText(job.customer_phone, ` Invoice update\n\nJob Card: ${jobNo}\nYour invoice is being prepared/sent by the team.`);
    return sendText(from, `Invoice placeholder sent for ${jobNo}`);
  }

  if (command === '/paid') {
    const jobNo = (parts[0] || '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run('paid', now(), jobNo);
    await sendText(job.customer_phone, `Payment received.\n\nJob Card: ${jobNo}\nThank you.`);
    return sendText(from, `Marked ${jobNo} as paid.`);
  }

  if (command === '/close') {
    const jobNo = (parts[0] || '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return sendText(from, `Job not found: ${jobNo}`);

    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run('closed', now(), jobNo);
    return sendText(from, `Closed ${jobNo}.`);
  }

  if (command === '/claims') {
    const claims = db.prepare('SELECT * FROM claims ORDER BY id DESC LIMIT 10').all();
    if (!claims.length) return sendText(from, 'No claims yet.');
    return sendText(from, ' Latest Claims\n\n' + claims.map(c => `${c.claim_no} - ${c.insurer || '-'} - ${c.status}`).join('\n'));
  }

  if (command === '/claim') {
    const claimNo = (parts[0] || '').toUpperCase();
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, `Claim not found: ${claimNo}`);

    const data = safeJsonParse(claim.data, {});
    const attCount = db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE claim_no=?').get(claimNo).c;

    return sendText(from,
` ${claim.claim_no}

Insurer: ${claim.insurer || '-'}
Status: ${claim.status}
Customer: ${data.insuredName || '-'}
Phone: ${claim.customer_phone}
Vehicle: ${data.vehicle || '-'}
Reg: ${data.reg || '-'}
Cause: ${data.cause || '-'}
Estimated Cost: ${data.estimatedCost || '-'}

ID Photo: ${data.idPhotoReceived ? 'Received ' : 'Missing ❌'}
Licence: ${data.licencePhotoReceived ? 'Received ' : 'Missing ❌'}
Verification: ${data.documentVerification || ''}
Customer Confirmation: ${data.customerConfirmation || 'pending'}
PDF: ${claim.pdf_url || 'Not generated yet'}
Attachments: ${attCount}`
    );
  }

  if (command === '/claimpdf') {
    const claimNo = (parts[0] || '').toUpperCase();
    if (!claimNo) return sendText(from, 'Use: /claimpdf CL-0001');
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, `Claim not found: ${claimNo}`);
    const pdf = claim.pdf_url ? { pdfUrl: claim.pdf_url } : await generateClaimPdfFile(claimNo);
    return sendText(from, ` Claim PDF\n\n${claimNo}\n${pdf.pdfUrl || claim.pdf_url}`);
  }

  if (command === '/resendclaimpdf') {
    const claimNo = (parts[0] || '').toUpperCase();
    if (!claimNo) return sendText(from, 'Use: /resendclaimpdf CL-0001\n/submitkeith CL-0001\n/submitkt CL-0001\n/keithstatus CL-0001\n/ktstatus CL-0001\n/claimstatus CL-0001\n/trackclaim CL-0001\n/insurerstatus CL-0001 approved optional note');

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, `Claim not found: ${claimNo}`);

    const pdf = claim.pdf_url ? { pdfUrl: claim.pdf_url } : await generateClaimPdfFile(claimNo);

    await sendDocument(claim.customer_phone, pdf.pdfUrl || claim.pdf_url, `${claimNo}-claim-form.pdf`, ` Claim form PDF\n\nClaim Reference: ${claimNo}`);

    await sendButtons(claim.customer_phone,
`Please review the PDF sent above carefully.

If everything is correct, tap Confirm Correct.

If anything is wrong, please contact the team for manual correction.`,
      [
        { id: `claim_confirm_${claimNo}`, title: 'Confirm Correct' },
        { id: 'menu_team', title: 'Talk to Team' }
      ]
    );

    return sendText(from, `Claim PDF resent to customer for confirmation: ${claimNo}`);
  }

  if (command === '/verifyclaim') {
    const claimNo = (parts[0] || '').toUpperCase();
    const decision = (parts[1] || '').toLowerCase();
    if (!claimNo || !['approved', 'rejected'].includes(decision)) {
      return sendText(from, 'Use: /verifyclaim CL-0001 approved\nOr: /verifyclaim CL-0001 rejected');
    }

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, `Claim not found: ${claimNo}`);

    const data = safeJsonParse(claim.data, {});
    data.documentVerification = decision === 'approved' ? 'verified' : 'rejected';

    const newStatus = decision === 'approved' ? 'documents_verified' : 'documents_rejected';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run(newStatus, JSON.stringify(data), now(), claimNo);

    if (decision === 'approved') {
      await sendText(claim.customer_phone, `Your claim documents have been verified.\n\nClaim Reference: ${claimNo}\n\nThe team will continue processing your claim.`);
    } else {
      await sendText(claim.customer_phone, `⚠️ We could not verify one or more claim documents.\n\nClaim Reference: ${claimNo}\n\nA team member will contact you for assistance.`);
    }

    return sendText(from, `Claim ${claimNo} marked as ${newStatus}.`);
  }

  if (command === '/dashboard') {
    if (!BASE_URL) return sendText(from, 'BASE_URL is not configured.');
    return sendText(from, `📊 Admin Dashboard\n\n${BASE_URL}/studio/\n\nSign in with the normal dashboard PIN.`);
  }

  return null;
}

const vpAdminAuthFailures = new Map();

function vpSafeTextEqual(a, b) {
  const aa = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function vpAdminAuthKey(req) {
  // Trust only the address nginx overwrites (X-Real-IP) or the direct socket.
  // Never use the first X-Forwarded-For value because clients can prepend it.
  return String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown')
    .trim()
    .slice(0, 120);
}

function vpAdminPinReceived(req) {
  return req.headers['x-admin-pin'] || req.query?.pin || req.body?.pin || '';
}

function vpAdminAuthLimited(req) {
  const key = vpAdminAuthKey(req);
  const nowMs = Date.now();
  const state = vpAdminAuthFailures.get(key);
  if (!state || nowMs - state.firstAt > 15 * 60 * 1000) {
    if (state) vpAdminAuthFailures.delete(key);
    return false;
  }
  return state.count >= 10;
}

function vpAdminRecordFailure(req) {
  const key = vpAdminAuthKey(req);
  const nowMs = Date.now();
  const state = vpAdminAuthFailures.get(key);
  if (!state || nowMs - state.firstAt > 15 * 60 * 1000) {
    vpAdminAuthFailures.set(key, { count: 1, firstAt: nowMs });
  } else {
    state.count += 1;
    vpAdminAuthFailures.set(key, state);
  }
  if (vpAdminAuthFailures.size > 1000) {
    for (const [k, v] of vpAdminAuthFailures.entries()) {
      if (nowMs - v.firstAt > 15 * 60 * 1000) vpAdminAuthFailures.delete(k);
    }
  }
}

function vpAdminPinOk(req) {
  const expected = String(process.env.ADMIN_PIN || ADMIN_PIN || '');
  const received = String(vpAdminPinReceived(req) || '');
  if (!expected || !received) return false;
  return vpSafeTextEqual(received, expected);
}

function vpAdminAuthCheck(req) {
  if (vpAdminAuthLimited(req)) return { ok: false, limited: true };
  if (!vpAdminPinOk(req)) {
    vpAdminRecordFailure(req);
    return { ok: false, limited: false };
  }
  vpAdminAuthFailures.delete(vpAdminAuthKey(req));
  return { ok: true, limited: false };
}

function htmlEscape(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function requirePin(req, res) {
  const auth = vpAdminAuthCheck(req);
  if (!auth.ok) {
    if (auth.limited) res.set('Retry-After', '900');
    res.status(auth.limited ? 429 : 403).send(auth.limited ? 'Too Many Attempts' : 'Forbidden');
    return false;
  }
  return true;
}

app.get('/admin', (req, res) => {
  if (!requirePin(req, res)) return;
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer');

  const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 50').all();
  const claims = db.prepare('SELECT * FROM claims ORDER BY id DESC LIMIT 50').all();

  const jobRows = jobs.map(j => `
    <tr>
      <td>${htmlEscape(j.job_no)}</td>
      <td>${htmlEscape(j.customer_name)}</td>
      <td>${htmlEscape(j.customer_phone)}</td>
      <td>${htmlEscape(j.vehicle)}</td>
      <td>${htmlEscape(j.service)}</td>
      <td><b>${htmlEscape(j.status)}</b></td>
      <td>${htmlEscape(j.fitter || '-')}</td>
    </tr>
  `).join('');

  const claimRows = claims.map(c => {
    const data = safeJsonParse(c.data, {});
    return `
      <tr>
        <td>${htmlEscape(c.claim_no)}</td>
        <td>${htmlEscape(c.insurer)}</td>
        <td>${htmlEscape(data.insuredName || '-')}</td>
        <td>${htmlEscape(c.customer_phone)}</td>
        <td><b>${htmlEscape(c.status)}</b></td>
        <td>${htmlEscape(data.documentVerification || '-')}</td>
        <td>${c.pdf_url ? `<a href="${htmlEscape(c.pdf_url)}">PDF</a>` : '-'}</td>
      </tr>
    `;
  }).join('');

  res.send(`<!doctype html>
<html>
<head>
  <title>${htmlEscape(BUSINESS_NAME)} Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: Arial, sans-serif; background:#0f172a; color:#e5e7eb; margin:0; padding:24px; }
    h1,h2 { color:#fff; }
    .card { background:#111827; border:1px solid #334155; border-radius:14px; padding:18px; margin-bottom:24px; overflow:auto; }
    table { width:100%; border-collapse:collapse; min-width:900px; }
    th,td { border-bottom:1px solid #334155; padding:10px; text-align:left; font-size:14px; }
    th { color:#93c5fd; }
    a { color:#38bdf8; text-decoration:none; font-weight:bold; }
    .badge { display:inline-block; padding:6px 10px; border-radius:999px; background:#1e293b; color:#bfdbfe; }
  </style>
</head>
<body>
  <h1>${htmlEscape(BUSINESS_NAME)} Dashboard</h1>
  <p class="badge">WhatsApp Workshop Management </p>

  <div class="card">
    <h2>Latest Jobs</h2>
    <table>
      <thead><tr><th>Job Card</th><th>Customer</th><th>Phone</th><th>Vehicle</th><th>Service</th><th>Status</th><th>Fitter</th></tr></thead>
      <tbody>${jobRows || '<tr><td colspan="7">No jobs yet.</td></tr>'}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Latest Claims</h2>
    <table>
      <thead><tr><th>Claim</th><th>Insurer</th><th>Insured</th><th>Phone</th><th>Status</th><th>Verification</th><th>PDF</th></tr></thead>
      <tbody>${claimRows || '<tr><td colspan="7">No claims yet.</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`);
});


async function handleBackNavigation(to, input) {
  if (input === 'back_main') return mainMenu(to);
  if (input === 'back_claim_insurers') return insuranceCompanyList(to);

  const s = getSession(to);
  const data = s.data || {};
  const state = s.state || 'idle';

  if (await vpHandleCustomBookingBack(to, state, data)) return;

  const claimNo =
    data.claimNoInternal ||
    data.claimNo ||
    data.claim ||
    data.claimRef ||
    '';

  const saveClaimBackState = (status) => {
    if (!claimNo) return;

    try {
      db.prepare(`
        UPDATE claims
        SET status=?, data=?, updated_at=?
        WHERE claim_no=?
      `).run(
        status,
        JSON.stringify(data),
        now(),
        claimNo
      );
    } catch (error) {
      console.error(
        'CLAIM_BACK_STATE_UPDATE_ERROR',
        error.message
      );
    }
  };

  const clearClaimUploadRole = (
    role,
    flag,
    photoKey
  ) => {
    data.claimImageRoles =
      data.claimImageRoles || {};

    delete data.claimImageRoles[role];
    data[flag] = false;
    delete data[photoKey];

    if (!claimNo) return;

    try {
      db.prepare(`
        UPDATE attachments
        SET claim_role=NULL,
            role_label=NULL,
            role_order=NULL
        WHERE claim_no=?
          AND claim_role=?
      `).run(
        claimNo,
        role
      );
    } catch (error) {
      console.error(
        'CLAIM_BACK_ROLE_CLEAR_ERROR',
        error.message
      );
    }
  };

  const claimFieldWasSkipped = (index) => {
    const key =
      VP_STRICT_CLAIM_FIELDS[index]?.[0] ||
      '';

    if (
      key === 'drivingConvictionsDetails' &&
      String(data.drivingConvictions || '')
        .toLowerCase() === 'no'
    ) {
      return true;
    }

    if (
      key === 'otherDamageDetails' &&
      String(data.otherDamage || '')
        .toLowerCase() === 'no'
    ) {
      return true;
    }

    if (
      key === 'existingDamageDetails' &&
      String(data.existingDamage || '')
        .toLowerCase() === 'no'
    ) {
      return true;
    }

    return false;
  };

  if (state.startsWith('claim_field_')) {
    const idx = Number(
      state.replace('claim_field_', '')
    );

    if (
      !Number.isInteger(idx) ||
      idx <= 0
    ) {
      return insuranceCompanyList(to);
    }

    let prev = idx - 1;

    while (
      prev > 0 &&
      claimFieldWasSkipped(prev)
    ) {
      prev -= 1;
    }

    const prevKey =
      VP_STRICT_CLAIM_FIELDS[prev]?.[0];

    if (prevKey) {
      delete data[prevKey];

      if (prevKey === 'drivingConvictions') {
        delete data.drivingConvictionsDetails;
      }

      if (prevKey === 'otherDamage') {
        delete data.otherDamageDetails;
      }

      if (prevKey === 'existingDamage') {
        delete data.existingDamageDetails;
      }
    }

    setSession(
      to,
      `claim_field_${prev}`,
      data
    );

    saveClaimBackState(
      'collecting_missing_required_fields'
    );

    return sendClaimQuestion(to, prev);
  }

  if (state === 'claim_extra_photo_upload') {
    const returnState =
      data.photoReturnState ||
      'claim_field_0';

    const returnIndex = Number(
      data.photoReturnIndex ??
      String(returnState).replace(
        'claim_field_',
        ''
      )
    );

    delete data.photoReturnState;
    delete data.photoReturnIndex;
    delete data.photoForField;
    delete data.photoForLabel;

    setSession(
      to,
      returnState,
      data
    );

    return sendClaimQuestion(
      to,
      Number.isInteger(returnIndex)
        ? returnIndex
        : 0
    );
  }

  if (state === 'claim_upload_id') {
    const last =
      VP_STRICT_CLAIM_FIELDS.length - 1;

    const lastKey =
      VP_STRICT_CLAIM_FIELDS[last]?.[0];

    if (lastKey) {
      delete data[lastKey];
    }

    setSession(
      to,
      `claim_field_${last}`,
      data
    );

    saveClaimBackState(
      'collecting_missing_required_fields'
    );

    return sendClaimQuestion(
      to,
      last
    );
  }

  if (state === 'claim_upload_licence') {
    clearClaimUploadRole(
      'national_id',
      'idPhotoReceived',
      'nationalIdPhoto'
    );

    setSession(
      to,
      'claim_upload_id',
      data
    );

    saveClaimBackState(
      'awaiting_id_photo'
    );

    return sendUploadPrompt(
      to,
      vpClaimUploadPrompt(
        'claim_upload_id'
      ),
      'back_prev'
    );
  }

  if (state === 'claim_upload_vehicle_reg') {
    clearClaimUploadRole(
      'driver_licence',
      'licencePhotoReceived',
      'driverLicencePhoto'
    );

    setSession(
      to,
      'claim_upload_licence',
      data
    );

    saveClaimBackState(
      'awaiting_driver_licence'
    );

    return sendUploadPrompt(
      to,
      vpClaimUploadPrompt(
        'claim_upload_licence'
      ),
      'back_prev'
    );
  }

  if (state === 'claim_upload_damage_glass') {
    clearClaimUploadRole(
      'vehicle_reg',
      'vehicleRegPhotoReceived',
      'vehicleRegPhoto'
    );

    setSession(
      to,
      'claim_upload_vehicle_reg',
      data
    );

    saveClaimBackState(
      'awaiting_vehicle_reg_photo'
    );

    return sendUploadPrompt(
      to,
      vpClaimUploadPrompt(
        'claim_upload_vehicle_reg'
      ),
      'back_prev'
    );
  }

  if (state === 'book_type') {
    return serviceList(to, 'book');
  }

  if (state === 'book_date') {
    setSession(to, 'book_type', data);

    return sendButtons(
      to,
      'Is this a cash job or insurance job?',
      [
        {
          id: 'job_cash',
          title: 'Cash Job'
        },
        {
          id: 'job_insurance',
          title: 'Insurance Job'
        },
        {
          id: 'job_not_sure',
          title: 'Not Sure'
        }
      ]
    );
  }

  if (
    state === 'book_custom_date' ||
    state === 'book_time'
  ) {
    return askBookingDate(to, data);
  }

  if (state === 'book_name') {
    setSession(to, 'book_time', data);
    return sendGuidedPrompt(
      to,
      'What time should we book you for?\n\nExample: 10:30am',
      'back_prev'
    );
  }

  if (state === 'book_vehicle') {
    setSession(to, 'book_name', data);

    return sendGuidedPrompt(
      to,
      'Please type your full name.\n\nExample: Tafadzwa Moyo',
      'back_prev'
    );
  }

  if (state === 'book_reg') {
    setSession(to, 'book_vehicle', data);

    return sendGuidedPrompt(
      to,
      'Please type your vehicle make/model/year.\n\nExample: Toyota Aqua 2015',
      'back_prev'
    );
  }

  if (state === 'book_location') {
    setSession(to, 'book_reg', data);

    return sendGuidedPrompt(
      to,
      'Please type the vehicle registration number.\n\nExample: ADF 1234',
      'back_prev'
    );
  }

  if (state === 'book_media') {
    setSession(to, 'book_location', data);

    return sendGuidedPrompt(
      to,
      'Please send the vehicle location pin or type the address.\n\nExample: 24 Samora Machel Avenue, Harare',
      'back_prev'
    );
  }

  if (state === 'book_vehicle_body') {
    setSession(to, 'book_id_upload', data);

    return sendUploadPrompt(
      to,
      'Please upload the ID/licence document again, or type SKIP for a cash job.',
      'back_prev'
    );
  }

  if (state === 'book_confirm') {
    return vpSendAntiSmashBodyTypeList(to, data);
  }

  if (state === 'book_id_upload') {
    setSession(to, 'book_media', data);

    const isAntiSmash =
      /anti[-\s]?smash|smash.*grab/i.test(
        String(data.service || '')
      );

    if (isAntiSmash) {
      return sendPhotoOnlyPrompt(
        to,
        'Please upload one clear photo showing the full vehicle.',
        'back_prev'
      );
    }

    return sendUploadPrompt(
      to,
      'Please upload clear photos or a short video of the damaged glass/vehicle.\n\nExample: front view of windscreen, close-up of crack, full vehicle photo',
      'back_prev'
    );
  }

  if (state === 'quote_type') {
    return serviceList(to, 'quote');
  }

  if (state === 'quote_name') {
    setSession(to, 'quote_type', data);

    return sendButtons(
      to,
      'Is this a cash job or insurance job?',
      [
        {
          id: 'job_cash',
          title: 'Cash Job'
        },
        {
          id: 'job_insurance',
          title: 'Insurance Job'
        },
        {
          id: 'job_not_sure',
          title: 'Not Sure'
        }
      ]
    );
  }

  if (state === 'quote_vehicle') {
    setSession(to, 'quote_name', data);

    return sendGuidedPrompt(
      to,
      'Please type your full name.\n\nExample: Tafadzwa Moyo',
      'back_prev'
    );
  }

  if (state === 'quote_location') {
    setSession(to, 'quote_vehicle', data);

    return sendGuidedPrompt(
      to,
      'Please type vehicle make/model/year.\n\nExample: Toyota Aqua 2015',
      'back_prev'
    );
  }

  if (state === 'quote_media') {
    setSession(to, 'quote_location', data);

    return sendGuidedPrompt(
      to,
      'Please send the vehicle location pin or type the address.\n\nExample: 24 Samora Machel Avenue, Harare',
      'back_prev'
    );
  }

  if (state === 'track_waiting') {
    return mainMenu(to);
  }

  return mainMenu(to);
}



function isKnownBotAction(input) {
  if (!input) return false;

  return [
    'menu_', 'claim_', 'quote_', 'complete_', 'job_', 'date_',
    'svc_', 'media_', 'back_'
  ].some(prefix => input.startsWith(prefix));
}

function looksConfused(input) {
  const t = String(input || '').toLowerCase();

  return [
    'confused',
    'im confused',
    "i'm confused",
    'am confused',
    'um confused',
    'lost',
    'stuck',
    'help me',
    'what now',
    'what next',
    'what should i do',
    'i dont understand',
    "i don't understand",
    'dont understand',
    "don't understand",
    'how do i',
    'where am i',
    'explain'
  ].some(x => t.includes(x));
}

function detectSimpleIntent(input) {
  const t = String(input || '').toLowerCase();

  if (t.includes('claim') || t.includes('insurance') || t.includes('policy')) return 'menu_claim';
  if (t.includes('quote') || t.includes('price') || t.includes('cost') || t.includes('how much')) return 'menu_quote';
  if (t.includes('book') || t.includes('appointment') || t.includes('schedule')) return 'menu_book';
  if (t.includes('track') || t.includes('status') || t.includes('job card')) return 'menu_track';
  if (t.includes('service') || t.includes('windscreen') || t.includes('tint') || t.includes('alarm') || t.includes('aircon') || t.includes('tracker') || t.includes('audio')) return 'menu_services';
  if (t.includes('human') || t.includes('agent') || t.includes('team') || t.includes('person')) return 'menu_team';

  return null;
}

function detectHumanHandoffIntent(input) {
  const t = String(input || '').toLowerCase();

  return [
    'owner',
    'boss',
    'manager',
    'director',
    'supervisor',
    'human',
    'person',
    'agent',
    'team',
    'call me',
    'phone me',
    'speak to someone',
    'talk to someone',
    'talk to the owner',
    'speak to the owner',
    'connect me',
    'representative'
  ].some(x => t.includes(x));
}

function detectNumericMenuChoice(input) {
  const t = String(input || '').trim();

  const map = {
    '1': 'menu_book',
    '2': 'menu_claim',
    '3': 'menu_quote',
    '4': 'menu_track',
    '5': 'menu_services',
    '6': 'menu_team'
  };

  return map[t] || null;
}

function describeCurrentStep(session) {
  const state = session?.state || 'idle';
  const data = session?.data || {};

  if (state === 'idle') {
    return 'The customer is not currently inside a form. Help them understand what they need, then gently guide them to the correct option in the WhatsApp menu.';
  }

  if (state === 'claim_choose_insurer') {
    return 'The customer is choosing an insurance company for a motor glass claim form. If they ask what insurance is, explain simply: insurance is a cover/policy that may help pay for repairs or replacement when there is damage, depending on their policy. Then guide them to tap the Insurers button and choose their insurance company such as Old Mutual, Zimnat, Moovah, Evolution, Cell or Alliance Insurance.';
  }

  if (state.startsWith('claim_field_')) {
    const idx = Number(state.replace('claim_field_', ''));
    return `The customer is filling an insurance claim form. Current question: ${claimQuestion(idx)}`;
  }

  if (state === 'claim_upload_id') {
    return 'The customer must upload a clear National ID photo/document. They should send it below as a normal WhatsApp photo or document, not view-once.';
  }

  if (state === 'claim_upload_licence') {
    return "The customer must upload a clear driver's licence photo/document. They should send it below as a normal WhatsApp photo or document, not view-once.";
  }

  if (state === 'claim_change_notes') {
    return 'The customer needs to type the correction they want on the generated claim PDF.';
  }

  if (state === 'book_service') return 'The customer must choose the service they need from the service list.';
  if (state === 'book_type') return 'The customer must choose Cash Job, Insurance Job, or Not Sure.';
  if (state === 'book_date') return 'The customer must choose Today, Tomorrow, or Choose Date.';
  if (state === 'book_custom_date') return 'The customer must type the preferred booking date. Example: 2026-09-25.';
  if (state === 'book_time') return 'The customer must type the preferred booking time. Example: 10:30am.';
  if (state === 'book_name') return 'The customer must type their full name. Example: Tafadzwa Moyo.';
  if (state === 'book_vehicle') return 'The customer must type vehicle make/model/year. Example: Toyota Aqua 2015.';
  if (state === 'book_reg') return 'The customer must type vehicle registration number. Example: ADF 1234.';
  if (state === 'book_location') return 'The customer must send a location pin or type address. Example: 24 Samora Machel Avenue, Harare.';
  if (state === 'book_media') return 'The customer must upload clear vehicle/damage photos or a short video.';
  if (state === 'book_id_upload') return 'The customer must upload ID/licence document or type SKIP if it is not an insurance job.';

  if (state === 'quote_service') return 'The customer must choose the service they need for a quote.';
  if (state === 'quote_type') return 'The customer must choose Cash Job, Insurance Job, or Not Sure.';
  if (state === 'quote_name') return 'The customer must type their full name. Example: Tafadzwa Moyo.';
  if (state === 'quote_vehicle') return 'The customer must type vehicle make/model/year. Example: Toyota Aqua 2015.';
  if (state === 'quote_location') return 'The customer must send a location pin or type address.';
  if (state === 'quote_media') return 'The customer must upload damage photos or a short video.';

  if (state === 'track_waiting') return 'The customer must type their job card or claim number. Examples: JC-0001 or CL-0012.';

  return `The customer is in state ${state}. Guide them back to the current expected step.`;
}

async function deepSeekGuideText(from, userText) {
  const session = getSession(from);
  const currentStep = describeCurrentStep(session);

  const fallback = `No problem, I can guide you.

${currentStep}

Please continue with that step, or tap Menu to restart.`;

  if (!DEEPSEEK_API_KEY) return fallback;

  try {
    const res = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content:
`You are a kind background assistant for a WhatsApp auto glass workshop system.

Your personality:
- Be warm, patient and helpful, like a good person assisting an elderly customer.
- Explain things simply before guiding the customer.
- Do not sound like a strict menu or robot.
- Do not create fake numbered menus.
- Do not invent prices, insurance rules, approval guarantees, company policies, licences, registration, accreditation, insurance status, credentials or guarantees.
- When asked whether the business is legitimate, answer honestly without claiming unverified licences or credentials. Offer to connect the customer to the team for direct verification.
- Do not complete the form yourself.
- Tell the customer exactly what to type, upload, or tap next.
- If the customer asks "what is insurance", explain that insurance is a policy/cover that may help pay for repairs or replacement depending on their insurer and policy.
- If the customer asks to speak to the owner, boss, manager, or a human, say you can connect them and ask what specific help they need.
- If the customer is inside a form, guide them back to the current step kindly.
- Keep replies short, natural and WhatsApp-ready.
- Use only 1 to 3 professional emojis.
- Never mention internal state names.
- Never say you are DeepSeek or an AI model.`
          },
          {
            role: 'user',
            content:
`Customer phone: ${from}
Customer message: ${userText || '(empty/unclear message)'}

Current expected step:
${currentStep}

Write the best guidance reply.`
          }
        ],
        temperature: 0.2,
        max_tokens: 220,
        stream: false
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`
        },
        timeout: 20000
      }
    );

    let text = res.data?.choices?.[0]?.message?.content?.trim();
    const finishReason = res.data?.choices?.[0]?.finish_reason || 'unknown';

    const appearsIncomplete =
      Boolean(text) &&
      text.length < 160 &&
      !/[.!?…)"']$/.test(text);

    if (appearsIncomplete) {
      console.warn('DEEPSEEK_GUIDE_INCOMPLETE', {
        from,
        characters: text.length,
        finishReason
      });

      if (/\b(legit|legitimate|real business|registered business)\b/i.test(String(userText || ''))) {
        text =
          'You are chatting with Auto Glass Workshop through its official WhatsApp service. ' +
          'For direct verification of business credentials, please choose Talk to Team from the menu.';
      } else {
        text = fallback;
      }
    }

    console.log('DEEPSEEK_GUIDE_RESULT', {
      from,
      characters: String(text || '').length,
      finishReason,
      usedFallback: !text || text === fallback
    });

    return text || fallback;
  } catch (err) {
    console.error('DEEPSEEK_GUIDE_ERROR:', err.response?.status, JSON.stringify(err.response?.data || err.message, null, 2));
    return fallback;
  }
}

async function sendBackgroundAiGuide(from, userText) {
  const text = await deepSeekGuideText(from, userText);

  return sendButtons(from, text, [
    { id: 'back_prev', title: '↩️ Back' },
    { id: 'back_main', title: ' Menu' }
  ]);
}

async function routeSimpleIntent(from, intent) {
  if (intent === 'menu_claim') {
    await sendText(from,
` Insurance helps when a customer has a policy/cover that may pay for glass repair or replacement, depending on their insurer and policy.

No problem, let me take you to the insurance claim section. Please choose the insurance company below.`
    );
    return insuranceCompanyList(from);
  }

  if (intent === 'menu_quote') {
    await sendText(from,
`💰 A quote is an estimated price for the job before work starts.

No problem, let me help you request a quote.`
    );
    return serviceList(from, 'quote');
  }

  if (intent === 'menu_book') {
    await sendText(from,
`🚗 No problem, let me help you book the job step by step.`
    );
    return serviceList(from, 'book');
  }

  if (intent === 'menu_track') {
    setSession(from, 'track_waiting', {});
    return sendGuidedPrompt(from, `🔎 Please type your job card or claim number.\n\nExamples:\nJC-0001\nCL-0012`, 'back_main');
  }

  if (intent === 'menu_services') return servicesMessage(from);
  if (intent === 'menu_team') return teamHandoff(from, 'Customer asked to speak to a person/team.');

  return null;
}



function isActiveBusinessFlowState(state) {
  state = String(state || '');

  return (
    state.startsWith('claim_field_') ||
    state === 'claim_choose_insurer' ||
    state === 'claim_upload_id' ||
    state === 'claim_upload_licence' ||
    state === 'claim_extra_photo_upload' ||
    state === 'claim_change_notes' ||
    state === 'claim_change_select_field' ||
    state === 'claim_change_enter_value' ||
    state === 'claim_signature_pending' ||
    state.startsWith('book_') ||
    state.startsWith('quote_') ||
    state === 'track_waiting' ||
    state === 'handoff_notes'
  );
}


async function claimFormWarning(to) {
  await sendText(to,
`⚠️ Important before you continue

Please read every question carefully and answer as accurately as possible.

This claim form is used to generate your official digital PDF, so corrections after submission may take extra time and may need the team to assist manually.

If you are not sure about an answer, type NOT SURE instead of guessing.`
  );

  return insuranceCompanyList(to);
}


// VP_AI_FLOW_RETURN_GUARD_V2
function vpIsActiveCaptureFlowState(state) {
  return /^(book|booking|quote|claim)_/i.test(String(state || ''));
}

function vpLooksLikeCustomerQuestion(input) {
  let t = String(input || '').trim().toLowerCase();

  if (!t) return false;

  if (/^(menu|open menu|back|previous|cancel|yes|no|confirm|correct|done|not sure)$/i.test(t)) {
    return false;
  }

  // Understand common WhatsApp typing mistakes.
  t = t
    .replace(/\b(wat|wht|wot)\b/g, 'what')
    .replace(/\bwhats\b/g, 'what is')
    .replace(/\bwer\b/g, 'where')
    .replace(/\bwich\b/g, 'which')
    .replace(/\bservces\b/g, 'services')
    .replace(/\bservics\b/g, 'services');

  if (t.includes('?')) return true;

  if (/^(what|how|where|when|why|who|which|can|could|do|does|is|are|will|would|may|should)\b/i.test(t)) {
    return true;
  }

  if (/\b(how much|price|cost|charges|opening time|open today|are you open|location|where are you|services? do you offer|what services?|which services?|do you do|can you do|do you assist|do you repair|do you replace|tinting|tracker|alarm|aircon|car audio|legit|legitimate|real business|registered business)\b/i.test(t)) {
    return true;
  }

  return false;
}

function vpFlowSmartAnswer(input) {
  const t = String(input || '').toLowerCase();

  if (/\b(price|cost|charge|how much)\b/.test(t)) {
    return 'Prices depend on the vehicle model, the type of glass, and the work needed.';
  }

  if (/\b(tint|tinting|ceramic)\b/.test(t)) {
    return 'Yes, we assist with vehicle tinting, including ceramic tint options.';
  }

  if (/\b(alarm|tracker|tracking|audio|sound|radio|aircon|ac)\b/.test(t)) {
    return 'Yes, we also assist with alarms, trackers, car audio and aircon services.';
  }

  if (/\b(insurance|claim|cover|policy)\b/.test(t)) {
    return 'Insurance claims can be assisted through the digital claim flow, depending on your insurer and policy details.';
  }

  if (/\b(location|where are you|address)\b/.test(t)) {
    return 'Location details help us direct the job properly.';
  }

  if (/\b(open|hours|time)\b/.test(t)) {
    return 'You can submit your request here, and the workshop can process it from the captured details.';
  }

  return 'I can help with that.';
}

function vpCleanFlowPrompt(prompt) {
  let q = String(prompt || '').trim();

  q = q
    .replace(/\n*👇\s*Please tap[\s\S]*?below to continue\.\s*$/i, '')
    .replace(/\n*Use Back if you need to correct the previous step\.\s*/i, '\n')
    .replace(/\n*↩️?\s*Use Back if you need to correct the previous step\.\s*/i, '\n')
    .trim();

  return q;
}

function vpFallbackCurrentAction(session) {
  const state = String(session?.state || '').toLowerCase();

  if (/name/.test(state)) return 'Please type your full name.\n\nExample: Tafadzwa Moyo';
  if (/phone|telephone|cell/.test(state)) return 'Please type your phone number.\n\nExample: 0771234567';
  if (/location|address/.test(state)) return 'Please type your location or address.\n\nExample: Harare';
  if (/vehicle|make|model/.test(state)) return 'Please type your vehicle make and model.\n\nExample: Toyota D-Max 2013';
  if (/reg/.test(state)) return 'Please type your vehicle registration number.\n\nExample: ADF 4763';
  if (/service|damage|issue/.test(state)) return 'Please describe the service or damage.\n\nExample: Windscreen replacement';
  if (/date|time|when/.test(state)) return 'Please type when you need this done.\n\nExample: Tomorrow morning';
  if (/photo|media|upload|licence|license|id|document/.test(state)) return 'Please upload the required photo or document to continue.';
  if (/confirm|review/.test(state)) return 'Please review the details and tap the correct button to continue.';
  if (/signature/.test(state)) return 'Please open the secure signing link sent above and submit your signature. If you cannot use it, reply MANUAL SIGNATURE.';

  return 'Please continue by answering the current step shown above.';
}


// VP_DETERMINISTIC_FLOW_RECOVERY_V1
const vpPendingFlowAlerts = new Map();
// No AI is used. Unexpected flow input gives the customer
// Continue Flow or Talk to Team.

function vpSafeFlowAlertText(value, limit = 500) {
  const clean = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= limit) return clean;

  return `${clean.slice(0, limit - 1)}…`;
}

function vpLatestFlowAlertRef(phone) {
  try {
    const job = db.prepare(`
      SELECT job_no AS ref
      FROM jobs
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    const claim = db.prepare(`
      SELECT claim_no AS ref
      FROM claims
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    return job?.ref || claim?.ref ||
      `WA-${String(phone || '').replace(/\D/g, '').slice(-4) || 'UNKNOWN'}`;
  } catch (error) {
    console.error(
      'FLOW_ALERT_REFERENCE_ERROR:',
      error.message
    );

    return `WA-${String(phone || '').replace(/\D/g, '').slice(-4) || 'UNKNOWN'}`;
  }
}

function vpWriteFlowAlertToDashboard(phone, state, input, reason) {
  try {
    const ref = vpLatestFlowAlertRef(phone);

    const note = [
      'WhatsApp customer needs flow assistance.',
      `Phone: ${phone}`,
      `Current step: ${state || 'idle'}`,
      `Reason: ${reason || 'off_script_input'}`,
      `Message: ${vpSafeFlowAlertText(input) || '(empty message)'}`
    ].join(' | ');

    db.prepare(`
      INSERT INTO studio_notes
      (ref, type, note, actor, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      ref,
      'flow_attention',
      note,
      'bot',
      now()
    );

    console.log('FLOW_ALERT_DASHBOARD_CREATED', {
      ref,
      phone,
      state,
      reason
    });

    return ref;
  } catch (error) {
    console.error(
      'FLOW_ALERT_DASHBOARD_ERROR:',
      error.message
    );

    return null;
  }
}

async function vpNotifyTeamOfFlowIssue(
  phone,
  state,
  input,
  reason
) {
  const ref = vpWriteFlowAlertToDashboard(
    phone,
    state,
    input,
    reason
  );

  await alertAdmin(
`CUSTOMER NEEDS FLOW ASSISTANCE

Phone: ${phone}
Current Step: ${state || 'idle'}
Reason: ${reason || 'off_script_input'}
Message: ${vpSafeFlowAlertText(input) || '(empty message)'}
Dashboard Ref: ${ref || 'Not available'}

The customer has been shown Continue Flow and Talk to Team.`
  );

  console.log('FLOW_ALERT_TEAM_SENT', {
    phone,
    state,
    reason,
    ref
  });
}

async function vpShowFlowRecovery(
  to,
  input,
  reason = 'off_script_input'
) {
  const session =
    typeof getSession === 'function'
      ? getSession(to)
      : null;

  const state = String(session?.state || 'idle');

  // Keep the incident pending. Do not alert yet.
  vpPendingFlowAlerts.set(String(to), {
    phone: to,
    state,
    input: vpSafeFlowAlertText(input),
    reason,
    createdAt: Date.now()
  });

  console.log('FLOW_ALERT_DEFERRED', {
    phone: to,
    state,
    reason
  });

  if (state === 'idle') {
    vpPendingFlowAlerts.delete(String(to));

    await sendText(
      to,
      'Please use the menu options so we can guide you correctly.'
    );

    return mainMenu(to);
  }

  return sendButtons(
    to,
    `That message does not match the current step.

Please choose how you would like to continue.`,
    [
      { id: 'flow_continue', title: 'Continue Flow' },
      { id: 'flow_talk_team', title: 'Talk to Team' },
      { id: 'back_main', title: 'Main Menu' }
    ]
  );
}

function vpIsButtonOnlyFlowState(state) {
  return [
    'book_service',
    'quote_service',
    'book_type',
    'quote_type',
    'book_date',
    'claim_choose_insurer'
  ].includes(String(state || ''));
}

function vpIsValidButtonInputForState(state, input) {
  const value = String(input || '').trim();

  const allowed = {
    book_service: new Set(Object.keys(serviceNames)),
    quote_service: new Set(Object.keys(serviceNames)),

    book_type: new Set([
      'job_cash',
      'job_insurance',
      'job_not_sure'
    ]),

    quote_type: new Set([
      'job_cash',
      'job_insurance',
      'job_not_sure'
    ]),

    book_date: new Set([
      'date_today',
      'date_tomorrow',
      'date_choose'
    ]),

    claim_choose_insurer: new Set([
      'claim_old_mutual',
      'claim_zimnat',
      'claim_moovah',
      'claim_evolution',
      'claim_cell',
      'claim_alliance',
      'claim_not_sure'
    ])
  };

  return Boolean(allowed[state]?.has(value));
}

async function vpReplayRequiredCurrentStep(to) {
  const session =
    typeof getSession === 'function'
      ? getSession(to)
      : null;

  const state = String(session?.state || '');
  const data = session?.data || {};

  if (state === 'book_service') {
    return serviceList(to, 'book');
  }

  if (state === 'quote_service') {
    return serviceList(to, 'quote');
  }

  if (state === 'book_type' || state === 'quote_type') {
    setSession(to, state, data);

    return sendButtons(
      to,
      'Is this a cash job or insurance job?',
      [
        { id: 'job_cash', title: 'Cash Job' },
        { id: 'job_insurance', title: 'Insurance Job' },
        { id: 'job_not_sure', title: 'Not Sure' }
      ]
    );
  }

  if (state === 'book_date') {
    setSession(to, state, data);

    return sendButtons(
      to,
      'When do you need this done?',
      [
        { id: 'date_today', title: 'Today' },
        { id: 'date_tomorrow', title: 'Tomorrow' },
        { id: 'date_choose', title: 'Choose Date' }
      ]
    );
  }

  if (state === 'claim_choose_insurer') {
    return insuranceCompanyList(to);
  }

  if (state.startsWith('claim_field_')) {
    const index = Number(
      state.replace('claim_field_', '')
    );

    return sendClaimQuestion(to, index);
  }

  const action = vpFallbackCurrentAction(session);

  if (/upload|photo|media|licence|license|document/i.test(state)) {
    return sendUploadPrompt(to, action, 'back_prev');
  }

  return sendGuidedPrompt(to, action, 'back_prev');
}

async function vpMaybeAnswerQuestionAndReturnToFlow(to, input) {
  try {
    const session =
      typeof getSession === 'function'
        ? getSession(to)
        : null;

    const state = String(session?.state || '');
    const normalized = String(input || '')
      .trim()
      .toLowerCase();

    // Global navigation must never be blocked by the flow guard.
    if (
      [
        'hi',
        'hello',
        'hey',
        'start',
        'menu',
        '/start',
        '/menu'
      ].includes(normalized)
    ) {
      return false;
    }

    if (
      normalized.startsWith('back_') ||
      normalized === 'flow_continue' ||
      normalized === 'flow_talk_team'
    ) {
      return false;
    }

    if (!vpIsActiveCaptureFlowState(state)) {
      return false;
    }

    const isQuestion =
      vpLooksLikeCustomerQuestion(input);

    const buttonOnly =
      vpIsButtonOnlyFlowState(state);

    const validButton =
      vpIsValidButtonInputForState(state, input);

    // Normal typed form answers continue through the normal handler.
    if (!isQuestion && !(buttonOnly && !validButton)) {
      return false;
    }

    const reason =
      buttonOnly && !validButton
        ? 'button_required'
        : 'off_script_question';

    console.log('FLOW_RECOVERY_REQUIRED', {
      to,
      state,
      reason,
      input: String(input || '').slice(0, 100)
    });

    await vpShowFlowRecovery(
      to,
      input,
      reason
    );

    return true;
  } catch (error) {
    console.error(
      'FLOW_RECOVERY_GUARD_ERROR:',
      error.message
    );

    return false;
  }
}


// VP_AI_TWO_BUTTON_ROUTE_HELPERS_V1
function vpAiSuggestedRoute(input) {
  const t = String(input || '').toLowerCase();

  if (/\b(tint|tinting|ceramic|alarm|tracker|tracking|audio|sound|radio|aircon|ac|windscreen|glass|repair|replace)\b/.test(t)) {
    return { id: 'ai_route_services', title: 'View Services' };
  }

  if (/\b(price|cost|charge|how much|quote|quotation)\b/.test(t)) {
    return { id: 'menu_quote', title: 'Get Quote' };
  }

  if (/\b(insurance|claim|cover|policy)\b/.test(t)) {
    return { id: 'menu_claim', title: 'Start Claim' };
  }

  if (/\b(book|booking|appointment|schedule)\b/.test(t)) {
    return { id: 'menu_book', title: 'Book Job' };
  }

  return { id: 'menu', title: 'Open Menu' };
}

async function vpReplayLastFlowStep(to) {
  try {
    const session = typeof getSession === 'function' ? getSession(to) : null;
    const step = session?.lastInteractiveStep;

    if (step?.mode === 'buttons') {
      return sendButtons(to, step.text, step.buttons || []);
    }

    if (step?.mode === 'list') {
      return sendList(to, step.bodyText, step.buttonText || 'Open Menu', step.rows || [], step.sectionTitle || 'Options');
    }

    const savedPrompt = typeof vpCleanFlowPrompt === 'function'
      ? vpCleanFlowPrompt(session?.lastFlowPrompt || '')
      : String(session?.lastFlowPrompt || '').trim();

    if (savedPrompt && typeof sendGuidedPrompt === 'function') {
      return sendGuidedPrompt(to, savedPrompt, 'back_prev');
    }

    return sendText(to, 'Please continue by answering the current step shown above.');
  } catch (e) {
    console.error('AI_REPLAY_LAST_FLOW_STEP_ERROR:', e.message);
    return sendText(to, 'Please continue by answering the current step shown above.');
  }
}

async function vpAiShowServicesList(to) {
  return sendList(
    to,
    'Please choose the service you want to view.',
    'Services',
    [
      { id: 'service_windscreen_replace', title: '🪟 Windscreen Replace', description: 'Full windscreen replacement' },
      { id: 'service_windscreen_repair', title: '🔧 Windscreen Repair', description: 'Chip/crack repair' },
      { id: 'service_side_glass', title: '🚪 Side / Door Glass', description: 'Door glass replacement' },
      { id: 'service_rear_glass', title: '🚙 Rear Glass', description: 'Rear screen replacement' },
      { id: 'service_tint', title: '🎨 Ceramic Tint', description: 'Premium tinting' },
      { id: 'service_anti_smash', title: '🛡️ Anti-Smash Grab', description: 'Safety film' },
      { id: 'service_alarm', title: '🔔 Alarm Install', description: 'Vehicle alarms' },
      { id: 'service_aircon', title: '❄️ Aircon Service', description: 'Vehicle aircon' },
      { id: 'service_tracker', title: '📍 Tracker Install', description: 'Tracking devices' },
      { id: 'service_audio', title: '🔊 Car Audio', description: 'Audio installation' }
    ],
    'Services'
  );
}

async function vpHandleAiRouteButton(to, input) {
  const pendingKey = String(to);

  if (
    input === 'flow_continue' ||
    input === 'ai_continue_flow'
  ) {
    const pending = vpPendingFlowAlerts.get(pendingKey);

    vpPendingFlowAlerts.delete(pendingKey);

    console.log('FLOW_CONTINUE_SELECTED', {
      to,
      state:
        pending?.state ||
        getSession(to)?.state ||
        'idle',
      alertSent: false
    });

    return vpReplayRequiredCurrentStep(to);
  }

  if (input === 'back_main') {
    vpPendingFlowAlerts.delete(pendingKey);

    console.log('FLOW_MAIN_MENU_SELECTED', {
      to,
      alertSent: false
    });

    return mainMenu(to);
  }

  if (input === 'flow_talk_team') {
    const session =
      typeof getSession === 'function'
        ? getSession(to)
        : null;

    const pending =
      vpPendingFlowAlerts.get(pendingKey) || {
        phone: to,
        state: String(session?.state || 'idle'),
        input: '(original message unavailable)',
        reason: 'customer_selected_talk_to_team'
      };

    vpPendingFlowAlerts.delete(pendingKey);

    const ref = vpWriteFlowAlertToDashboard(
      to,
      pending.state,
      pending.input,
      pending.reason
    );

    console.log('FLOW_ALERT_RELEASED_AFTER_SELECTION', {
      to,
      state: pending.state,
      reason: pending.reason,
      ref
    });

    return teamHandoff(
      to,
      [
        'Customer selected Talk to Team after an off-script message.',
        `Current step: ${pending.state}`,
        `Original message: ${vpSafeFlowAlertText(pending.input, 300)}`,
        `Dashboard reference: ${ref || 'Not available'}`
      ].join(' | ')
    );
  }

  if (input === 'ai_route_services') {
    return vpAiShowServicesList(to);
  }

  return false;
}


async function handleInbound(inbound) {
  const from = inbound.from;
  const input = inbound.text;

  if (!from) {
    console.log('NO_FROM_IN_WEBHOOK', { type: inbound?.type || 'unknown' });
    return;
  }

  console.log('INBOUND', {
    from: `***${String(from).replace(/\D/g, '').slice(-4)}`,
    type: inbound.type,
    inputLength: String(input || '').length
  });

  // VP_CLAIM_IGNORE_MALFORMED_INTERACTIVE_ERRORS_V1
  const vpInboundErrors =
    Array.isArray(inbound?.raw?.errors)
      ? inbound.raw.errors
      : [];

  if (
    String(inbound?.type || '').toLowerCase() === 'interactive' &&
    !String(input || '').trim() &&
    vpInboundErrors.length
  ) {
    console.log('CLAIM_MALFORMED_INTERACTIVE_ERROR_IGNORED', {
      from,
      errors: vpInboundErrors.map(error => ({
        code: error?.code || '',
        title: String(error?.title || '').slice(0, 120)
      }))
    });

    return;
  }

  // VP_AI_ROUTE_BUTTON_HANDLER_CALL_V1
  const __vpAiRouteHandled = await vpHandleAiRouteButton(from, input);
  if (__vpAiRouteHandled) return;

  // VP_AI_FLOW_RETURN_GUARD_CALL_V2
  if (await vpMaybeAnswerQuestionAndReturnToFlow(from, input)) return;


  if (inbound.type === 'unsupported') {
    return sendText(from,
`⚠️ We could not read that message.

Please send it as a normal WhatsApp message, photo, video or document.

Avoid:
• View-once photos
• Unsupported file types
• Stickers/contact cards during the form

Reply MENU to restart if needed.`
    );
  }

  if (isAdmin(from) && input.startsWith('/')) {
    const handled = await adminCommand(from, input);
    if (handled) return;
  }

  const normalized = input.toLowerCase();

  // PHASE_2A_CLAIM_CONFIRM_TO_KEITHSTOPS
  if (input.startsWith('claim_confirm_')) {
    const claimNo = input.replace('claim_confirm_', '').trim().toUpperCase();
    return handleClaimConfirmed(from, claimNo);
  }


  // PHASE_1E_HARD_NEEDS_CHANGES_ROUTE
  
  // LEGACY_NEEDS_CHANGES_DISABLED
  if (input.startsWith('claim_change_')) {
    await alertAdmin(`📝 CUSTOMER REQUESTED CLAIM CHANGE FROM OLD BUTTON

Phone: ${from}
Button: ${input}

Needs Changes button has now been removed. Please assist manually if required.`);
    return sendText(from,
`This correction option has been removed to avoid mistakes.

Please contact the team if you need help correcting a submitted claim form.`
    );
  }



  if (['hi', 'hello', 'hey', 'start', 'menu', '/start', '/menu'].includes(normalized)) return mainMenu(from);

  if (input.startsWith('back_')) return handleBackNavigation(from, input);

  if (input === 'claim_upload_photo') return startClaimExtraPhotoUpload(from);


  // PHASE_1A_ACTIVE_FLOW_GUARD
  // If the customer is already inside a claim/booking/quote/upload flow,
  // never send normal answers to background AI. Save them into the flow.
  const activeSessionBeforeAi = getSession(from);

  if (isActiveBusinessFlowState(activeSessionBeforeAi.state)) {
    if (activeSessionBeforeAi.state === 'claim_signature_pending') {
      return handleClaimSignaturePending(from, input);
    }

    if (activeSessionBeforeAi.state.startsWith('claim_field_')) {
      return vpQueueClaimAction(
        from,
        () => handleClaim(from, input, inbound)
      );
    }

    if (activeSessionBeforeAi.state.startsWith('claim_upload_')) {
      return vpQueueClaimAction(
        from,
        () => handleClaimUpload(from, input, inbound)
      );
    }

    // VP_ALL_CONFIRMED_MEDIA_ROUTES_BEFORE_PRESENTATION_GUARD_V1
    if (activeSessionBeforeAi.state === 'claim_extra_photo_upload') {
      return handleClaimExtraPhotoUpload(from, input, inbound);
    }

    if (
      activeSessionBeforeAi.state === 'book_media' ||
      activeSessionBeforeAi.state === 'book_id_upload'
    ) {
      return handleBooking(from, input, inbound);
    }

    if (activeSessionBeforeAi.state === 'quote_media') {
      return handleQuote(from, input, inbound);
    }

    // VP_PRESENTATION_AI_GUARD_V1
    const vpPresentationState = String(activeSessionBeforeAi?.state || '');
    const vpPresentationType = String(
      (
        typeof type !== 'undefined'
          ? type
          : (
              typeof inbound !== 'undefined' && inbound
                ? inbound.type
                : ''
            )
      ) || ''
    ).toLowerCase();
    const vpPresentationInput = String(input || '').trim();

    if (
      /^(claim_|book_|quote_)/i.test(vpPresentationState) &&
      ['image', 'document', 'video', 'audio', 'sticker'].includes(vpPresentationType) &&
      !vpPresentationInput
    ) {
      console.log('PRESENTATION_MEDIA_NO_AI_FALLBACK', `***${String(from).replace(/\D/g, '').slice(-4)}`, vpPresentationState, vpPresentationType);
      return;
    }

    if (
      /^(claim_|book_|quote_)/i.test(vpPresentationState) &&
      (/\.pdf$/i.test(vpPresentationInput) || /^https?:\/\//i.test(vpPresentationInput))
    ) {
      console.log('PRESENTATION_LINK_OR_PDF_TAP_NO_AI_FALLBACK', `***${String(from).replace(/\D/g, '').slice(-4)}`);
      return sendText(from, 'The file has already been sent for review. Please use the buttons shown above, or type MENU to restart.');
    }

    if (
      /^(claim_confirm|claim_review|claim_upload|claim_)/i.test(vpPresentationState) &&
      !/^(menu|back|confirm|correct|yes|no|talk|team|help)$/i.test(vpPresentationInput) &&
      vpPresentationInput.length <= 6
    ) {
      console.log('PRESENTATION_SHORT_RANDOM_INPUT_NO_AI_FALLBACK', `***${String(from).replace(/\D/g, '').slice(-4)}`, { length: String(vpPresentationInput || '').length });
      return sendText(from, 'Please use the buttons shown above, or type MENU to restart.');
    }

    // claim_extra_photo_upload is routed before the presentation guard.
    if (activeSessionBeforeAi.state === 'claim_change_select_field' || activeSessionBeforeAi.state === 'claim_change_enter_value') return handleClaimCorrection(from, input);
    if (activeSessionBeforeAi.state === 'claim_change_notes') return handleClaimCorrection(from, input);
    if (activeSessionBeforeAi.state.startsWith('book_')) return handleBooking(from, input, inbound);
    if (activeSessionBeforeAi.state.startsWith('quote_')) return handleQuote(from, input, inbound);
    if (activeSessionBeforeAi.state === 'track_waiting') return handleTrack(from, input);
    if (activeSessionBeforeAi.state === 'handoff_notes') {
      await alertAdmin(`💬 CUSTOMER HANDOFF NOTE\n\nPhone: ${from}\n\nMessage:\n${input}`);
      resetSession(from);
      return sendText(from, 'Thank you, I have passed your message to the team.');
    }
  }

  const currentSession = getSession(from);

  if (!isKnownBotAction(input)) {
    if (detectHumanHandoffIntent(input)) {
      return teamHandoff(from, input);
    }

    if (currentSession.state === 'idle') {
      const numericIntent = detectNumericMenuChoice(input);
      if (numericIntent) {
        const routed = await routeSimpleIntent(from, numericIntent);
        if (routed) return;
      }

      const simpleIntent = detectSimpleIntent(input);
      if (simpleIntent) {
        const routed = await routeSimpleIntent(from, simpleIntent);
        if (routed) return;
      }

      return vpShowFlowRecovery(from, input, 'off_script_input');
    }

    const guidanceStates = [
      'claim_choose_insurer',
      'book_service',
      'quote_service',
      'book_type',
      'quote_type',
      'book_date'
    ];

    if (guidanceStates.includes(currentSession.state) || looksConfused(input)) {
      return vpShowFlowRecovery(from, input, 'off_script_input');
    }
  }

  if (input === 'menu_book') return serviceList(from, 'book');
  if (input === 'menu_quote') return serviceList(from, 'quote');

  if (input === 'menu_claim') return claimFormWarning(from);

  if (input.startsWith('claim_') && input !== 'claim_not_sure' && !input.startsWith('claim_confirm_') && !input.startsWith('claim_change_')) {
    const insurerMap = {
      claim_old_mutual: 'Old Mutual',
      claim_zimnat: 'Zimnat',
      claim_moovah: 'Moovah',
      claim_evolution: 'Evolution',
      claim_cell: 'Cell',
      claim_alliance: 'Alliance Insurance'
    };
    return startClaim(from, insurerMap[input] || 'Other Insurer');
  }

  if (input === 'claim_not_sure') {
    await alertAdmin(` Customer needs claim form help.\n\nPhone: ${from}\nChoice: Not Sure`);
    return sendText(from, 'A team member will assist with the correct claim form.');
  }

  if (input.startsWith('claim_confirm_')) {
    const claimNo = input.replace('claim_confirm_', '').toUpperCase();
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, 'Claim not found. Please reply MENU.');

    const data = safeJsonParse(claim.data, {});
    data.customerConfirmation = 'confirmed_correct';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('claim_confirmed_by_customer', JSON.stringify(data), now(), claimNo);

    await alertAdmin(`CUSTOMER CONFIRMED CLAIM PDF\n\nClaim: ${claimNo}\nCustomer: ${from}\nStatus: Ready for team processing.`);
    resetSession(from);

    return sendText(from, `Thank you. Your claim form has been confirmed.\n\nClaim Reference: ${claimNo}\n\nThe team will continue processing it.`);
  }

  if (input.startsWith('claim_change_')) {
    const claimNo = input.replace('claim_change_', '').toUpperCase();
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return sendText(from, 'Claim not found. Please reply MENU.');

    setSession(from, 'claim_change_notes', { claimNo });
    return sendText(from, `Please type the correction needed for ${claimNo}.\n\nExample: Policy number is wrong, it should be ABC123.`);
  }

  if (input === 'menu_track') {
    setSession(from, 'track_waiting', {});
    return sendText(from, 'Please type your job card or claim number.\n\nExamples:\nJC-0001\nCL-0012');
  }

  if (input === 'menu_services') return servicesMessage(from);
  if (input === 'menu_team') return teamHandoff(from);

  if (input.startsWith('quote_approve_')) {
    const jobNo = input.replace('quote_approve_', '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);

    if (job) {
      db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run('approved', now(), jobNo);
      let stockCommit = null;
      try {
        stockCommit = vpCommitQuotedStock(jobNo);
      } catch (error) {
        stockCommit = { ok: false, committed: false, reason: error.message };
      }
      const stockAlert = stockCommit && stockCommit.ok === false ? `\n\n⚠️ STOCK ATTENTION: ${stockCommit.reason}` : '';
      await alertAdmin(`QUOTE APPROVED\n\nJob Card: ${jobNo}\nCustomer: ${from}${stockAlert}\n\nPlease assign a fitter.`);
      resetSession(from);
      return sendText(from, `Thank you. Your quote for ${jobNo} has been approved.\n\nOur team will now assign a fitter.`);
    }

    return sendText(from, 'Sorry, we could not find that quote. Please reply MENU.');
  }

  if (input.startsWith('quote_question_')) {
    const jobNo = input.replace('quote_question_', '').toUpperCase();
    await alertAdmin(`❓ CUSTOMER HAS QUESTION ABOUT QUOTE\n\nJob Card: ${jobNo}\nCustomer: ${from}`);
    resetSession(from);
    return sendText(from, 'Thank you. A team member has been notified and will assist you with the quote.');
  }

  if (input.startsWith('quote_decline_')) {
    const jobNo = input.replace('quote_decline_', '').toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);

    if (job) {
      db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run('quote_declined', now(), jobNo);
      await alertAdmin(`❌ QUOTE DECLINED\n\nJob Card: ${jobNo}\nCustomer: ${from}`);
      resetSession(from);
      return sendText(from, `Noted. Your quote for ${jobNo} has been marked as declined.\n\nReply MENU anytime if you need more help.`);
    }

    return sendText(from, 'Sorry, we could not find that quote. Please reply MENU.');
  }

  if (input === 'complete_all_good') {
    resetSession(from);
    return sendText(from, 'Thank you for confirming We appreciate your business.');
  }

  if (input === 'complete_need_help') return teamHandoff(from);

  if (input === 'complete_invoice') {
    await alertAdmin(` Customer requested invoice.\n\nPhone: ${from}`);
    resetSession(from);
    return sendText(from, 'The team has been notified to send your invoice.');
  }


  
  // LEGACY_NEEDS_CHANGES_DISABLED
  if (input.startsWith('claim_change_')) {
    await alertAdmin(`📝 CUSTOMER REQUESTED CLAIM CHANGE FROM OLD BUTTON

Phone: ${from}
Button: ${input}

Needs Changes button has now been removed. Please assist manually if required.`);
    return sendText(from,
`This correction option has been removed to avoid mistakes.

Please contact the team if you need help correcting a submitted claim form.`
    );
  }


  const s = getSession(from);

  if (s.state === 'handoff_notes') {
    await alertAdmin(
`💬 CUSTOMER HANDOFF NOTE

Phone: ${from}

Message:
${input}`
    );

    resetSession(from);

    return sendText(from,
`Thank you, I have passed your message to the team.

They will assist you as soon as possible.`
    );
  }

  if (s.state.startsWith('book_')) return handleBooking(from, input, inbound);
  if (s.state.startsWith('quote_')) return handleQuote(from, input, inbound);
  if (s.state === 'claim_signature_pending') return handleClaimSignaturePending(from, input);
  if (s.state.startsWith('claim_field_')) {
    return vpQueueClaimAction(
      from,
      () => handleClaim(from, input, inbound)
    );
  }

  if (s.state.startsWith('claim_upload_')) {
    return vpQueueClaimAction(
      from,
      () => handleClaimUpload(from, input, inbound)
    );
  }

  if (s.state === 'claim_change_notes') {
    const claimNo = s.data?.claimNo;
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (claim) {
      const data = safeJsonParse(claim.data, {});
      data.customerConfirmation = 'changes_requested';
      data.changeNotes = input;

      db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
        .run('claim_changes_requested', JSON.stringify(data), now(), claimNo);

      await alertAdmin(`⚠️ CUSTOMER REQUESTED CLAIM PDF CHANGES\n\nClaim: ${claimNo}\nCustomer: ${from}\n\nChange requested:\n${input}`);
    }

    resetSession(from);
    return sendText(from, 'Thank you. The team has received your correction request and will assist.');
  }

  if (s.state === 'track_waiting') return handleTrack(from, input);

  return mainMenu(from);
}


app.post('/api/demo-verify-documents', async (req, res) => {
  const expected = String(DOCUMENT_VERIFY_API_KEY || '').trim();
  const auth = String(req.headers.authorization || '');
  const received = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!expected || !received || !vpSafeTextEqual(received, expected)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized.' });
  }

  const claimNo = req.body?.claimNo || 'UNKNOWN';
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

  const hasEnoughDocs = attachments.length >= 2;

  res.json({
    status: hasEnoughDocs ? 'approved' : 'pending',
    score: hasEnoughDocs ? 0.92 : 0.45,
    summary: hasEnoughDocs
      ? ` verification passed for ${claimNo}. ID and driver's licence were received.`
      : ` verification needs review for ${claimNo}. Not enough documents were received.`,
    provider: 'Vision Pixels  Verification API'
  });
});


app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'auto-glass-workshop-bot',
    business: BUSINESS_NAME,
    baseUrl: BASE_URL || null,
    ycloudConfigured: Boolean(API_KEY && SENDER),
    adminConfigured: Boolean(ADMIN),
    verifyApiConfigured: Boolean(DOCUMENT_VERIFY_API_URL),
    deepseekConfigured: Boolean(DEEPSEEK_API_KEY),
    deepseekModel: DEEPSEEK_MODEL,
    pdfDir: PDF_DIR,
    time: now()
  });
});





// ==============================
// PHASE_9B_FORCE_FIRST_MESSAGE_TO_MENU
// Any first WhatsApp message must start the official flow/menu.
// This prevents natural text like "I need a windscreen..." from jumping to Services.
// ==============================
function vp9bWalk(obj, cb, seen = new Set()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);

  for (const [k, v] of Object.entries(obj)) {
    cb(obj, k, v);
    if (v && typeof v === 'object') vp9bWalk(v, cb, seen);
  }
}

function vp9bFindText(obj) {
  let found = '';

  vp9bWalk(obj, (parent, key, value) => {
    if (found) return;
    const k = String(key || '').toLowerCase();

    if (
      typeof value === 'string' &&
      value.trim().length >= 1 &&
      value.trim().length <= 1200 &&
      ['body', 'message', 'caption'].includes(k)
    ) {
      found = value.trim();
    }
  });

  return found;
}

function vp9bFindPhone(obj) {
  let found = '';

  vp9bWalk(obj, (parent, key, value) => {
    if (found) return;

    const k = String(key || '').toLowerCase();

    if (
      typeof value === 'string' &&
      /(\+?\d{10,15})/.test(value) &&
      ['from', 'phone', 'waid', 'wa_id', 'sender', 'customer_phone'].some(x => k.includes(x))
    ) {
      const cleaned = value.replace(/[^\d+]/g, '');
      found = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
    }
  });

  return found;
}

function vp9bReplaceText(obj, newText) {
  vp9bWalk(obj, (parent, key, value) => {
    const k = String(key || '').toLowerCase();

    if (
      typeof value === 'string' &&
      value.trim().length >= 1 &&
      value.trim().length <= 1200 &&
      ['body', 'message', 'caption'].includes(k)
    ) {
      parent[key] = newText;
    }
  });
}

function vp9bLooksLikeFlowInput(text) {
  const t = String(text || '').trim().toLowerCase();

  if (!t) return false;

  // Do not interrupt exact menu commands/buttons.
  if (['menu', 'open menu', 'start', 'hi', 'hello', 'hey'].includes(t)) return false;

  // If the user is already filling structured details, allow it through.
  if (/name\s*:|vehicle\s*:|registration\s*:|location\s*:|phone\s*:/.test(t)) return true;

  // If they reply with simple option numbers/buttons, allow it through after first start.
  if (/^[0-9]{1,2}$/.test(t)) return true;

  return false;
}


// VP_YCLOUD_WEBHOOK_SECURITY_V1
// Verify every YCloud event before any webhook middleware can mutate state,
// route foreign business traffic early, and durably suppress provider retries.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ycloud_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      processing_started_at TEXT,
      processed_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ycloud_webhook_events_received_at
      ON ycloud_webhook_events(received_at);
  `);
  tryAlter(`ALTER TABLE ycloud_webhook_events ADD COLUMN status TEXT NOT NULL DEFAULT 'processing';`);
  tryAlter(`ALTER TABLE ycloud_webhook_events ADD COLUMN processing_started_at TEXT;`);
  tryAlter(`ALTER TABLE ycloud_webhook_events ADD COLUMN processed_at TEXT;`);
  tryAlter(`ALTER TABLE ycloud_webhook_events ADD COLUMN last_error TEXT;`);
  db.prepare(`
    UPDATE ycloud_webhook_events
    SET status='processed', processed_at=COALESCE(processed_at, received_at)
    WHERE (processing_started_at IS NULL OR processing_started_at='')
      AND (status IS NULL OR status='processing')
  `).run();
  db.prepare(`DELETE FROM ycloud_webhook_events WHERE received_at < ?`)
    .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
} catch (e) {
  console.error('YCLOUD_WEBHOOK_EVENT_TABLE_INIT_ERROR:', e.message);
}

function vpYcloudEventMarkProcessed(req) {
  const eventId = String(req?.vpYcloudEventId || req?.body?.id || '').trim();
  if (!eventId) return;
  db.prepare(`
    UPDATE ycloud_webhook_events
    SET status='processed', processed_at=?, last_error=NULL
    WHERE event_id=?
  `).run(new Date().toISOString(), eventId);
}

function vpYcloudEventMarkFailed(req, error) {
  const eventId = String(req?.vpYcloudEventId || req?.body?.id || '').trim();
  if (!eventId) return;
  try {
    db.prepare(`
      UPDATE ycloud_webhook_events
      SET status='failed', last_error=?
      WHERE event_id=?
    `).run(String(error?.message || error || 'webhook processing failed').slice(0, 1000), eventId);
  } catch (_) {}
}

function vpYcloudSignatureOk(req) {
  const secret = String(process.env.YCLOUD_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;

  const header = String(req.headers['ycloud-signature'] || '').trim();
  const raw = Buffer.isBuffer(req.vpRawWebhookBody)
    ? req.vpRawWebhookBody.toString('utf8')
    : '';
  if (!header || !raw) return false;

  const fields = header.split(',').map(part => part.trim()).filter(Boolean);
  const timestamp = fields.find(part => part.startsWith('t='))?.slice(2) || '';
  const signatures = fields.filter(part => part.startsWith('s=')).map(part => part.slice(2));
  if (!/^\d{9,13}$/.test(timestamp) || !signatures.length) return false;

  const ts = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  // YCloud retries for several hours. Keep a generous 24-hour replay window,
  // while rejecting timestamps implausibly far in the future.
  if (!Number.isFinite(ts) || ts > nowSeconds + 300 || nowSeconds - ts > 24 * 60 * 60) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${raw}`)
    .digest('hex');

  return signatures.some(signature => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const a = Buffer.from(signature.toLowerCase(), 'utf8');
    const b = Buffer.from(expected.toLowerCase(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

app.use(async (req, res, next) => {
  const routePath = String(req.path || req.url || '').split('?')[0].toLowerCase();
  if (req.method !== 'POST' || routePath !== '/webhook') return next();

  if (!vpYcloudSignatureOk(req)) {
    console.error('YCLOUD_WEBHOOK_SIGNATURE_REJECTED', {
      eventType: String(req.body?.type || ''),
      hasSignature: Boolean(req.headers['ycloud-signature']),
      time: new Date().toISOString()
    });
    return res.status(401).json({ ok: false, error: 'invalid_webhook_signature' });
  }

  req.vpYcloudEarlySecurityDone = true;

  try {
    const eventId = String(req.body?.id || '').trim();
    const eventType = String(req.body?.type || '').trim();
    if (eventId) {
      req.vpYcloudEventId = eventId;
      const nowIso = new Date().toISOString();
      const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const acquire = db.transaction(() => {
        const existing = db.prepare(`
          SELECT status, processing_started_at AS processingStartedAt
          FROM ycloud_webhook_events
          WHERE event_id=?
        `).get(eventId);

        if (!existing) {
          db.prepare(`
            INSERT INTO ycloud_webhook_events
            (event_id, event_type, received_at, status, processing_started_at, processed_at, last_error)
            VALUES (?, ?, ?, 'processing', ?, NULL, NULL)
          `).run(eventId, eventType, nowIso, nowIso);
          return 'acquired';
        }

        if (String(existing.status || '').toLowerCase() === 'processed') return 'processed';
        if (
          String(existing.status || '').toLowerCase() === 'processing' &&
          existing.processingStartedAt &&
          String(existing.processingStartedAt) >= staleBefore
        ) return 'busy';

        db.prepare(`
          UPDATE ycloud_webhook_events
          SET event_type=?, status='processing', processing_started_at=?, processed_at=NULL, last_error=NULL
          WHERE event_id=?
        `).run(eventType, nowIso, eventId);
        return 'acquired';
      })();

      if (acquire === 'processed') {
        console.log('YCLOUD_WEBHOOK_DUPLICATE_SKIPPED', eventId, eventType);
        return res.status(200).json({ ok: true, duplicate: true });
      }
      if (acquire === 'busy') {
        res.set('Retry-After', '15');
        return res.status(503).json({ ok: false, retry: true, error: 'webhook_event_in_progress' });
      }
    }
  } catch (e) {
    console.error('YCLOUD_WEBHOOK_IDEMPOTENCY_ERROR:', e.message);
    return res.status(503).json({ ok: false, error: 'webhook_idempotency_unavailable' });
  }

  try {
    if (String(req.body?.type || '').toLowerCase() === 'whatsapp.inbound_message.received') {
      const inbound = req.body?.whatsappInboundMessage || req.body?.data?.whatsappInboundMessage;
      const target = String(SENDER || '').replace(/\D/g, '');
      const inboundTo = String(inbound?.to || '').replace(/\D/g, '');

      if (target && inboundTo && inboundTo !== target) {
        if (inboundTo === '18484040585') {
          try {
            const routed = await fetch('http://127.0.0.1:4121/webhooks/hardercast-construction', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(req.body)
            });
            const routedBody = await routed.text();
            console.log('HARDERCAST_YCLOUD_EVENT_ROUTED_EARLY', inboundTo, routed.status);
            if (routed.ok) vpYcloudEventMarkProcessed(req);
            else vpYcloudEventMarkFailed(req, `Hardercast relay HTTP ${routed.status}`);
            return res.status(routed.ok ? 200 : 502).type('application/json').send(routedBody || '{"ok":true}');
          } catch (routeError) {
            vpYcloudEventMarkFailed(req, routeError);
            console.error('HARDERCAST_YCLOUD_ROUTE_ERROR:', routeError.message);
            return res.status(502).json({ ok: false, error: 'hardercast_route_unavailable' });
          }
        }

        console.log('YCLOUD_FOREIGN_BUSINESS_EVENT_IGNORED', inboundTo);
        vpYcloudEventMarkProcessed(req);
        return res.status(200).json({ ok: true, ignored: true });
      }
    }
  } catch (e) {
    vpYcloudEventMarkFailed(req, e);
    console.error('YCLOUD_BUSINESS_NUMBER_GUARD_ERROR:', e.message);
    return res.status(500).json({ ok: false, error: 'business_number_guard_failed' });
  }

  return next();
});

// VP_EXTERNAL_JOB_CARDS_WHATSAPP_CAPTURE_V1
// Capture complete workshop job-card messages sent by authorised staff.
// Customer conversations and normal bot flows remain unchanged.

function vpExternalAuthorisedSender(phone) {
  const configured = String(
    process.env.EXTERNAL_JOB_CARD_ALLOWED_NUMBERS || ''
  )
    .split(',')
    .map(value => normPhone(value.trim()))
    .filter(Boolean);

  const normalised = normPhone(phone);

  if (
    isAdmin(normalised) ||
    configured.includes(normalised)
  ) {
    return true;
  }

  // Active dashboard Team members are also trusted workshop staff.
  // This keeps staff access manageable without opening capture to customers.
  try {
    const rows = db.prepare(
      "SELECT phone FROM studio_fitters WHERE active=1 AND phone IS NOT NULL AND TRIM(phone)<>''"
    ).all();

    return rows.some(
      row =>
        normPhone(row.phone) === normalised
    );
  } catch {
    return false;
  }
}

function vpExternalInboundText(inbound) {
  if (!inbound || typeof inbound !== 'object') {
    return '';
  }

  if (typeof inbound.text === 'string') {
    return inbound.text.trim();
  }

  return String(
    inbound?.text?.body ||
    inbound?.text?.message ||
    inbound?.messageBody ||
    inbound?.body ||
    inbound?.caption ||
    ''
  ).trim();
}

function vpExternalLooksLikeJobCard(text) {
  const value = String(text || '');

  const hasJobCardHeading =
    /(?:WINDSCREEN|WORKSHOP|AUTO\s*GLASS)?\s*JOB\s*CARD/i
      .test(value);

  const hasCustomerSection =
    /CUSTOMER\s*INFO/i.test(value);

  const hasVehicleSection =
    /VEHICLE\s*INFO/i.test(value);

  const hasCoreFields =
    /(?:Name|Customer\s*Name)\s*:/i.test(value) &&
    /(?:Phone|Cell|Mobile)\s*:/i.test(value) &&
    /(?:Car\s*Model|Vehicle)\s*:/i.test(value);

  return (
    hasJobCardHeading &&
    hasCustomerSection &&
    hasVehicleSection &&
    hasCoreFields
  );
}

app.use(async (req, res, next) => {
  try {
    if (req.method !== 'POST') {
      return next();
    }

    const routePath = String(
      req.path || req.url || ''
    ).toLowerCase();

    if (!routePath.includes('webhook')) {
      return next();
    }

    const eventType = String(
      req.body?.type || ''
    ).toLowerCase();

    const inbound =
      req.body?.whatsappInboundMessage ||
      req.body?.data?.whatsappInboundMessage;

    if (
      eventType !==
        'whatsapp.inbound_message.received' ||
      !inbound
    ) {
      return next();
    }

    const from = normPhone(
      inbound.from || ''
    );

    const messageType = String(
      inbound.type || 'text'
    ).toLowerCase();

    if (messageType !== 'text') {
      return next();
    }

    const rawText =
      vpExternalInboundText(inbound);

    if (!vpExternalLooksLikeJobCard(rawText)) {
      return next();
    }

    if (!vpExternalAuthorisedSender(from)) {
      console.warn(
        'EXTERNAL_JOB_CARD_WHATSAPP_REJECTED_UNAUTHORISED',
        {
          sourcePhone:
            '***' + String(from).replace(/\D/g, '').slice(-4),
          inputLength:
            rawText.length,
          time:
            new Date().toISOString()
        }
      );
      return next();
    }

    const testMode = String(
      req.headers[
        'x-vp-external-job-card-test'
      ] || ''
    ).toLowerCase();

    if (testMode === 'preview') {
      const remoteAddress = String(
        req.socket?.remoteAddress || ''
      );

      const localAddresses = new Set([
        '127.0.0.1',
        '::1',
        '::ffff:127.0.0.1'
      ]);

      if (!localAddresses.has(remoteAddress)) {
        return res.status(403).json({
          ok: false,
          error:
            'Preview mode is restricted to localhost.'
        });
      }

      const parsed =
        vpExternalParseJobCard(rawText);

      vpYcloudEventMarkProcessed(req);
      return res.json({
        ok: true,
        mode:
          'external_job_card_whatsapp_preview',
        authorisedSender: true,
        recognisedJobCard: true,
        databaseWrites: 0,
        outboundMessages: 0,
        parsed
      });
    }

    const result = vpExternalInsertJobCard({
      rawText,
      sourcePhone: from,
      sourceMessageId:
        inbound.wamid ||
        inbound.id ||
        req.body?.id ||
        ''
    });

    const record = result.record;

    console.log(
      'EXTERNAL_JOB_CARD_WHATSAPP_CAPTURED',
      {
        externalRef:
          record.externalRef,
        sourcePhone: `***${String(from).replace(/\D/g, '').slice(-4)}`,
        duplicate:
          result.duplicate,
        paymentType:
          record.paymentType,
        extractionScore:
          record.parsed?.extractionScore,
        time:
          new Date().toISOString()
      }
    );

    vpYcloudEventMarkProcessed(req);
    res.sendStatus(200);

    const acknowledgement = result.duplicate
      ? [
          'External job card already received.',
          '',
          `Reference: ${record.externalRef}`,
          'No duplicate record was created.'
        ].join('\n')
      : [
          'External job card received.',
          '',
          `Reference: ${record.externalRef}`,
          `Customer: ${record.parsed?.customerName || 'Review required'}`,
          `Vehicle: ${record.parsed?.vehicleDescription || record.parsed?.vehicle || 'Review required'}`,
          `Payment: ${record.paymentType || 'Review Required'}`,
          `Extraction: ${Number(record.parsed?.extractionScore || 0)}%`,
          '',
          'Status: Waiting for dashboard review.'
        ].join('\n');

    void sendText(
      from,
      acknowledgement
    ).catch(error => {
      console.error(
        'EXTERNAL_JOB_CARD_ACKNOWLEDGEMENT_ERROR:',
        error?.message || error
      );
    });

    return;
  } catch (error) {
    console.error(
      'EXTERNAL_JOB_CARD_WHATSAPP_CAPTURE_ERROR:',
      error
    );

    vpYcloudEventMarkFailed(req, error);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: 'external_job_card_processing_failed' });
    }

    return;
  }
});
// END_VP_EXTERNAL_JOB_CARDS_WHATSAPP_CAPTURE_V1

app.use((req, res, next) => {
  try {
    if (req.method !== 'POST') return next();

    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();

    const eventType9b = String(req.body?.type || '').toLowerCase();
    const inbound9b = req.body?.whatsappInboundMessage;

    // Only handle real inbound WhatsApp text messages from customers.
    // Do not touch status events, outbound messages, admin notifications, or button replies.
    if (eventType9b !== 'whatsapp.inbound_message.received' || !inbound9b) return next();
    if (String(inbound9b.type || '').toLowerCase() !== 'text') return next();

    const text = (inbound9b.text && (inbound9b.text.body || inbound9b.text.message)) || vp9bFindText(inbound9b);
    if (!text) return next();

    const phone = inbound9b.from || vp9bFindPhone(req.body) || 'unknown_phone';

    // Only force the official menu for a genuinely idle customer. Session state
    // lives in SQLite, so PM2 restarts must never destroy an in-progress flow.
    const persistedSession = getSession(phone);
    if (String(persistedSession?.state || 'idle') === 'idle') {
      const t = String(text || '').trim().toLowerCase();
      if (!['menu', 'open menu', 'start'].includes(t)) {
        console.log('IDLE_FIRST_MESSAGE_FORCED_TO_MENU', `***${String(phone).replace(/\D/g, '').slice(-4)}`);
        vp9bReplaceText(req.body, 'menu');
      }
    }
  } catch (e) {
    console.error('PHASE_9B_FORCE_FIRST_MESSAGE_ERROR:', e.message);
  }

  next();
});


// ==============================
// PHASE_9A_SMART_BOOKING_INTAKE
// If a WhatsApp user sends a natural booking request, save it to dashboard immediately.
// ==============================
function vp9aFindText(obj) {
  try {
    const seen = new Set();
    const stack = [obj];

    while (stack.length) {
      const x = stack.shift();
      if (!x || typeof x !== 'object') continue;
      if (seen.has(x)) continue;
      seen.add(x);

      for (const [k, v] of Object.entries(x)) {
        const key = String(k).toLowerCase();

        if (
          typeof v === 'string' &&
          v.trim().length >= 3 &&
          v.trim().length <= 1200 &&
          ['body', 'text', 'message', 'caption'].includes(key)
        ) {
          return v.trim();
        }

        if (v && typeof v === 'object') stack.push(v);
      }
    }
  } catch {}

  return '';
}

function vp9aFindPhone(obj) {
  try {
    const seen = new Set();
    const stack = [obj];

    while (stack.length) {
      const x = stack.shift();
      if (!x || typeof x !== 'object') continue;
      if (seen.has(x)) continue;
      seen.add(x);

      for (const [k, v] of Object.entries(x)) {
        const key = String(k).toLowerCase();

        if (
          typeof v === 'string' &&
          /263\d{9}|27\d{9,10}|\+\d{10,15}/.test(v) &&
          ['from', 'phone', 'waid', 'wa_id', 'customer_phone', 'sender', 'to'].some(t => key.includes(t))
        ) {
          const cleaned = v.replace(/[^\d+]/g, '');
          return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
        }

        if (v && typeof v === 'object') stack.push(v);
      }
    }
  } catch {}

  return '';
}

function vp9aDetectService(text) {
  const t = String(text || '').toLowerCase();

  if (/(windscreen|windshield).*(replace|replacement|new|fit)|replace.*(windscreen|windshield)/.test(t)) return '🪟 Windscreen Replacement';
  if (/(windscreen|windshield).*(repair|chip|crack)/.test(t)) return '🔧 Windscreen Repair';
  if (/(side|door).*(glass|window)/.test(t)) return '🚪 Side / Door Glass';
  if (/rear.*glass|back.*glass/.test(t)) return '🚙 Rear Glass';
  if (/ceramic.*tint|tint/.test(t)) return '🎨 Ceramic Tint';
  if (/anti.*smash|smash.*grab/.test(t)) return 'Anti-smash and Grab Film';
  if (/alarm/.test(t)) return 'Alarms';
  if (/aircon|air con|air conditioning/.test(t)) return '❄️ Aircon Service';
  if (/tracker|tracking/.test(t)) return 'Trackers';
  if (/car audio|radio|speaker|sound/.test(t)) return '🔊 Car Audio';

  return '';
}

function vp9aDetectLocation(text) {
  const t = String(text || '').toLowerCase();

  const known = ['Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Kwekwe', 'Masvingo', 'Chitungwiza', 'Norton', 'Ruwa'];
  for (const city of known) {
    if (t.includes(city.toLowerCase())) return city;
  }

  const m = text.match(/\b(?:in|from|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  return m ? m[1].trim() : 'To confirm';
}

function vp9aDetectVehicle(text) {
  const cleaned = String(text || '').replace(/[.,]/g, ' ');
  const makes = 'Toyota|Honda|Nissan|Mazda|Mercedes|Benz|Mercedes Benz|BMW|Audi|VW|Volkswagen|Ford|Isuzu|Mitsubishi|Hyundai|Kia|Subaru|Suzuki|Chevrolet|Peugeot|Renault|Range Rover|Land Rover';
  const rx = new RegExp(`\\b(${makes})\\s+([A-Za-z0-9\\-]+(?:\\s+[A-Za-z0-9\\-]+){0,3})(?:\\s+(20\\d{2}|19\\d{2}))?`, 'i');
  const m = cleaned.match(rx);

  if (!m) return 'Vehicle to confirm';

  return [m[1], m[2], m[3]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function vp9aNextJobNo() {
  return `JC-${String(Date.now()).slice(-9)}`;
}

function vp9aInsertSmartBooking({ phone, text }) {
  try {
    if (!db) return null;

    const service = vp9aDetectService(text);
    if (!service) return null;

    const intentText = String(text || '').toLowerCase();
    const looksLikeRequest = /(need|want|looking|quote|book|replace|repair|fit|install|claim|help)/.test(intentText);
    if (!looksLikeRequest) return null;

    const vehicle = vp9aDetectVehicle(text);
    const location = vp9aDetectLocation(text);
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);

    const existing = db.prepare(`
      SELECT job_no FROM jobs
      WHERE customer_phone=?
      AND service=?
      AND created_at >= datetime('now', '-20 minutes')
      ORDER BY id DESC
      LIMIT 1
    `).get(phone || 'unknown', service);

    if (existing?.job_no) return existing.job_no;

    const tableCols = db.prepare(`PRAGMA table_info(jobs)`).all().map(c => c.name);
    const payload = {
      job_no: vp9aNextJobNo(),
      customer_phone: phone || 'WhatsApp customer',
      customer_name: 'WhatsApp Customer',
      vehicle,
      reg_no: 'To confirm',
      service,
      job_type: 'booking',
      location,
      status: 'new',
      booking_date: today,
      data: JSON.stringify({
        source: 'whatsapp_smart_intake',
        originalText: text,
        needsName: true,
        needsRegistration: true
      }),
      created_at: nowIso,
      updated_at: nowIso
    };

    const keys = Object.keys(payload).filter(k => tableCols.includes(k));
    db.prepare(`
      INSERT INTO jobs (${keys.join(',')})
      VALUES (${keys.map(() => '?').join(',')})
    `).run(...keys.map(k => payload[k]));

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(payload.job_no, 'whatsapp_intake', `Smart WhatsApp booking captured: ${text}`, 'bot', nowIso);
    } catch {}

    console.log('SMART_BOOKING_CAPTURED', payload.job_no, `***${String(phone).replace(/\D/g, '').slice(-4)}`);
    return payload.job_no;
  } catch (e) {
    console.error('SMART_BOOKING_CAPTURE_ERROR:', e.message);
    return null;
  }
}

app.use((req, res, next) => {
  try {
    if (req.method !== 'POST') return next();

    const path = String(req.path || req.url || '').toLowerCase();
    if (!path.includes('webhook')) return next();

    const text = vp9aFindText(req.body);
    if (!text) return next();

    const phone = vp9aFindPhone(req.body);
    /* PHASE_9C_DISABLED_DUPLICATE_SMART_CAPTURE */ console.log('SMART_CAPTURE_DISABLED_SKIP');
  } catch (e) {
    console.error('SMART_INTAKE_MIDDLEWARE_ERROR:', e.message);
  }

  next();
});




// ==============================
// PHASE_9E_FINAL_MEDIA_DOCUMENTS
// Save WhatsApp image/document uploads and expose them in Documents.
// ==============================
const vp9eFs = require('fs');
const vp9ePath = require('path');
const vp9eCrypto = require('crypto');

try {
  vp9eFs.mkdirSync(vp9ePath.join(__dirname, 'public', 'uploads', 'whatsapp'), { recursive: true });
  
// VP_TEST_MEDIA_STATIC_V3
// Test fixtures are never public unless explicitly enabled for a controlled local QA session.
try {
  if (String(process.env.ENABLE_TEST_MEDIA || '').trim().toLowerCase() === 'true') {
    app.use('/test-media', express.static('/opt/auto-glass-bot/test-media'));
  }
} catch (e) {
  console.error('TEST_MEDIA_STATIC_ERROR:', e.message);
}

app.use('/uploads', express.static(vp9ePath.join(__dirname, 'public', 'uploads')));

  db.prepare(`
    CREATE TABLE IF NOT EXISTS studio_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      type TEXT,
      filename TEXT,
      mime_type TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT
    )
  `).run();
} catch (e) {
  console.error('MEDIA_DOCUMENTS_INIT_ERROR:', e.message);
}

function vp9eMediaExt(mime, type) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('heic')) return '.heic';
  return String(type || '').toLowerCase() === 'document' ? '.bin' : '.jpg';
}

function vp9eLatestRef(phone) {
  try {
    const row = db.prepare(`
      SELECT job_no
      FROM jobs
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    return row && row.job_no ? row.job_no : '';
  } catch {
    return '';
  }
}

async function vp9eDownloadMedia(link, filepath) {
  const r = await fetch(link);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  vp9eFs.writeFileSync(filepath, buf);
}

app.get('/api/studio/v3/documents', studioGuard, (req, res) => {
  try {

    const rows = db.prepare(`
      SELECT
        id,
        ref,
        ref AS jobNo,
        ref AS claimNo,
        customer_phone AS customerPhone,
        customer_name AS customerName,
        type,
        filename,
        mime_type AS mimeType,
        url,
        source,
        created_at AS createdAt
      FROM studio_documents
      ORDER BY id DESC
      LIMIT 1000
    `).all();

    res.json({ ok: true, documents: rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use(async (req, res, next) => {
  // VP_AUDIT_DISABLE_LEGACY_MEDIA_CAPTURE_V1: VP12 owns production webhook media persistence.
  if (req.vpYcloudEarlySecurityDone) return next();
  try {
    if (req.method !== 'POST') return next();

    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();

    const eventType = String(req.body?.type || '').toLowerCase();
    const inbound = req.body?.whatsappInboundMessage;

    if (eventType !== 'whatsapp.inbound_message.received' || !inbound) return next();

    const msgType = String(inbound.type || '').toLowerCase();
    const media = inbound.image || inbound.document;

    if (!media || !media.link) return next();

    const phone = inbound.from || '';
    const ref = vp9eLatestRef(phone);
    const customerName = inbound.customerProfile?.name || 'WhatsApp Customer';
    const mime = media.mime_type || media.mimeType || '';
    const ext = vp9eMediaExt(mime, msgType);

    const file = `${ref || 'WA'}-${msgType}-${Date.now()}-${vp9eCrypto.randomBytes(4).toString('hex')}${ext}`;
    const folder = vp9ePath.join(__dirname, 'public', 'uploads', 'whatsapp');
    vp9eFs.mkdirSync(folder, { recursive: true });

    const filepath = vp9ePath.join(folder, file);
    const url = `/uploads/whatsapp/${file}`;

    await vp9eDownloadMedia(media.link, filepath);

    db.prepare(`
      INSERT INTO studio_documents
      (ref, customer_phone, customer_name, type, filename, mime_type, url, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ref, phone, customerName, msgType, file, mime, url, 'whatsapp', new Date().toISOString());

    if (ref) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(ref, 'media', `WhatsApp ${msgType} uploaded: ${file}`, 'bot', new Date().toISOString());
      } catch {}
    }

    console.log('OLD_WHATSAPP_MEDIA_SAVE_DISABLED', ref || '-', `***${String(phone).replace(/\D/g, '').slice(-4)}`);
  } catch (e) {
    console.error('MEDIA_DOCUMENTS_SAVE_ERROR:', e.message);
  }

  next();
});




// ==============================
// PHASE_9J_SAFE_BOOKING_MEDIA_DOCUMENTS
// Saves WhatsApp photos/docs and exposes them for booking detail panels.
// ==============================
const vp9jFs = require('fs');
const vp9jPath = require('path');
const vp9jCrypto = require('crypto');

try {
  vp9jFs.mkdirSync(vp9jPath.join(__dirname, 'public', 'uploads', 'whatsapp'), { recursive: true });
  app.use('/uploads', express.static(vp9jPath.join(__dirname, 'public', 'uploads')));

  db.prepare(`
    CREATE TABLE IF NOT EXISTS studio_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      type TEXT,
      filename TEXT,
      mime_type TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT
    )
  `).run();
} catch (e) {
  console.error('BOOKING_MEDIA_INIT_ERROR:', e.message);
}

function vp9jExt(mime, type) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('heic')) return '.heic';
  return String(type || '').toLowerCase() === 'document' ? '.bin' : '.jpg';
}

function vp9jLatestBookingRef(phone) {
  try {
    const row = db.prepare(`
      SELECT job_no
      FROM jobs
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);
    return row?.job_no || '';
  } catch {
    return '';
  }
}

async function vp9jDownload(link, filepath) {
  const r = await fetch(link);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  vp9jFs.writeFileSync(filepath, buf);
}



app.use(async (req, res, next) => {
  // VP_AUDIT_DISABLE_LEGACY_MEDIA_CAPTURE_V1: VP12 owns production webhook media persistence.
  if (req.vpYcloudEarlySecurityDone) return next();
  try {
    if (req.method !== 'POST') return next();

    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();

    const eventType = String(req.body?.type || '').toLowerCase();
    const inbound = req.body?.whatsappInboundMessage;

    if (eventType !== 'whatsapp.inbound_message.received' || !inbound) return next();

    const msgType = String(inbound.type || '').toLowerCase();
    const media = inbound.image || inbound.document;

    if (!media || !media.link) return next();

    const phone = inbound.from || '';
    const ref = vp9jLatestBookingRef(phone);
    const customerName = inbound.customerProfile?.name || 'WhatsApp Customer';
    const mime = media.mime_type || media.mimeType || '';
    const ext = vp9jExt(mime, msgType);
    const file = `${ref || 'WA'}-${msgType}-${Date.now()}-${vp9jCrypto.randomBytes(4).toString('hex')}${ext}`;

    const folder = vp9jPath.join(__dirname, 'public', 'uploads', 'whatsapp');
    vp9jFs.mkdirSync(folder, { recursive: true });

    const filepath = vp9jPath.join(folder, file);
    const url = `/uploads/whatsapp/${file}`;

    await vp9jDownload(media.link, filepath);

    db.prepare(`
      INSERT INTO studio_documents
      (ref, customer_phone, customer_name, type, filename, mime_type, url, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ref, phone, customerName, msgType, file, mime, url, 'whatsapp', new Date().toISOString());

    if (ref) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(ref, 'media', `WhatsApp ${msgType} uploaded: ${file}`, 'bot', new Date().toISOString());
      } catch {}
    }

    console.log('OLD_WHATSAPP_MEDIA_SAVE_DISABLED', ref || '-', phone, url);
  } catch (e) {
    console.error('BOOKING_MEDIA_SAVE_ERROR:', e.message);
  }

  next();
});




// ==============================
// PHASE_10A_BOOKINGS_REBUILD_BACKEND
// Clean backend support for rebuilt Bookings page:
// - Save uploaded WhatsApp photos/docs
// - List media for selected booking
// - Proceed booking to in-progress
// ==============================
const vp10aFs = require('fs');
const vp10aPath = require('path');
const vp10aCrypto = require('crypto');

function vp10aAdminOk(req) {
  return vpAdminAuthCheck(req).ok;
}

function vp10aTableExists(name) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  } catch {
    return false;
  }
}

function vp10aCols(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  } catch {
    return [];
  }
}

function vp10aPatchJob(jobNo, values) {
  const cols = vp10aCols('jobs');
  const keys = Object.keys(values).filter(k => cols.includes(k));
  if (!keys.length) return 0;

  const sql = `UPDATE jobs SET ${keys.map(k => `${k}=?`).join(', ')} WHERE job_no=?`;
  const result = db.prepare(sql).run(...keys.map(k => values[k]), jobNo);
  return result.changes || 0;
}

function vp10aLatestJobRef(phone) {
  try {
    const row = db.prepare(`
      SELECT job_no
      FROM jobs
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);
    return row?.job_no || '';
  } catch {
    return '';
  }
}

function vp10aExt(mime, type) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('heic')) return '.heic';
  return String(type || '').toLowerCase() === 'document' ? '.bin' : '.jpg';
}

async function vp10aDownload(link, filepath) {
  const r = await fetch(link);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  vp10aFs.writeFileSync(filepath, buf);
}

try {
  vp10aFs.mkdirSync(vp10aPath.join(__dirname, 'public', 'uploads', 'whatsapp'), { recursive: true });
  app.use('/uploads', express.static(vp10aPath.join(__dirname, 'public', 'uploads')));

  db.prepare(`
    CREATE TABLE IF NOT EXISTS studio_booking_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      type TEXT,
      filename TEXT,
      mime_type TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS studio_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      type TEXT,
      filename TEXT,
      mime_type TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT
    )
  `).run();
} catch (e) {
  console.error('PHASE_10A_BOOKINGS_BACKEND_INIT_ERROR:', e.message);
}

app.get('/api/studio/v3/booking-media', (req, res) => {
  try {
    if (!vp10aAdminOk(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const jobNo = String(req.query.jobNo || '').trim();
    const phone = String(req.query.phone || '').trim();

    const rows = [];

    if (vp10aTableExists('studio_booking_media')) {
      const sql = jobNo
        ? `
          SELECT
            id,
            ref,
            ref AS jobNo,
            customer_phone AS customerPhone,
            customer_name AS customerName,
            type,
            filename,
            mime_type AS mimeType,
            url,
            source,
            created_at AS createdAt
          FROM studio_booking_media
          WHERE ref = ?
          ORDER BY id DESC
          LIMIT 200
        `
        : `
          SELECT
            id,
            ref,
            ref AS jobNo,
            customer_phone AS customerPhone,
            customer_name AS customerName,
            type,
            filename,
            mime_type AS mimeType,
            url,
            source,
            created_at AS createdAt
          FROM studio_booking_media
          WHERE customer_phone = ?
          ORDER BY id DESC
          LIMIT 200
        `;
      rows.push(...db.prepare(sql).all(jobNo || phone));
    }

    if (vp10aTableExists('studio_documents')) {
      const sql = jobNo
        ? `
          SELECT
            id,
            ref,
            ref AS jobNo,
            customer_phone AS customerPhone,
            customer_name AS customerName,
            type,
            filename,
            mime_type AS mimeType,
            url,
            source,
            created_at AS createdAt
          FROM studio_documents
          WHERE ref = ?
          ORDER BY id DESC
          LIMIT 200
        `
        : `
          SELECT
            id,
            ref,
            ref AS jobNo,
            customer_phone AS customerPhone,
            customer_name AS customerName,
            type,
            filename,
            mime_type AS mimeType,
            url,
            source,
            created_at AS createdAt
          FROM studio_documents
          WHERE customer_phone = ?
          ORDER BY id DESC
          LIMIT 200
        `;
      rows.push(...db.prepare(sql).all(jobNo || phone));
    }

    const seen = new Set();
    const media = rows.filter(row => {
      const key = `${row.url}|${row.filename}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ ok: true, media });
  } catch (e) {
    console.error('PHASE_10A_BOOKING_MEDIA_API_ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/bookings/:jobNo/proceed', express.json(), (req, res) => {
  try {
    if (!vp10aAdminOk(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const jobNo = req.params.jobNo;
    const now = new Date().toISOString();

    const changes = vp10aPatchJob(jobNo, {
      status: 'in_progress',
      public_status: 'In Progress',
      job_type: 'job',
      updated_at: now
    });

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(jobNo, 'workflow', 'Booking proceeded to job / in progress.', 'dashboard', now);
    } catch {}

    res.json({ ok: true, jobNo, status: 'in_progress', changes });
  } catch (e) {
    console.error('PHASE_10A_BOOKING_PROCEED_ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use(async (req, res, next) => {
  // VP_AUDIT_DISABLE_LEGACY_MEDIA_CAPTURE_V1: VP12 owns production webhook media persistence.
  if (req.vpYcloudEarlySecurityDone) return next();
  try {
    if (req.method !== 'POST') return next();

    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();

    const eventType = String(req.body?.type || '').toLowerCase();
    const inbound = req.body?.whatsappInboundMessage;

    if (eventType !== 'whatsapp.inbound_message.received' || !inbound) return next();

    const msgType = String(inbound.type || '').toLowerCase();
    const media = inbound.image || inbound.document;

    if (!media || !media.link) return next();

    const phone = inbound.from || '';

    // VP_BOOK_QUOTE_MEDIA_OWNS_UPLOAD_V1
    const activeFlowState = String(
      getSession(phone)?.state || ''
    );

    if (
      activeFlowState === 'book_media' ||
      activeFlowState === 'book_id_upload' ||
      activeFlowState === 'quote_media' ||
      activeFlowState === 'claim_extra_photo_upload'
    ) {
      console.log(
        'OLD_BOOKING_MEDIA_FLOW_OWNED_SKIP',
        phone,
        activeFlowState
      );

      return next();
    }

    const ref = vp10aLatestJobRef(phone);
    const customerName = inbound.customerProfile?.name || 'WhatsApp Customer';
    const mime = media.mime_type || media.mimeType || '';
    const ext = vp10aExt(mime, msgType);
    const file = `${ref || 'WA'}-${msgType}-${Date.now()}-${vp10aCrypto.randomBytes(4).toString('hex')}${ext}`;

    const folder = vp10aPath.join(__dirname, 'public', 'uploads', 'whatsapp');
    vp10aFs.mkdirSync(folder, { recursive: true });

    const filepath = vp10aPath.join(folder, file);
    const url = `/uploads/whatsapp/${file}`;

    await vp10aDownload(media.link, filepath);

    db.prepare(`
      INSERT INTO studio_booking_media
      (ref, customer_phone, customer_name, type, filename, mime_type, url, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ref, phone, customerName, msgType, file, mime, url, 'whatsapp', new Date().toISOString());

    try {
      db.prepare(`
        INSERT INTO studio_documents
        (ref, customer_phone, customer_name, type, filename, mime_type, url, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ref, phone, customerName, msgType, file, mime, url, 'whatsapp', new Date().toISOString());
    } catch {}

    if (ref) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(ref, 'media', `WhatsApp ${msgType} uploaded: ${file}`, 'bot', new Date().toISOString());
      } catch {}
    }

    console.log('OLD_BOOKING_MEDIA_SAVE_DISABLED', ref || '-', `***${String(phone).replace(/\D/g, '').slice(-4)}`);
  } catch (e) {
    console.error('PHASE_10A_BOOKING_MEDIA_SAVE_ERROR:', e.message);
  }

  next();
});




// ==============================
// VP12_STRICT_LIVE_MEDIA_AND_DOCS
// Strict live dashboard data from WhatsApp + saved uploads.
// ==============================
const vp12Fs = require('fs');
const vp12Path = require('path');
const vp12Crypto = require('crypto');

try {
  vp12Fs.mkdirSync(vp12Path.join(__dirname, 'public', 'uploads', 'whatsapp'), { recursive: true });
  app.use('/uploads', express.static(vp12Path.join(__dirname, 'public', 'uploads')));

  db.prepare(`
    CREATE TABLE IF NOT EXISTS studio_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      type TEXT,
      filename TEXT,
      mime_type TEXT,
      url TEXT,
      source TEXT,
      created_at TEXT
    )
  `).run();
} catch (e) {
  console.error('VP12_DOC_INIT_ERROR:', e.message);
}

function vp12Docs() {
  try {
    return db.prepare(`
      SELECT
        id,
        ref,
        ref AS jobNo,
        ref AS claimNo,
        customer_phone AS customerPhone,
        customer_name AS customerName,
        type,
        filename,
        mime_type AS mimeType,
        url,
        source,
        created_at AS createdAt
      FROM studio_documents
      ORDER BY id DESC
      LIMIT 1000
    `).all();
  } catch (e) {
    console.error('VP12_DOCS_READ_ERROR:', e.message);
    return [];
  }
}

function vp12LatestJobRef(phone) {
  try {
    const claim = db.prepare(`
      SELECT claim_no AS ref
      FROM claims
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    if (claim?.ref) return claim.ref;
  } catch {}

  try {
    const claim2 = db.prepare(`
      SELECT claimNo AS ref
      FROM claims
      WHERE customerPhone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    if (claim2?.ref) return claim2.ref;
  } catch {}

  try {
    const row = db.prepare(`
      SELECT job_no AS ref
      FROM jobs
      WHERE customer_phone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    return row?.ref || '';
  } catch {}

  try {
    const row2 = db.prepare(`
      SELECT jobNo AS ref
      FROM jobs
      WHERE customerPhone=?
      ORDER BY id DESC
      LIMIT 1
    `).get(phone);

    return row2?.ref || '';
  } catch {}

  return '';
}

function vp12Ext(mime, type) {
  const m = String(mime || '').toLowerCase();

  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('heic')) return '.heic';

  return String(type || '').toLowerCase() === 'document' ? '.bin' : '.jpg';
}

async function vp12TryDownload(link, filepath) {
  try {
    const r = await fetch(link, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`download failed ${r.status}`);
    const maxBytes = 25 * 1024 * 1024;
    const declared = Number(r.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('media file exceeds 25 MB dashboard limit');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('media file exceeds 25 MB dashboard limit');
    vp12Fs.writeFileSync(filepath, buf);
    return true;
  } catch (e) {
    console.error('VP12_MEDIA_DOWNLOAD_ERROR:', e.message);
    try { if (vp12Fs.existsSync(filepath)) vp12Fs.unlinkSync(filepath); } catch (_) {}
    return false;
  }
}

// Add documents into studio state without touching the existing state route.
app.use((req, res, next) => {
  try {
    const routePath = String(req.path || req.url || '').toLowerCase();

    if (req.method !== 'GET' || !routePath.includes('/api/studio/v3/state')) {
      return next();
    }

    const oldJson = res.json.bind(res);

    res.json = (payload) => {
      try {
        if (
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          payload.ok !== false
        ) {
          payload.documents = vp12Docs();
          payload.strictLiveData = true;
          payload.demoMode = false;
        }
      } catch (e) {
        console.error('VP12_STATE_DOC_INJECT_ERROR:', e.message);
      }

      return oldJson(payload);
    };
  } catch {}

  next();
});

// Save WhatsApp image/document uploads from YCloud into dashboard documents.
app.use(async (req, res, next) => {
  try {
    if (req.method !== 'POST') return next();

    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();

    const eventType = String(req.body?.type || '').toLowerCase();
    const inbound = req.body?.whatsappInboundMessage;

    if (eventType !== 'whatsapp.inbound_message.received' || !inbound) return next();

    const msgType = String(inbound.type || '').toLowerCase();
    const media = inbound.image || inbound.document;

    if (!media) return next();

    const link = media.link || media.url || media.downloadUrl || '';
    if (!link) return next();

    const phone = inbound.from || '';

    // VP_STRICT_MEDIA_FLOW_OWNERSHIP_GUARD_V2
    // VP12 is the single local media persistence owner. Flow handlers still own
    // conversation state; this middleware only stores a durable dashboard copy.
    const activeSession = getSession(phone) || { state: 'idle', data: {} };
    const activeFlowState = String(activeSession.state || '');
    const activeData = activeSession.data || {};
    let ref = '';

    if (/^claim_/i.test(activeFlowState) && activeData.claimNoInternal) {
      ref = String(activeData.claimNoInternal);
    } else if (/^(book_|quote_)/i.test(activeFlowState)) {
      // A booking/job number may not exist yet. Stage the document and rebind it
      // atomically when createJob() creates the definitive reference.
      const token = vp12Crypto.createHash('sha256').update(String(phone)).digest('hex').slice(0, 12);
      ref = `PENDING:${token}`;
    } else {
      ref = vp12LatestJobRef(phone);
    }
    const customerName = inbound.customerProfile?.name || 'WhatsApp Customer';
    const mime = media.mime_type || media.mimeType || '';
    const ext = vp12Ext(mime, msgType);
    const safeRef = ref || 'WA';

    const filename = `${safeRef}-${msgType}-${Date.now()}-${vp12Crypto.randomBytes(4).toString('hex')}${ext}`;
    const folder = vp12Path.join(__dirname, 'public', 'uploads', 'whatsapp');
    const filepath = vp12Path.join(folder, filename);
    const localUrl = `/uploads/whatsapp/${filename}`;

    vp12Fs.mkdirSync(folder, { recursive: true });

    const downloaded = await vp12TryDownload(link, filepath);
    if (!downloaded) {
      console.error('VP12_MEDIA_NOT_PERSISTED', `***${String(phone).replace(/\D/g, '').slice(-4)}`, msgType);
      return next();
    }
    const finalUrl = localUrl;

    const existingDoc = db.prepare(`
      SELECT id
      FROM studio_documents
      WHERE customer_phone=? AND source='whatsapp' AND url=?
      LIMIT 1
    `).get(phone, finalUrl);

    if (!existingDoc) {
      db.prepare(`
        INSERT INTO studio_documents
        (ref, customer_phone, customer_name, type, filename, mime_type, url, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ref, phone, customerName, msgType, filename, mime, finalUrl, 'whatsapp', new Date().toISOString());
    } else {
      console.log('STRICT_LIVE_MEDIA_DUPLICATE_SKIPPED', `***${String(phone).replace(/\D/g, '').slice(-4)}`, path.basename(finalUrl));
    }

    vpFinalClaimImageIndex.builtAt = 0;

    if (ref && !String(ref).startsWith('PENDING:')) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(ref, 'media', `WhatsApp ${msgType} uploaded: ${filename}`, 'bot', new Date().toISOString());
      } catch {}
    }

    console.log('WHATSAPP_MEDIA_SAVED_STRICT_LIVE', ref || '-', `***${String(phone).replace(/\D/g, '').slice(-4)}`, path.basename(finalUrl));
  } catch (e) {
    console.error('VP12_MEDIA_SAVE_ERROR:', e.message);
  }

  next();
});




// VP_YCLOUD_BUSINESS_NUMBER_GUARD_V2
app.use(async (req, res, next) => {
  if (req.vpYcloudEarlySecurityDone) return next();
  try {
    if (req.method !== 'POST') return next();
    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();
    if (req.body?.type !== 'whatsapp.inbound_message.received') return next();

    const target = String(SENDER || '').replace(/\D/g, '');
    const inboundTo = String(
      req.body?.whatsappInboundMessage?.to ||
      req.body?.data?.whatsappInboundMessage?.to ||
      ''
    ).replace(/\D/g, '');

    if (target && inboundTo && inboundTo !== target) {
      if (inboundTo === '18484040585') {
        try {
          const routed = await fetch('http://127.0.0.1:4121/webhooks/hardercast-construction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
          });
          const routedBody = await routed.text();
          console.log('HARDERCAST_YCLOUD_EVENT_ROUTED', inboundTo, routed.status);
          res.status(routed.ok ? 200 : 502).type('application/json').send(routedBody || '{"ok":true}');
          return;
        } catch (routeError) {
          console.error('HARDERCAST_YCLOUD_ROUTE_ERROR:', routeError.message);
          return res.status(502).json({ ok: false, error: 'hardercast_route_unavailable' });
        }
      }
      console.log('FOREIGN_YCLOUD_BUSINESS_NUMBER_IGNORED', inboundTo);
      return res.status(200).json({ ok: true, ignored: 'foreign_business_number' });
    }
  } catch (e) {
    console.error('YCLOUD_BUSINESS_NUMBER_GUARD_ERROR:', e.message);
  }
  next();
});

// VP_PRESENTATION_WEBHOOK_DEDUPE_V1
const vpPresentationSeenInbound = new Map();

function vpPresentationDedupeKey(req) {
  try {
    const b = req.body || {};
    const inbound = b.whatsappInboundMessage || {};
    return inbound.wamid || inbound.id || b.id || '';
  } catch {
    return '';
  }
}

function vpPresentationCleanSeen() {
  const now = Date.now();
  for (const [key, ts] of vpPresentationSeenInbound.entries()) {
    if (now - ts > 10 * 60 * 1000) vpPresentationSeenInbound.delete(key);
  }
}

app.use((req, res, next) => {
  try {
    if (req.method !== 'POST') return next();

    const routePath = String(req.path || req.url || '').toLowerCase();
    if (!routePath.includes('webhook')) return next();

    const key = vpPresentationDedupeKey(req);
    if (!key) return next();

    vpPresentationCleanSeen();

    if (vpPresentationSeenInbound.has(key)) {
      console.log('PRESENTATION_DUPLICATE_WEBHOOK_SKIPPED', key);
      vpYcloudEventMarkProcessed(req);
      return res.status(200).json({ ok: true, duplicate: true });
    }

    vpPresentationSeenInbound.set(key, Date.now());
  } catch (e) {
    console.error('PRESENTATION_DEDUPE_ERROR:', e.message);
  }

  next();
});


app.post('/webhook', async (req, res) => {
  try {
    const eventType = req.body?.type || '';

    if (eventType === 'whatsapp.message.updated' || req.body?.whatsappMessage?.status) {
      const message = req.body?.whatsappMessage || {};
      const whatsappApiError = message.whatsappApiError || {};
      const errorData = whatsappApiError.error_data || {};

      const statusEvent = {
        eventId: req.body?.id || '',
        eventType,
        eventTime: req.body?.createTime || '',
        messageId: message.id || '',
        wamid: message.wamid || '',
        externalId: message.externalId || '',
        messageType: message.type || '',
        status: message.status || '',
        from: message.from ? `***${String(message.from).replace(/\D/g, '').slice(-4)}` : '',
        to: message.to ? `***${String(message.to).replace(/\D/g, '').slice(-4)}` : '',
        errorCode:
          message.errorCode ||
          whatsappApiError.code ||
          '',
        errorMessage:
          String(message.errorMessage || whatsappApiError.message || '').slice(0, 300),
        errorType:
          String(whatsappApiError.type || '').slice(0, 120),
        errorDetails:
          String(errorData.details || '').slice(0, 300),
        sendTime: message.sendTime || '',
        deliverTime: message.deliverTime || '',
        readTime: message.readTime || ''
      };

      console.log(
        'YCLOUD_STATUS_EVENT_V2:',
        JSON.stringify(statusEvent, null, 2)
      );

      if (String(message.status || '').toLowerCase() === 'failed') {
        console.error(
          'YCLOUD_DELIVERY_FAILED_V2:',
          JSON.stringify(statusEvent, null, 2)
        );
      }

      vpYcloudEventMarkProcessed(req);
      return res.sendStatus(200);
    }

    const inbound = extractInbound(req.body);
    await handleInbound(inbound);
    vpYcloudEventMarkProcessed(req);
    return res.sendStatus(200);
  } catch (err) {
    vpYcloudEventMarkFailed(req, err);
    console.error('WEBHOOK_ERROR:', err?.message || err);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: 'webhook_processing_failed' });
  }
});

app.get('/', (req, res) => {
  res.type('text').send('Auto Glass WhatsApp Bot is running. Use /health for status.');
});



// ==============================
// STUDIO_WEB_DASHBOARD_V1
// Premium VisionCo workshop dashboard
// ==============================
const STUDIO_DIR = path.join(__dirname, 'admin-web', 'dist');

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      type TEXT,
      note TEXT,
      actor TEXT,
      created_at TEXT
    );
  `);
} catch (e) {
  console.error('STUDIO_NOTES_TABLE_ERROR:', e.message);
}

function studioOk(req) {
  return vpAdminPinOk(req);
}

function studioGuard(req, res, next) {
  const auth = vpAdminAuthCheck(req);
  if (!auth.ok) {
    if (auth.limited) res.set('Retry-After', '900');
    return res.status(auth.limited ? 429 : 401).json({
      ok: false,
      error: auth.limited ? 'Too many invalid PIN attempts. Try again later.' : 'Invalid or missing admin PIN.'
    });
  }
  return next();
}

function studioOne(sql, fallback = {}) {
  try {
    return db.prepare(sql).get() || fallback;
  } catch (e) {
    return fallback;
  }
}

function studioAll(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (e) {
    console.error('STUDIO_SQL_ERROR:', e.message, sql);
    return [];
  }
}

function studioData(row) {
  return safeJsonParse(row?.data, {});
}

function studioPublicStatus(row) {
  const s1 = String(row?.status || '').toLowerCase();
  const s2 = String(row?.insurer_processing_status || '').toLowerCase();
  const s3 = String(row?.keithstops_status || '').toLowerCase();
  const s4 = String(row?.insurer_decision_status || '').toLowerCase();

  if (s4 === 'accepted' || s2 === 'accepted' || s1.includes('insurance_accepted')) return 'Accepted';
  if (s4 === 'declined' || s2 === 'declined' || s1.includes('insurance_declined')) return 'Declined';
  if (s2.includes('approved') || s1.includes('approved')) return 'Approved';
  if (s2.includes('rejected') || s1.includes('rejected')) return 'Needs Attention';
  if (String(row?.insurer_reply_status || '').trim().toLowerCase() === 'confirmed' || String(row?.insurer_processing_status || '').trim().toLowerCase() === 'replied') return 'Insurance Replied';
  if (s2 === 'email_submission_failed') return 'Needs Attention';
  if (s2.includes('review') || s1.includes('review')) return 'Under Review';
  if (s2.includes('submitted')) return 'Sent to Insurance';
  if (s2.includes('awaiting') || s3.includes('submitted') || s3.includes('already')) return 'Submitted for Processing';
  if (s1.includes('confirmed')) return 'Confirmed';
  if (s1.includes('pdf')) return 'Claim Form Generated';
  if (s1.includes('closed')) return 'Closed';
  if (s1.includes('paid')) return 'Paid';
  if (s1.includes('complete')) return 'Completed';
  if (s1.includes('progress')) return 'In Progress';
  if (s1.includes('quote_sent')) return 'Quotation Sent';
  if (s1.includes('quote')) return 'Quote Stage';
  return 'New';
}

function studioClaimView(c) {
  const d = studioData(c);
  return {
    id: c.id,
    claimNo: c.claim_no,
    jobNo: c.job_no || '',
    customerPhone: c.customer_phone || '',
    insurer: c.insurer || d.insurer || '',
    customerName: d.insuredName || d.customerName || d.name || '',
    vehicle: d.vehicleMakeModelYear || d.vehicle || d.vehicleDescription || '',
    registration: d.vehicleReg || d.reg || '',
    rawStatus: c.status || '',
    publicStatus: studioPublicStatus(c),
    insurerStatus: c.insurer_processing_status || '',
    posStatus: c.keithstops_status || '',
    posRef: c.keithstops_reference || '',
    pdfUrl: c.pdf_url || '',
    updatedAt: c.updated_at || '',
    createdAt: c.created_at || '',
    data: d
  };
}

function studioJobView(j) {
  const d = studioData(j);
  return {
    id: j.id,
    jobNo: j.job_no,
    customerPhone: j.customer_phone || '',
    customerName: j.customer_name || '',
    vehicle: j.vehicle || '',
    registration: j.reg_no || '',
    service: j.service || '',
    jobType: j.job_type || '',
    location: j.location || '',
    status: j.status || '',
    publicStatus: studioPublicStatus(j),
    fitter: j.fitter || '',
    updatedAt: j.updated_at || '',
    createdAt: j.created_at || '',
    data: d
  };
}

function studioAttachmentView(a) {
  return {
    id: a.id,
    phone: a.phone || '',
    jobNo: a.job_no || '',
    claimNo: a.claim_no || '',
    type: a.type || '',
    caption: a.caption || '',
    url: a.url || '',
    createdAt: a.created_at || ''
  };
}

app.get('/api/studio/health', studioGuard, (req, res) => {
  res.json({ ok: true, app: 'VisionCo Studio', time: now() });
});

app.get('/api/studio/state', studioGuard, (req, res) => {
  const claims = studioAll(`SELECT * FROM claims ORDER BY id DESC LIMIT 80`).map(studioClaimView);
  const jobs = studioAll(`SELECT * FROM jobs ORDER BY id DESC LIMIT 80`).map(studioJobView);
  const attachments = studioAll(`SELECT * FROM attachments ORDER BY id DESC LIMIT 120`).map(studioAttachmentView);
  const notes = studioAll(`SELECT * FROM studio_notes ORDER BY id DESC LIMIT 80`);

  const claimCount = studioOne(`SELECT COUNT(*) AS c FROM claims`, { c: 0 }).c || 0;
  const jobCount = studioOne(`SELECT COUNT(*) AS c FROM jobs`, { c: 0 }).c || 0;
  const documentCount = studioOne(`SELECT COUNT(*) AS c FROM attachments`, { c: 0 }).c || 0;

  const pendingClaims = claims.filter(c =>
    ['new', 'confirmed', 'claim form generated', 'submitted for processing', 'under review'].includes(String(c.publicStatus || '').toLowerCase())
  ).length;

  const approvedClaims = claims.filter(c => String(c.publicStatus || '').toLowerCase() === 'approved').length;
  const jobsInProgress = jobs.filter(j => String(j.publicStatus || '').toLowerCase().includes('progress')).length;

  const customers = {};
  [...claims, ...jobs].forEach(x => {
    const phone = x.customerPhone;
    if (!phone) return;
    customers[phone] = customers[phone] || {
      phone,
      name: x.customerName || '',
      vehicle: x.vehicle || '',
      lastSeen: x.updatedAt || x.createdAt || ''
    };
  });

  const activity = [
    ...claims.slice(0, 20).map(c => ({
      type: 'Claim',
      ref: c.claimNo,
      title: `${c.insurer || 'Insurance'} claim`,
      subtitle: `${c.customerName || c.customerPhone || '-'} • ${c.publicStatus}`,
      time: c.updatedAt || c.createdAt || ''
    })),
    ...jobs.slice(0, 20).map(j => ({
      type: 'Job',
      ref: j.jobNo,
      title: j.service || 'Workshop job',
      subtitle: `${j.customerName || j.customerPhone || '-'} • ${j.publicStatus}`,
      time: j.updatedAt || j.createdAt || ''
    })),
    ...attachments.slice(0, 20).map(a => ({
      type: 'Document',
      ref: a.claimNo || a.jobNo || '-',
      title: a.type || 'Attachment',
      subtitle: a.caption || a.phone || '',
      time: a.createdAt || ''
    }))
  ].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 30);

  const quotes = jobs.filter(j =>
    String(j.jobType || '').toLowerCase().includes('quote') ||
    String(j.status || '').toLowerCase().includes('quote')
  );

  res.json({
    ok: true,
    summary: {
      claimCount,
      jobCount,
      documentCount,
      customerCount: Object.keys(customers).length,
      pendingClaims,
      approvedClaims,
      jobsInProgress,
      quoteCount: quotes.length
    },
    claims,
    jobs,
    quotes,
    documents: attachments,
    customers: Object.values(customers),
    notes,
    activity,
    config: {
      business: BUSINESS_NAME,
      baseUrl: BASE_URL,
      posConnected: Boolean(process.env.KEITHSTOPS_API_KEY),
      whatsappConfigured: Boolean(API_KEY && SENDER),
      shopName: process.env.KTPOS_SHOP_NAME || '',
      terminalName: process.env.KTPOS_TARGET_TERMINAL_NAME || ''
    }
  });
});

app.post('/api/studio/claims/:claimNo/status', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').toUpperCase();
    const { status, note = '', notify = true } = req.body || {};

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) return res.status(404).json({ ok: false, error: 'Claim not found.' });

    const clean = String(status || '').toLowerCase();
    const map = {
      sent: ['submitted', 'insurance_submitted'],
      submitted: ['submitted', 'insurance_submitted'],
      approved: ['approved', 'insurance_approved'],
      rejected: ['rejected', 'insurance_rejected'],
      review: ['manual_review', 'insurance_manual_review'],
      pending: ['pending', 'insurance_pending']
    };

    const [insurerStatus, internalStatus] = map[clean] || ['manual_review', 'insurance_manual_review'];

    db.prepare('UPDATE claims SET insurer_processing_status=?, status=?, updated_at=? WHERE claim_no=?')
      .run(insurerStatus, internalStatus, now(), claimNo);

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(claimNo, 'claim_status', note || `Status changed to ${insurerStatus}`, 'studio', now());

    const fresh = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    const data = studioData(fresh);

    if (notify && fresh.customer_phone) {
      const publicStatus = studioPublicStatus(fresh);
      await sendText(fresh.customer_phone,
` Claim Update

Claim: ${fresh.claim_no}
Insurer: ${fresh.insurer || data.insurer || '-'}
Vehicle: ${data.vehicleMakeModelYear || data.vehicle || data.vehicleDescription || '-'}
Registration: ${data.vehicleReg || data.reg || '-'}

Status: ${publicStatus}
${note ? `\nNote: ${note}\n` : ''}
For help, reply MENU and choose Talk to Team.`
      );
    }

    res.json({ ok: true, claim: studioClaimView(fresh) });
  } catch (e) {
    console.error('STUDIO_CLAIM_STATUS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/claims/:claimNo/submit-pos', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').toUpperCase();
    const result = await submitClaimToKeithstops(claimNo, 'studio_dashboard');

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(claimNo, 'pos_submit', result.message || result.status || 'Submitted to POS', 'studio', now());

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    res.json({ ok: true, result, claim: claim ? studioClaimView(claim) : null });
  } catch (e) {
    console.error('STUDIO_POS_SUBMIT_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/notes', studioGuard, (req, res) => {
  const { ref = '', type = 'note', note = '' } = req.body || {};
  if (!ref || !note) return res.status(400).json({ ok: false, error: 'ref and note are required.' });

  db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ref, type, note, 'studio', now());

  res.json({ ok: true });
});

app.use('/studio/studio-assets', express.static(path.join(__dirname, 'admin-web', 'public', 'studio-assets'), { maxAge: '1h' }));
app.use('/studio/assets', express.static(path.join(STUDIO_DIR, 'assets'), { maxAge: '1h' }));

app.get(/^\/studio(\/.*)?$/, (req, res) => {
  const indexPath = path.join(STUDIO_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(503).type('html').send('<h1>Studio dashboard not built yet</h1><p>Run npm run build inside /opt/auto-glass-bot/admin-web.</p>');
  }
  res.sendFile(indexPath);
});




// ==============================
// STUDIO_BACKEND_V2
// Simple usable admin backend
// ==============================
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      price REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT UNIQUE,
      invoice_no TEXT,
      ref TEXT,
      customer_phone TEXT,
      amount REAL DEFAULT 0,
      method TEXT,
      status TEXT DEFAULT 'paid',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  const serviceCount = db.prepare('SELECT COUNT(*) AS c FROM studio_services').get().c;
  if (!serviceCount) {
    const seed = db.prepare('INSERT INTO studio_services (name, category, price, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
    [
      ['🪟 Windscreen Replacement', 'Auto Glass', 0],
      ['🔧 Windscreen Repair', 'Auto Glass', 0],
      ['🚪 Side / Door Glass', 'Auto Glass', 0],
      ['🚙 Rear Glass', 'Auto Glass', 0],
      ['🎨 Ceramic Tint', 'Tinting', 0],
      ['Anti-smash and Grab Film', 'Tinting', 0],
      ['🔔 Alarm Installation', 'Security', 0],
      ['❄️ Aircon Service', 'Workshop', 0],
      ['📍 Tracker Installation', 'Security', 0],
      ['🔊 Car Audio', 'Workshop', 0]
    ].forEach(x => seed.run(x[0], x[1], x[2], now(), now()));
  }
} catch (e) {
  console.error('STUDIO_BACKEND_V2_TABLE_ERROR:', e.message);
}

function v2Json(row) {
  return safeJsonParse(row?.data, {});
}

function v2All(sql, params = []) {
  try { return db.prepare(sql).all(...params); }
  catch (e) { console.error('V2_SQL_ALL_ERROR:', e.message); return []; }
}

function v2One(sql, params = []) {
  try { return db.prepare(sql).get(...params) || null; }
  catch (e) { console.error('V2_SQL_ONE_ERROR:', e.message); return null; }
}

function v2NextNo(prefix, table, col) {
  const id = Date.now().toString().slice(-7);
  return `${prefix}-${id}`;
}

function v2PublicStatus(row) {
  const status = String(row?.status || '').toLowerCase();
  const insurer = String(row?.insurer_processing_status || '').toLowerCase();
  const pos = String(row?.keithstops_status || '').toLowerCase();
  const decision = String(row?.insurer_decision_status || '').toLowerCase();

  if (decision === 'accepted' || insurer === 'accepted' || status.includes('insurance_accepted')) return 'Accepted';
  if (decision === 'declined' || insurer === 'declined' || status.includes('insurance_declined')) return 'Declined';
  if (insurer.includes('approved') || status.includes('approved')) return 'Approved';
  if (insurer.includes('rejected') || status.includes('rejected')) return 'Needs Attention';
  if (String(row?.insurer_reply_status || '').trim().toLowerCase() === 'confirmed' || String(row?.insurer_processing_status || '').trim().toLowerCase() === 'replied') return 'Insurance Replied';
  if (insurer === 'email_submission_failed') return 'Needs Attention';
  if (insurer.includes('review') || status.includes('review')) return 'Under Review';
  if (insurer.includes('submitted')) return 'Sent to Insurance';
  if (insurer.includes('awaiting') || pos.includes('submitted') || pos.includes('already')) return 'Processing';
  if (status.includes('paid')) return 'Paid';
  if (status.includes('complete')) return 'Completed';
  if (status.includes('progress')) return 'In Progress';
  if (status.includes('quote')) return 'Quote Stage';
  if (status.includes('closed')) return 'Closed';
  return 'New';
}

function v2Claim(c) {
  const d = v2Json(c);
  return {
    type: 'claim',
    ref: c.claim_no,
    claimNo: c.claim_no,
    jobNo: c.job_no || '',
    customerPhone: c.customer_phone || '',
    customerName: d.insuredName || d.customerName || d.name || '',
    insurer: c.insurer || d.insurer || '',
    vehicle: d.vehicleMakeModelYear || d.vehicle || d.vehicleDescription || '',
    registration: d.vehicleReg || d.reg || '',
    status: c.status || '',
    publicStatus: v2PublicStatus(c),
    insurerStatus: c.insurer_processing_status || '',
    posStatus: c.keithstops_status || '',
    posRef: c.keithstops_reference || '',
    pdfUrl: c.pdf_url || '',
    updatedAt: c.updated_at || '',
    createdAt: c.created_at || '',
    data: d
  };
}

function v2Job(j) {
  const d = v2Json(j);
  return {
    type: 'job',
    ref: j.job_no,
    jobNo: j.job_no,
    customerPhone: j.customer_phone || '',
    customerName: j.customer_name || '',
    vehicle: j.vehicle || '',
    registration: j.reg_no || '',
    service: j.service || '',
    jobType: j.job_type || '',
    location: j.location || '',
    status: j.status || '',
    publicStatus: v2PublicStatus(j),
    fitter: j.fitter || '',
    updatedAt: j.updated_at || '',
    createdAt: j.created_at || '',
    data: d
  };
}

function v2Doc(a) {
  return {
    id: a.id,
    ref: a.claim_no || a.job_no || '',
    claimNo: a.claim_no || '',
    jobNo: a.job_no || '',
    phone: a.phone || '',
    type: a.type || '',
    caption: a.caption || '',
    url: a.url || '',
    createdAt: a.created_at || ''
  };
}

function v2CustomerMap(claims, jobs) {
  const out = {};
  [...claims, ...jobs].forEach(x => {
    const phone = x.customerPhone;
    if (!phone) return;
    out[phone] = out[phone] || {
      phone,
      name: x.customerName || '',
      vehicle: x.vehicle || '',
      registration: x.registration || '',
      lastSeen: x.updatedAt || x.createdAt || '',
      records: 0
    };
    out[phone].records++;
    if (!out[phone].name && x.customerName) out[phone].name = x.customerName;
    
    if (!out[phone].vehicle && x.vehicle) out[phone].vehicle = x.vehicle;
    if (!out[phone].registration && x.registration) out[phone].registration = x.registration;

  });
  return Object.values(out).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
}


app.get('/api/studio/v2/state', studioGuard, (req, res) => {
  const claims = v2All('SELECT * FROM claims ORDER BY id DESC LIMIT 300').map(v2Claim);
  const jobs = v2All('SELECT * FROM jobs ORDER BY id DESC LIMIT 300').map(v2Job);
  const documents = v2All('SELECT * FROM attachments ORDER BY id DESC LIMIT 300').map(v2Doc);
  const services = v2All('SELECT * FROM studio_services ORDER BY active DESC, category ASC, name ASC');
  const invoices = v2All('SELECT * FROM studio_invoices ORDER BY id DESC LIMIT 200');
  const receipts = v2All('SELECT * FROM studio_receipts ORDER BY id DESC LIMIT 200');
  const customers = v2CustomerMap(claims, jobs);

  const pipeline = [...claims, ...jobs].sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
  );

  const activity = [
    ...claims.slice(0, 50).map(c => ({ type: 'Claim', ref: c.claimNo, title: `${c.insurer || 'Insurance'} claim`, subtitle: `${c.customerName || c.customerPhone || '-'} • ${c.publicStatus}`, time: c.updatedAt || c.createdAt })),
    ...jobs.slice(0, 50).map(j => ({ type: 'Job', ref: j.jobNo, title: j.service || 'Workshop job', subtitle: `${j.customerName || j.customerPhone || '-'} • ${j.publicStatus}`, time: j.updatedAt || j.createdAt })),
    ...documents.slice(0, 50).map(d => ({ type: 'Document', ref: d.ref || '-', title: d.type || 'Document uploaded', subtitle: d.caption || d.phone || '', time: d.createdAt }))
  ].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 80);

  const invoiceTotal = invoices.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const receiptTotal = receipts.reduce((sum, x) => sum + Number(x.amount || 0), 0);

  res.json({
    ok: true,
    summary: {
      claims: claims.length,
      jobs: jobs.length,
      customers: customers.length,
      documents: documents.length,
      services: services.length,
      invoices: invoices.length,
      receipts: receipts.length,
      pendingClaims: claims.filter(x => ['New', 'Processing', 'Under Review', 'Sent to Insurance'].includes(x.publicStatus)).length,
      approvedClaims: claims.filter(x => x.publicStatus === 'Approved').length,
      jobsInProgress: jobs.filter(x => x.publicStatus === 'In Progress').length,
      invoiceTotal,
      receiptTotal
    },
    claims,
    jobs,
    pipeline,
    customers,
    documents,
    services,
    invoices,
    receipts,
    activity,
    config: {
      business: BUSINESS_NAME,
      baseUrl: BASE_URL,
      posConnected: Boolean(process.env.KEITHSTOPS_API_KEY),
      whatsappConfigured: Boolean(API_KEY && SENDER),
      shopName: process.env.KTPOS_SHOP_NAME || '',
      terminalName: process.env.KTPOS_TARGET_TERMINAL_NAME || ''
    }
  });
});

app.post('/api/studio/v2/claims/:claimNo/status', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').toUpperCase();
    const { status = 'review', note = '', notify = true } = req.body || {};

    const claim = v2One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    if (!claim) return res.status(404).json({ ok: false, error: 'Claim not found.' });

    const map = {
      submitted: ['submitted', 'insurance_submitted'],
      approved: ['approved', 'insurance_approved'],
      rejected: ['rejected', 'insurance_rejected'],
      review: ['manual_review', 'insurance_manual_review'],
      pending: ['pending', 'insurance_pending']
    };

    const [insurerStatus, internalStatus] = map[String(status).toLowerCase()] || map.review;

    db.prepare('UPDATE claims SET insurer_processing_status=?, status=?, updated_at=? WHERE claim_no=?')
      .run(insurerStatus, internalStatus, now(), claimNo);

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(claimNo, 'claim_status', note || `Status changed to ${insurerStatus}`, 'studio', now());

    const fresh = v2One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    const view = v2Claim(fresh);

    if (notify && fresh.customer_phone) {
      await sendText(fresh.customer_phone,
` Claim Update

Claim: ${view.claimNo}
Insurer: ${view.insurer || '-'}
Vehicle: ${view.vehicle || '-'}
Registration: ${view.registration || '-'}

Status: ${view.publicStatus}
${note ? `\nNote: ${note}\n` : ''}
For help, reply MENU and choose Talk to Team.`
      );
    }

    res.json({ ok: true, record: view });
  } catch (e) {
    console.error('V2_CLAIM_STATUS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v2/claims/:claimNo/submit-pos', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').toUpperCase();
    const result = await submitClaimToKeithstops(claimNo, 'studio_v2_dashboard');

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(claimNo, 'pos_submit', result.message || result.status || 'POS submission', 'studio', now());

    const fresh = v2One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    res.json({ ok: true, result, record: fresh ? v2Claim(fresh) : null });
  } catch (e) {
    console.error('V2_POS_SUBMIT_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v2/jobs/:jobNo/status', studioGuard, (req, res) => {
  const jobNo = String(req.params.jobNo || '').toUpperCase();
  const { status = 'in_progress' } = req.body || {};

  const job = v2One('SELECT * FROM jobs WHERE job_no=?', [jobNo]);
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });

  db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE job_no=?').run(status, now(), jobNo);

  db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(jobNo, 'job_status', `Job status changed to ${status}`, 'studio', now());

  const fresh = v2One('SELECT * FROM jobs WHERE job_no=?', [jobNo]);
  res.json({ ok: true, record: v2Job(fresh) });
});

app.post('/api/studio/v2/services', studioGuard, (req, res) => {
  const { name, category = 'General', price = 0 } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'Service name is required.' });

  const info = db.prepare('INSERT INTO studio_services (name, category, price, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
    .run(name, category, Number(price || 0), now(), now());

  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/studio/v2/services/:id', studioGuard, (req, res) => {
  const id = Number(req.params.id);
  const svc = v2One('SELECT * FROM studio_services WHERE id=?', [id]);
  if (!svc) return res.status(404).json({ ok: false, error: 'Service not found.' });

  const name = req.body?.name ?? svc.name;
  const category = req.body?.category ?? svc.category;
  const price = req.body?.price ?? svc.price;
  const active = req.body?.active ?? svc.active;

  db.prepare('UPDATE studio_services SET name=?, category=?, price=?, active=?, updated_at=? WHERE id=?')
    .run(name, category, Number(price || 0), Number(active ? 1 : 0), now(), id);

  res.json({ ok: true });
});

app.post('/api/studio/v2/invoices', studioGuard, (req, res) => {
  const { ref = '', customerPhone = '', customerName = '', amount = 0, notes = '' } = req.body || {};
  const invoiceNo = v2NextNo('INV', 'studio_invoices', 'invoice_no');

  db.prepare(`INSERT INTO studio_invoices (invoice_no, ref, customer_phone, customer_name, amount, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .run(invoiceNo, ref, customerPhone, customerName, Number(amount || 0), notes, now(), now());

  res.json({ ok: true, invoiceNo });
});

app.post('/api/studio/v2/receipts', studioGuard, async (req, res) => {
  const { invoiceNo = '', ref = '', customerPhone = '', amount = 0, method = 'Cash', notes = '', notify = false } = req.body || {};
  const receiptNo = v2NextNo('RCT', 'studio_receipts', 'receipt_no');

  db.prepare(`INSERT INTO studio_receipts (receipt_no, invoice_no, ref, customer_phone, amount, method, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)`)
    .run(receiptNo, invoiceNo, ref, customerPhone, Number(amount || 0), method, notes, now(), now());

  if (invoiceNo) {
    db.prepare(`UPDATE studio_invoices SET status='paid', updated_at=? WHERE invoice_no=?`).run(now(), invoiceNo);
  }

  if (notify && customerPhone) {
    await sendText(customerPhone,
` Payment Receipt

Receipt: ${receiptNo}
${invoiceNo ? `Invoice: ${invoiceNo}\n` : ''}Amount: $${Number(amount || 0).toFixed(2)}
Method: ${method}

Thank you.`
    );
  }

  res.json({ ok: true, receiptNo });
});

app.post('/api/studio/v2/message', studioGuard, async (req, res) => {
  const { phone = '', message = '' } = req.body || {};
  if (!phone || !message) return res.status(400).json({ ok: false, error: 'phone and message are required.' });
  await sendText(phone, message);
  res.json({ ok: true });
});



// ==============================
// STUDIO_BACKEND_V3_SIMPLE_WORKSHOP
// Simple workshop dashboard backend
// ==============================
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      price REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      ref TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT UNIQUE,
      invoice_no TEXT,
      ref TEXT,
      customer_phone TEXT,
      amount REAL DEFAULT 0,
      method TEXT,
      status TEXT DEFAULT 'paid',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      type TEXT,
      note TEXT,
      actor TEXT,
      created_at TEXT
    );
  `);

  const serviceCount = db.prepare('SELECT COUNT(*) AS c FROM studio_services').get().c;
  if (!serviceCount) {
    const seed = db.prepare('INSERT INTO studio_services (name, category, price, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
    [
      ['🪟 Windscreen Replacement', 'Auto Glass', 0],
      ['🔧 Windscreen Repair', 'Auto Glass', 0],
      ['🚪 Side / Door Glass', 'Auto Glass', 0],
      ['🚙 Rear Glass', 'Auto Glass', 0],
      ['🎨 Ceramic Tint', 'Tinting', 0],
      ['Anti-smash and Grab Film', 'Tinting', 0],
      ['🔔 Alarm Installation', 'Security', 0],
      ['❄️ Aircon Service', 'Workshop', 0],
      ['📍 Tracker Installation', 'Security', 0],
      ['🔊 Car Audio', 'Workshop', 0]
    ].forEach(x => seed.run(x[0], x[1], x[2], now(), now()));
  }
} catch (e) {
  console.error('STUDIO_BACKEND_V3_TABLE_ERROR:', e.message);
}

function v3Json(row) {
  return safeJsonParse(row?.data, {});
}

function v3All(sql, params = []) {
  try { return db.prepare(sql).all(...params); }
  catch (e) { console.error('V3_SQL_ALL_ERROR:', e.message); return []; }
}

function v3One(sql, params = []) {
  try { return db.prepare(sql).get(...params) || null; }
  catch (e) { console.error('V3_SQL_ONE_ERROR:', e.message); return null; }
}

function v3NextNo(prefix) {
  return `${prefix}-${Date.now().toString().slice(-7)}`;
}

function v3PublicStatus(row) {
  const status = String(row?.status || '').toLowerCase();
  const insurer = String(row?.insurer_processing_status || '').toLowerCase();
  const pos = String(row?.keithstops_status || '').toLowerCase();
  const decision = String(row?.insurer_decision_status || '').toLowerCase();

  if (decision === 'accepted' || insurer === 'accepted' || status.includes('insurance_accepted')) return 'Accepted';
  if (decision === 'declined' || insurer === 'declined' || status.includes('insurance_declined')) return 'Declined';
  if (insurer.includes('approved') || status.includes('approved')) return 'Approved';
  if (insurer.includes('rejected') || status.includes('rejected')) return 'Needs Attention';
  if (String(row?.insurer_reply_status || '').trim().toLowerCase() === 'confirmed' || String(row?.insurer_processing_status || '').trim().toLowerCase() === 'replied') return 'Insurance Replied';
  if (insurer === 'email_submission_failed') return 'Needs Attention';
  if (insurer.includes('review') || status.includes('review')) return 'Under Review';
  if (insurer.includes('submitted')) return 'Sent to Insurance';
  if (insurer.includes('awaiting') || pos.includes('submitted') || pos.includes('already')) return 'Processing';
  if (status.includes('paid')) return 'Paid';
  if (status.includes('complete')) return 'Completed';
  if (status.includes('progress')) return 'In Progress';
  if (status.includes('quote_sent')) return 'Quotation Sent';
  if (status.includes('quote')) return 'Quote Stage';
  if (status.includes('closed')) return 'Closed';
  return 'New';
}

function v3SafeInsurerError(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function v3ClaimPdfReady(c) {
  const pdfPath = String(c?.pdf_path || '').trim();
  const pdfUrl = String(c?.pdf_url || '').trim();
  if (!pdfPath) return false;

  try {
    const pdfRoot = path.resolve(__dirname, 'public', 'pdfs');
    const resolved = path.resolve(pdfPath);
    if (resolved !== pdfRoot && !resolved.startsWith(`${pdfRoot}${path.sep}`)) return false;

    if (pdfUrl) {
      const urlBasename = path.basename(new URL(pdfUrl).pathname);
      if (urlBasename && urlBasename !== path.basename(resolved)) return false;
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size <= 4 || stat.size > 25 * 1024 * 1024) return false;

    const header = Buffer.alloc(5);
    const fd = fs.openSync(resolved, 'r');
    try { fs.readSync(fd, header, 0, 5, 0); }
    finally { fs.closeSync(fd); }
    return header.toString('ascii') === '%PDF-';
  } catch (_) {
    return false;
  }
}

function v3InsurerIntegration(c) {
  const d = v3Json(c);
  const insurerName = c?.insurer || d.insurer || '';
  const config = insurerEmail.getInsurerEmailConfig(insurerName);
  const confirmation = String(d.customerConfirmation || '').trim().toLowerCase();
  const customerConfirmed = confirmation === 'confirmed' || confirmation === 'confirmed_correct';
  const emailStatus = String(c?.insurer_email_status || '').trim().toLowerCase();
  const replyStatus = String(c?.insurer_reply_status || '').trim().toLowerCase();
  const decisionStatus = String(c?.insurer_decision_status || '').trim().toLowerCase();
  const decisionReason = String(c?.insurer_decision_reason || '').trim();
  const decisionComment = String(c?.insurer_decision_comment || '').trim();
  const decisionAt = String(c?.insurer_decision_at || '').trim();
  const insurerState = String(c?.insurer_processing_status || '').trim().toLowerCase();
  const rawStatus = String(c?.status || '').trim().toLowerCase();
  const pdfReady = v3ClaimPdfReady(c);
  const pdfRequired = String(process.env.DASHBOARD_INSURER_PDF_REQUIRED || 'true').trim().toLowerCase() !== 'false';
  const isApproved = insurerState.includes('approved') || rawStatus.includes('approved');
  const isRejected = insurerState.includes('rejected') || rawStatus.includes('rejected');

  let state = 'not_ready';
  let statusLabel = pdfRequired ? 'Final PDF not ready' : 'Ready to Send';
  let message = pdfRequired ? 'A valid final claim PDF is required before insurer submission.' : 'Ready for insurer submission. PDF attachment is temporarily optional.';
  let canSend = false;
  let canRetry = false;

  if (decisionStatus === 'accepted') {
    state = 'accepted';
    statusLabel = 'Accepted';
    message = `Insurer accepted this claim${decisionAt ? ` on ${decisionAt}` : ''}.`;
  } else if (decisionStatus === 'declined') {
    state = 'declined';
    statusLabel = 'Declined';
    message = decisionReason ? `Reason: ${decisionReason}` : 'No decline reason was provided.';
  } else if (emailStatus === 'sent' && decisionStatus === 'awaiting_decision') {
    state = 'awaiting_decision';
    statusLabel = 'Waiting for Insurance Decision';
    message = 'Claim email sent. Waiting for the insurer to select Accept or Decline.';
  } else if (!config) {
    state = 'manual';
    statusLabel = 'Manual Processing';
    message = `No insurer email route is configured for ${String(insurerName || 'this insurer').trim() || 'this insurer'}.`;
  } else if (isApproved || isRejected) {
    state = 'locked';
    statusLabel = isApproved ? 'Approved' : 'Rejected';
    message = `Insurer workflow is already ${statusLabel}. Email submission is locked to preserve this state.`;
  } else if (replyStatus === 'confirmed') {
    state = 'confirmed';
    statusLabel = 'Insurance Replied';
    message = `Reply received${c?.insurer_reply_received_at ? ` on ${c.insurer_reply_received_at}` : ''}.`;
  } else if (replyStatus === 'needs_review' || replyStatus === 'reply_needs_review') {
    state = 'reply_needs_review';
    statusLabel = 'Insurer Reply Needs Review';
    message = 'A legacy insurer email reply was received and needs review.';
  } else if (emailStatus === 'sent' && String(c?.insurer_email_reply_to || '').trim()) {
    state = 'awaiting_reply';
    statusLabel = 'Awaiting Insurer Reply';
    message = 'Claim email sent. Waiting for the insurer to reply with confirmation.';
  } else if (emailStatus === 'sent') {
    state = 'sent';
    statusLabel = 'Sent to Insurance';
    message = 'Resend accepted this insurer submission.';
  } else if (emailStatus === 'sending') {
    state = 'sending';
    statusLabel = 'Sending...';
    message = 'Insurer submission is currently in progress.';
  } else if (emailStatus === 'failed') {
    state = 'failed';
    statusLabel = 'Needs Attention';
    message = v3SafeInsurerError(c?.insurer_email_error) || 'The previous insurer email attempt failed. Review and retry once.';
    canRetry = !pdfRequired || pdfReady;
  } else if (pdfRequired && !pdfReady) {
    state = 'not_ready';
    statusLabel = 'Final PDF not ready';
    message = 'A valid final claim PDF is required before insurer submission.';
  } else {
    state = 'ready';
    statusLabel = 'Ready to Send';
    message = pdfReady ? 'Claim PDF is ready for insurer submission.' : 'Ready for insurer submission. PDF attachment is temporarily optional.';
    canSend = true;
  }

  return {
    routeConfigured: Boolean(config || String(c?.insurer_email_recipient || '').trim()),
    insurer: config?.displayName || String(insurerName || ''),
    recipient: config?.recipient || c?.insurer_decision_recipient || c?.insurer_email_recipient || '',
    state,
    statusLabel,
    message,
    canSend,
    canRetry,
    customerConfirmed,
    confirmedAt: d.confirmedAt || '',
    pdfReady,
    pdfRequired,
    emailStatus,
    sentAt: c?.insurer_email_sent_at || '',
    messageId: c?.insurer_email_message_id || '',
    error: v3SafeInsurerError(c?.insurer_email_error),
    attempts: Number(c?.insurer_email_attempts || 0),
    deliveryState: emailStatus === 'sent'
      ? (decisionStatus === 'accepted'
          ? 'Accepted by insurer'
          : decisionStatus === 'declined'
            ? 'Declined by insurer'
            : decisionStatus === 'awaiting_decision'
              ? 'Accepted by Resend / awaiting insurer decision'
              : replyStatus === 'confirmed'
                ? 'Accepted by Resend / legacy insurer reply received'
                : (String(c?.insurer_email_reply_to || '').trim() ? 'Accepted by Resend / awaiting legacy insurer reply' : 'Accepted by Resend'))
      : '',
    decisionStatus,
    decisionAt,
    decisionReason,
    decisionComment,
    decisionRecipient: c?.insurer_decision_recipient || '',
    decisionAckMessageId: c?.insurer_decision_ack_message_id || '',
    decisionAckSentAt: c?.insurer_decision_ack_sent_at || '',
    decisionAckError: v3SafeInsurerError(c?.insurer_decision_ack_error),
    replyTo: c?.insurer_email_reply_to || '',
    replyStatus,
    replyReceivedAt: c?.insurer_reply_received_at || '',
    replyFrom: c?.insurer_reply_from || '',
    replyEmailId: c?.insurer_reply_email_id || '',
    replyMessageId: c?.insurer_reply_message_id || '',
    replyAckMessageId: c?.insurer_reply_ack_message_id || ''
  };
}

function v3Claim(c) {
  const d = v3Json(c);
  const insurerIntegration = v3InsurerIntegration(c);
  return {
    type: 'claim',
    ref: c.claim_no,
    claimNo: c.claim_no,
    jobNo: c.job_no || '',
    customerPhone: c.customer_phone || '',
    customerName: d.insuredName || d.customerName || d.name || '',
    insurer: c.insurer || d.insurer || '',
    vehicle: d.vehicleMakeModelYear || d.vehicle || d.vehicleDescription || '',
    registration: d.vehicleReg || d.reg || '',
    status: c.status || '',
    publicStatus: v3PublicStatus(c),
    insurerStatus: c.insurer_processing_status || '',
    insurerEmail: insurerIntegration,
    posStatus: c.keithstops_status || '',
    posRef: c.keithstops_reference || '',
    pdfUrl: c.pdf_url || '',
    updatedAt: c.updated_at || '',
    createdAt: c.created_at || '',
    data: d
  };
}

function v3JobDateTime(value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };

  const dateText = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date).replace(',', '');

  const timeText = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);

  return { date: dateText, time: timeText };
}

function v3Job(j) {
  const d = v3Json(j);
  const jobDateTime = v3JobDateTime(j.created_at);
  return {
    type: 'job',
    ref: j.job_no,
    jobNo: j.job_no,
    customerPhone: j.customer_phone || '',
    customerName: j.customer_name || '',
    vehicle: j.vehicle || '',
    registration: j.reg_no || '',
    service: j.service || '',
    jobType: j.job_type || '',
    location: j.location || '',
    status: j.status || '',
    publicStatus: v3PublicStatus(j),
    quoteAmount: j.quote_amount || d.quoteAmount || '',
    quoteCurrency: d.quoteCurrency || 'USD',
    quoteNotes: d.quoteNotes || '',
    bookingDate: j.booking_date || d.bookingDate || d.preferredDate || '',
    bookingTime: d.bookingTime || d.preferredTime || '',
    bookingPdfUrl: d.bookingPdfUrl || '',
    bookingPdfPath: d.bookingPdfPath || '',
    jobDate: jobDateTime.date,
    jobTime: jobDateTime.time,
    fitter: j.fitter || '',
    updatedAt: j.updated_at || '',
    createdAt: j.created_at || '',
    data: d
  };
}

function v3Doc(a) {
  return {
    id: a.id,
    ref: a.claim_no || a.job_no || '',
    claimNo: a.claim_no || '',
    jobNo: a.job_no || '',
    phone: a.phone || '',
    type: a.type || '',
    caption: a.caption || '',
    url: a.url || '',
    createdAt: a.created_at || ''
  };
}

function v3Customers(claims, jobs, docs, invoices, receipts) {
  const out = {};

  function touch(phone) {
    if (!phone) return null;
    out[phone] = out[phone] || {
      phone,
      name: '',
      vehicle: '',
      registration: '',
      claims: 0,
      jobs: 0,
      documents: 0,
      invoices: 0,
      receipts: 0,
      lastSeen: ''
    };
    return out[phone];
  }

  claims.forEach(c => {
    const x = touch(c.customerPhone);
    if (!x) return;
    x.claims++;
    if (!x.name && c.customerName) x.name = c.customerName;
    if (!x.vehicle && c.vehicle) x.vehicle = c.vehicle;
    if (!x.registration && c.registration) x.registration = c.registration;
    if (String(c.updatedAt || c.createdAt).localeCompare(String(x.lastSeen || '')) > 0) x.lastSeen = c.updatedAt || c.createdAt;
  });

  jobs.forEach(j => {
    const x = touch(j.customerPhone);
    if (!x) return;
    x.jobs++;
    if (!x.name && j.customerName) x.name = j.customerName;
    if (!x.vehicle && j.vehicle) x.vehicle = j.vehicle;
    if (!x.registration && j.registration) x.registration = j.registration;
    if (String(j.updatedAt || j.createdAt).localeCompare(String(x.lastSeen || '')) > 0) x.lastSeen = j.updatedAt || j.createdAt;
  });

  docs.forEach(d => {
    const x = touch(d.phone);
    if (x) x.documents++;
  });

  invoices.forEach(i => {
    const x = touch(i.customer_phone);
    if (x) x.invoices++;
  });

  receipts.forEach(r => {
    const x = touch(r.customer_phone);
    if (x) x.receipts++;
  });

  return Object.values(out).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

// Monthly PDF statistics exports for Jobs and External Job Cards.
const VP_MONTH_NAMES = Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
const VP_MONTH_SHORT = Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);

function vpReportMonth(value) {
  const month = String(value || '').trim();
  if (!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  return { month, year, monthNumber, label: `${VP_MONTH_NAMES[monthNumber - 1]} ${year}` };
}

function vpCatMonthBounds(year, monthNumber) {
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1, -2)).toISOString(),
    end: new Date(Date.UTC(year, monthNumber, 1, -2)).toISOString()
  };
}

function vpReportMonthRows(table, year, monthNumber) {
  if (!['jobs', 'external_job_cards'].includes(table)) throw new Error('Unsupported report table.');
  const { start, end } = vpCatMonthBounds(year, monthNumber);
  return db.prepare(`
    SELECT * FROM ${table}
    WHERE julianday(created_at) >= julianday(?)
      AND julianday(created_at) < julianday(?)
    ORDER BY id DESC
  `).all(start, end);
}

function vpReportMonthSeries(table, year, throughMonthNumber) {
  if (!['jobs', 'external_job_cards'].includes(table)) throw new Error('Unsupported report table.');
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
    WHERE julianday(created_at) >= julianday(?)
      AND julianday(created_at) < julianday(?)
  `);
  const months = [];
  for (let monthNumber = 1; monthNumber <= throughMonthNumber; monthNumber += 1) {
    const { start, end } = vpCatMonthBounds(year, monthNumber);
    const row = countStmt.get(start, end);
    months.push({
      month: `${year}-${String(monthNumber).padStart(2, '0')}`,
      label: VP_MONTH_SHORT[monthNumber - 1],
      fullLabel: `${VP_MONTH_NAMES[monthNumber - 1]} ${year}`,
      count: Number(row?.count || 0)
    });
  }
  return months;
}

function vpReportStatusBreakdown(kind, rows) {
  const counts = new Map();
  for (const row of rows || []) {
    let label = 'Other';
    if (kind === 'jobs') {
      label = v3PublicStatus(row) || 'Other';
    } else {
      const status = String(row?.review_status || 'needs_review').trim().toLowerCase();
      label = ({
        needs_review: 'Needs Review',
        ready: 'Ready',
        held: 'On Hold',
        submitted: 'Submitted',
        failed: 'Needs Attention'
      })[status] || status.replace(/_/g, ' ') || 'Other';
    }
    counts.set(label, Number(counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

function vpGeneratedAtCat() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date()).replace(',', '');
}

function vpWriteMonthlyReportResponse(res, kind, monthValue) {
  const parsed = vpReportMonth(monthValue);
  if (!parsed) {
    res.status(400).json({ ok: false, error: 'Use a valid YYYY-MM month.' });
    return;
  }

  const table = kind === 'jobs' ? 'jobs' : 'external_job_cards';
  const rows = vpReportMonthRows(table, parsed.year, parsed.monthNumber);
  const months = vpReportMonthSeries(table, parsed.year, parsed.monthNumber);
  const ytdTotal = months.reduce((sum, row) => sum + row.count, 0);
  const selectedCount = Number(months.at(-1)?.count || 0);
  const peak = months.reduce((best, row) => row.count > best.count ? row : best, months[0] || { count: 0, fullLabel: '-' });
  const statusBreakdown = vpReportStatusBreakdown(kind, rows);
  const title = kind === 'jobs'
    ? 'Workshop Job Cards - Monthly Statistics'
    : 'External Job Cards - Monthly Statistics';
  const filename = kind === 'jobs'
    ? `Windscreen-Job-Cards-${parsed.month}-Report.pdf`
    : `Windscreen-External-Job-Cards-${parsed.month}-Report.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  monthlyStatsReport.writeMonthlyStatsPdf({
    output: res,
    title,
    selectedMonthLabel: parsed.label,
    selectedCount,
    ytdTotal,
    averagePerMonth: parsed.monthNumber ? ytdTotal / parsed.monthNumber : 0,
    peakMonthLabel: peak?.fullLabel || '-',
    peakCount: Number(peak?.count || 0),
    months,
    statusBreakdown,
    generatedAt: vpGeneratedAtCat(),
    logoPath: path.join(__dirname, 'public', 'branding', 'windscreen-fitment-centre-logo.png')
  });
}

app.get('/api/studio/v3/jobs-month-report.pdf', studioGuard, (req, res) => {
  try { vpWriteMonthlyReportResponse(res, 'jobs', req.query.month); }
  catch (error) {
    console.error('JOBS_MONTH_REPORT_ERROR:', error.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Unable to generate monthly jobs report.' });
    else res.end();
  }
});

app.get('/api/studio/v3/external-job-cards-month-report.pdf', studioGuard, (req, res) => {
  try { vpWriteMonthlyReportResponse(res, 'external', req.query.month); }
  catch (error) {
    console.error('EXTERNAL_JOB_CARDS_MONTH_REPORT_ERROR:', error.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Unable to generate external job cards report.' });
    else res.end();
  }
});

// Monthly job history: Africa/Harare is UTC+02:00 (no daylight saving).
app.get('/api/studio/v3/jobs-by-month', studioGuard, (req, res) => {
  const month = String(req.query.month || '');
  if (!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ ok: false, error: 'Use a valid YYYY-MM month.' });
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, -2)).toISOString();
  const end = new Date(Date.UTC(year, monthNumber, 1, -2)).toISOString();
  try {
    const jobs = db.prepare(
      'SELECT * FROM jobs WHERE julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?) ORDER BY id DESC'
    ).all(start, end).map(v3Job);
    res.json({ ok: true, month, jobs });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Unable to load monthly jobs.' });
  }
});

app.get('/api/studio/v3/state', studioGuard, (req, res) => {
  const claims = v3All('SELECT * FROM claims ORDER BY id DESC LIMIT 500').map(v3Claim);
  const jobs = v3All('SELECT * FROM jobs ORDER BY id DESC LIMIT 500').map(v3Job);
  const documents = v3All('SELECT * FROM attachments ORDER BY id DESC LIMIT 800').map(v3Doc);
  const services = v3All('SELECT * FROM studio_services ORDER BY active DESC, category ASC, name ASC');
  const invoices = v3All('SELECT * FROM studio_invoices ORDER BY id DESC LIMIT 300');
  const receipts = v3All('SELECT * FROM studio_receipts ORDER BY id DESC LIMIT 300');

  const customers = v3Customers(claims, jobs, documents, invoices, receipts);

  const bookings = jobs.filter(j =>
    String(j.jobType || '').toLowerCase().includes('book') ||
    String(j.status || '').toLowerCase().includes('book') ||
    !String(j.status || '').toLowerCase().includes('quote')
  );

  const quotedJobNos = new Set(
    v3All('SELECT DISTINCT job_no FROM job_quotations WHERE job_no IS NOT NULL AND trim(job_no)<>\'\'')
      .map(row => String(row.job_no || '').trim())
      .filter(Boolean)
  );

  const quotes = jobs.filter(j => {
    const jobNo = String(j.jobNo || '').trim();
    const status = String(j.status || '').toLowerCase();
    const jobType = String(j.jobType || '').toLowerCase();
    const lastQuoteNo = String(j.data?.lastQuoteNo || '').trim();
    return jobType.includes('quote') ||
      status.includes('quote') ||
      Boolean(lastQuoteNo) ||
      quotedJobNos.has(jobNo);
  });

  const activity = [
    ...claims.slice(0, 80).map(c => ({ type: 'Claim', ref: c.claimNo, title: `${c.insurer || 'Insurance'} claim`, subtitle: `${c.customerName || c.customerPhone || '-'} • ${c.publicStatus}`, time: c.updatedAt || c.createdAt })),
    ...jobs.slice(0, 80).map(j => ({ type: 'Job', ref: j.jobNo, title: j.service || 'Workshop job', subtitle: `${j.customerName || j.customerPhone || '-'} • ${j.publicStatus}`, time: j.updatedAt || j.createdAt })),
    ...documents.slice(0, 80).map(d => ({ type: 'Document', ref: d.ref || '-', title: d.type || 'Document uploaded', subtitle: d.caption || d.phone || '', time: d.createdAt }))
  ].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 100);

  const invoiceTotal = invoices.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const receiptTotal = receipts.reduce((sum, x) => sum + Number(x.amount || 0), 0);

  res.json({
    ok: true,
    summary: {
      bookings: bookings.length,
      quotes: quotes.length,
      claims: claims.length,
      jobs: jobs.length,
      customers: customers.length,
      documents: documents.length,
      services: services.length,
      invoices: invoices.length,
      receipts: receipts.length,
      pendingClaims: claims.filter(x => ['New', 'Processing', 'Under Review', 'Sent to Insurance'].includes(x.publicStatus)).length,
      approvedClaims: claims.filter(x => x.publicStatus === 'Approved').length,
      jobsInProgress: jobs.filter(x => x.publicStatus === 'In Progress').length,
      invoiceTotal,
      receiptTotal
    },
    bookings,
    quotes,
    claims,
    jobs,
    customers,
    documents,
    services,
    invoices,
    receipts,
    activity,
    config: {
      business: BUSINESS_NAME,
      baseUrl: BASE_URL,
      posConnected: Boolean(process.env.KEITHSTOPS_API_KEY),
      whatsappConfigured: Boolean(API_KEY && SENDER),
      shopName: process.env.KTPOS_SHOP_NAME || '',
      terminalName: process.env.KTPOS_TARGET_TERMINAL_NAME || ''
    }
  });
});

app.post('/api/studio/v3/claims/:claimNo/status', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').toUpperCase();
    const { status = 'review', note = '', notify = true } = req.body || {};

    const claim = v3One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    if (!claim) return res.status(404).json({ ok: false, error: 'Claim not found.' });

    const requestedStatus = String(status).toLowerCase();
    if (requestedStatus === 'submitted') {
      return res.status(409).json({
        ok: false,
        error: 'Use Send to Insurance. A claim is marked Sent to Insurance only after Resend accepts the email.'
      });
    }

    const map = {
      approved: ['approved', 'insurance_approved'],
      rejected: ['rejected', 'insurance_rejected'],
      review: ['manual_review', 'insurance_manual_review'],
      pending: ['pending', 'insurance_pending']
    };

    const [insurerStatus, internalStatus] = map[requestedStatus] || map.review;

    db.prepare('UPDATE claims SET insurer_processing_status=?, status=?, updated_at=? WHERE claim_no=?')
      .run(insurerStatus, internalStatus, now(), claimNo);

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(claimNo, 'claim_status', note || `Status changed to ${insurerStatus}`, 'studio', now());

    const fresh = v3One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    const view = v3Claim(fresh);

    if (notify && fresh.customer_phone) {
      await sendText(fresh.customer_phone,
` Claim Update

Claim: ${view.claimNo}
Insurer: ${view.insurer || '-'}
Vehicle: ${view.vehicle || '-'}
Registration: ${view.registration || '-'}

Status: ${view.publicStatus}
${note ? `\nNote: ${note}\n` : ''}
For help, reply MENU and choose Talk to Team.`
      );
    }

    res.json({ ok: true, record: view });
  } catch (e) {
    console.error('V3_CLAIM_STATUS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/claims/:claimNo/send-insurer', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').trim().toUpperCase();
    const retry = req.body?.retry === true;
    const claim = v3One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    if (!claim) return res.status(404).json({ ok: false, error: 'Claim not found.' });

    const integration = v3InsurerIntegration(claim);
    if (!integration.routeConfigured) {
      return res.status(409).json({ ok: false, error: integration.message, record: v3Claim(claim) });
    }
    if (integration.state === 'sent') {
      return res.json({
        ok: true,
        result: {
          status: 'already_sent',
          recipient: integration.recipient,
          messageId: integration.messageId,
          sentAt: integration.sentAt
        },
        record: v3Claim(claim)
      });
    }
    if (integration.state === 'sending') {
      return res.status(202).json({ ok: true, result: { status: 'send_in_progress', recipient: integration.recipient }, record: v3Claim(claim) });
    }
    if (integration.state === 'locked') {
      return res.status(409).json({ ok: false, error: integration.message, record: v3Claim(claim) });
    }
    if (integration.pdfRequired && !integration.pdfReady) {
      return res.status(409).json({ ok: false, error: 'A valid final claim PDF is required before insurer submission.', record: v3Claim(claim) });
    }
    if (integration.state === 'failed' && !retry) {
      return res.status(409).json({ ok: false, error: 'The previous insurer email attempt failed. Use Retry Send after reviewing the error.', record: v3Claim(claim) });
    }

    const enabled = String(
      process.env.INSURER_EMAIL_ENABLED || process.env.OLD_MUTUAL_EMAIL_ENABLED || ''
    ).trim().toLowerCase() === 'true';

    const result = await insurerEmail.submitConfirmedClaimEmail({
      db,
      claimNo,
      apiKey: process.env.RESEND_API_KEY || '',
      from: process.env.OLD_MUTUAL_EMAIL_FROM || '',
      enabled,
      timeoutMs: 12000,
      now,
      allowHistoricalConfirmed: true,
      allowRetryFailed: retry,
      allowUnconfirmed: true,
      allowMissingPdf: !integration.pdfRequired,
      replyEnabled: false,
      replyDomain: process.env.INSURER_REPLY_DOMAIN || 'autoglassinsurance.visionpixels.autos',
      replySecret: process.env.INSURER_REPLY_SECRET || '',
      decisionEnabled: true,
      decisionBaseUrl: BASE_URL,
      decisionSecret: process.env.INSURER_DECISION_SECRET || process.env.INSURER_REPLY_SECRET || ''
    });

    const fresh = v3One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    const safeResult = {
      status: result.status || '',
      recipient: result.recipient || integration.recipient,
      messageId: result.messageId || '',
      sentAt: result.sentAt || fresh?.insurer_email_sent_at || ''
    };

    try {
      const noteText = result.success
        ? `Insurer email action: ${safeResult.status}${safeResult.recipient ? ` → ${safeResult.recipient}` : ''}`
        : `Insurer email failed: ${v3SafeInsurerError(result.error || result.status || 'Unknown error')}`;
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(claimNo, 'insurer_email', noteText, 'studio', now());
    } catch (_) {}

    if (!result.success) {
      const error = v3SafeInsurerError(result.error) || (
        result.status === 'disabled'
          ? 'Insurer email submission is currently disabled.'
          : 'Insurer email submission failed.'
      );
      return res.status(result.status === 'disabled' ? 503 : 502).json({
        ok: false,
        error,
        result: safeResult,
        record: fresh ? v3Claim(fresh) : null
      });
    }

    return res.json({ ok: true, result: safeResult, record: fresh ? v3Claim(fresh) : null });
  } catch (e) {
    console.error('V3_INSURER_SEND_ERROR:', e);
    return res.status(500).json({ ok: false, error: 'Unable to submit this claim to the insurer.' });
  }
});

app.post('/api/studio/v3/claims/:claimNo/submit-pos', studioGuard, async (req, res) => {
  try {
    const claimNo = String(req.params.claimNo || '').toUpperCase();
    const result = await submitClaimToKeithstops(claimNo, 'studio_v3_dashboard');

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(claimNo, 'pos_submit', result.message || result.status || 'POS submission', 'studio', now());

    const fresh = v3One('SELECT * FROM claims WHERE claim_no=?', [claimNo]);
    res.json({ ok: true, result, record: fresh ? v3Claim(fresh) : null });
  } catch (e) {
    console.error('V3_POS_SUBMIT_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/jobs/:jobNo/status', studioGuard, async (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').toUpperCase();

    const {
      status = 'in_progress',
      note = '',
      notify = true
    } = req.body || {};

    const job = v3One(
      'SELECT * FROM jobs WHERE job_no=?',
      [jobNo]
    );

    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'Job not found.'
      });
    }

    db.prepare(
      'UPDATE jobs SET status=?, updated_at=? WHERE job_no=?'
    ).run(status, now(), jobNo);

    db.prepare(
      'INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      jobNo,
      'job_status',
      note || `Job status changed to ${status}`,
      'studio',
      now()
    );

    const fresh = v3One(
      'SELECT * FROM jobs WHERE job_no=?',
      [jobNo]
    );

    const view = v3Job(fresh);

    const notification = {
      attempted: false,
      sent: false,
      error: null
    };

    const customerPhone =
      fresh?.customer_phone ||
      fresh?.phone ||
      '';

    if (notify && customerPhone) {
      notification.attempted = true;

      try {
        await sendText(
          customerPhone,
`Job Update

Job Card: ${view.jobNo || jobNo}
Vehicle: ${view.vehicle || '-'}
Registration: ${view.registration || '-'}
Service: ${view.service || '-'}

Status: ${view.publicStatus || status}
${note ? `
Note: ${note}
` : ''}
For assistance, reply MENU and choose Talk to Team.`
        );

        notification.sent = true;
      } catch (error) {
        notification.error = error.message;

        console.error(
          'V3_JOB_STATUS_NOTIFICATION_ERROR:',
          jobNo,
          error.message
        );
      }
    }

    res.json({
      ok: true,
      record: view,
      notification
    });
  } catch (error) {
    console.error(
      'V3_JOB_STATUS_ERROR:',
      error
    );

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/studio/v3/services', studioGuard, (req, res) => {
  const { name, category = 'General', price = 0 } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'Service name is required.' });

  const info = db.prepare('INSERT INTO studio_services (name, category, price, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
    .run(name, category, Number(price || 0), now(), now());

  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/studio/v3/services/:id', studioGuard, (req, res) => {
  const id = Number(req.params.id);
  const svc = v3One('SELECT * FROM studio_services WHERE id=?', [id]);
  if (!svc) return res.status(404).json({ ok: false, error: 'Service not found.' });

  db.prepare('UPDATE studio_services SET name=?, category=?, price=?, active=?, updated_at=? WHERE id=?')
    .run(req.body?.name ?? svc.name, req.body?.category ?? svc.category, Number(req.body?.price ?? svc.price), Number(req.body?.active ?? svc.active), now(), id);

  res.json({ ok: true });
});

app.post('/api/studio/v3/invoices', studioGuard, (req, res) => {
  const { ref = '', customerPhone = '', customerName = '', amount = 0, notes = '' } = req.body || {};
  const invoiceNo = v3NextNo('INV');

  db.prepare(`INSERT INTO studio_invoices (invoice_no, ref, customer_phone, customer_name, amount, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .run(invoiceNo, ref, customerPhone, customerName, Number(amount || 0), notes, now(), now());

  res.json({ ok: true, invoiceNo });
});

app.post('/api/studio/v3/receipts', studioGuard, async (req, res) => {
  const { invoiceNo = '', ref = '', customerPhone = '', amount = 0, method = 'Cash', notes = '', notify = false } = req.body || {};
  const receiptNo = v3NextNo('RCT');

  db.prepare(`INSERT INTO studio_receipts (receipt_no, invoice_no, ref, customer_phone, amount, method, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)`)
    .run(receiptNo, invoiceNo, ref, customerPhone, Number(amount || 0), method, notes, now(), now());

  if (invoiceNo) db.prepare(`UPDATE studio_invoices SET status='paid', updated_at=? WHERE invoice_no=?`).run(now(), invoiceNo);

  if (notify && customerPhone) {
    await sendText(customerPhone,
` Payment Receipt

Receipt: ${receiptNo}
${invoiceNo ? `Invoice: ${invoiceNo}\n` : ''}Amount: $${Number(amount || 0).toFixed(2)}
Method: ${method}

Thank you.`
    );
  }

  res.json({ ok: true, receiptNo });
});

// VP_SMART_STOCK_AUTOMATIC_QUOTATION_V3_QUOTE84
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_no TEXT NOT NULL UNIQUE,
      job_no TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      notes TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending',
      request_id TEXT NOT NULL,
      ycloud_message_id TEXT,
      ycloud_response TEXT,
      actor TEXT NOT NULL DEFAULT 'studio',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      failed_at TEXT,
      error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_quotations_request ON job_quotations(job_no, request_id);
    CREATE INDEX IF NOT EXISTS idx_job_quotations_job ON job_quotations(job_no, id DESC);
  `);
  const quoteCols = db.prepare('PRAGMA table_info(job_quotations)').all().map(row => row.name);
  const ensureQuoteCol = (name, definition) => {
    if (!quoteCols.includes(name)) db.prepare(`ALTER TABLE job_quotations ADD COLUMN ${name} ${definition}`).run();
  };
  ensureQuoteCol('part_id', 'INTEGER');
  ensureQuoteCol('part_sku', 'TEXT');
  ensureQuoteCol('part_name', 'TEXT');
  ensureQuoteCol('pdf_url', 'TEXT');
  ensureQuoteCol('pdf_path', 'TEXT');
  ensureQuoteCol('match_status', 'TEXT');
  ensureQuoteCol('stock_committed_at', 'TEXT');
  ensureQuoteCol('quantity', 'INTEGER DEFAULT 1');
  ensureQuoteCol('unit_price', 'REAL');
  ensureQuoteCol('tax_rate', 'REAL DEFAULT 0');
  ensureQuoteCol('subtotal', 'REAL');
  ensureQuoteCol('tax_amount', 'REAL');
  ensureQuoteCol('grand_total', 'REAL');
} catch (e) {
  console.error('JOB_QUOTATIONS_TABLE_ERROR:', e.message);
}

function vpQuoteCleanText(value, max = 1200) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function vpMoney(value) {
  const n = Number(value || 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function vpQuotePricingFromBody(body = {}) {
  const structured = body.unitPrice !== undefined || body.quantity !== undefined || body.taxRate !== undefined;
  if (!structured) {
    const legacy = vpMoney(Number(body.amount || 0));
    return { quantity: 1, unitPrice: legacy, taxRate: 0, subtotal: legacy, taxAmount: 0, grandTotal: legacy, structured: false };
  }
  const quantityRaw = Number(body.quantity ?? 1);
  const unitPrice = vpMoney(Number(body.unitPrice ?? 0));
  const taxRate = vpMoney(Number(body.taxRate ?? 15.5));
  const quantity = Number.isInteger(quantityRaw) ? quantityRaw : NaN;
  const subtotal = vpMoney(quantity * unitPrice);
  const taxAmount = vpMoney(subtotal * taxRate / 100);
  const grandTotal = vpMoney(subtotal + taxAmount);
  return { quantity, unitPrice, taxRate, subtotal, taxAmount, grandTotal, structured: true };
}

const VP_QUOTE_BUSINESS = Object.freeze({
  legalName: 'Siltrom Trading T/A Windscreen Fitment Centre',
  address: '163 Saomra Machel Avenue Harare Zimbabwe',
  phones: '0242700750 / 0772315273 / 0772935746',
  emails: 'admin@winfit.co.zw / sales@winfit.co.zw / eliza.accounts@winfit.co.zw',
  tin: '2000011778',
  vat: '220027754',
  bank: 'NMB Bank',
  branch: 'Eastgate',
  accountName: 'Siltrom Trading',
  nostroUsd: '240320387',
  zwg: '240059061',
  defaultVatRate: 15.5
});

function vpQuoteNumber(jobNo) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM job_quotations WHERE job_no=?').get(jobNo);
  return `Q-${jobNo}-${String(Number(row?.c || 0) + 1).padStart(3, '0')}`;
}

function vpQuoteMessage(job, pricing, currency, notes, revised = false, part = null) {
  const heading = revised ? 'REVISED QUOTATION' : 'QUOTATION';
  const productLine = part ? `Product: ${part.name || '-'}${part.sku ? `\nProduct Code: ${part.sku}` : ''}\n` : '';
  const taxLine = pricing.taxRate > 0 ? `VAT ${pricing.taxRate.toFixed(2)}%: ${currency} ${pricing.taxAmount.toFixed(2)}\n` : '';
  return `${heading} - ${job.job_no}\n\nVehicle: ${job.vehicle || '-'}\n${job.reg_no ? `Registration: ${job.reg_no}\n` : ''}Service: ${job.service || '-'}\n${productLine}Quantity: ${pricing.quantity}\nUnit Price: ${currency} ${pricing.unitPrice.toFixed(2)}\nSubtotal: ${currency} ${pricing.subtotal.toFixed(2)}\n${taxLine}GRAND TOTAL: ${currency} ${pricing.grandTotal.toFixed(2)}\n${notes ? `\n${notes}\n` : ''}\nPlease choose an option below.`;
}

function vpQuoteView(row) {
  if (!row) return null;
  const grandTotal = row.grand_total == null ? Number(row.amount || 0) : Number(row.grand_total || 0);
  const subtotal = row.subtotal == null ? grandTotal : Number(row.subtotal || 0);
  return {
    id: row.id,
    quoteNo: row.quote_no,
    jobNo: row.job_no,
    customerPhone: row.customer_phone,
    amount: grandTotal,
    currency: row.currency || 'USD',
    notes: row.notes || '',
    message: row.message || '',
    status: row.status || '',
    messageId: row.ycloud_message_id || '',
    partId: row.part_id == null ? null : Number(row.part_id),
    partSku: row.part_sku || '',
    partName: row.part_name || '',
    pdfUrl: row.pdf_url || '',
    matchStatus: row.match_status || '',
    stockCommittedAt: row.stock_committed_at || '',
    quantity: Number(row.quantity || 1),
    unitPrice: row.unit_price == null ? subtotal : Number(row.unit_price || 0),
    taxRate: Number(row.tax_rate || 0),
    subtotal,
    taxAmount: Number(row.tax_amount || 0),
    grandTotal,
    createdAt: row.created_at || '',
    sentAt: row.sent_at || '',
    failedAt: row.failed_at || '',
    error: row.error || ''
  };
}

async function vpGenerateQuotationPdf({ quoteNo, job, part, pricing, currency, notes, revised = false }) {
  const quoteDir = path.join(PDF_DIR, 'quotations');
  fs.mkdirSync(quoteDir, { recursive: true });
  const filename = `${quoteNo}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  const pdfPath = path.join(quoteDir, filename);
  const pdfUrl = `${BASE_URL}/files/pdfs/quotations/${filename}`;
  const logoPath = path.join(__dirname, 'public', 'branding', 'windscreen-fitment-centre-logo.png');
  const B = VP_QUOTE_BUSINESS;

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 34 });
    const out = fs.createWriteStream(pdfPath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.on('error', reject);
    doc.pipe(out);

    const left = 34;
    const right = 561;
    const width = right - left;

    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, left, 25, { fit: [142, 68] }); } catch (error) { console.error('QUOTE_PDF_LOGO_ERROR', error.message); }
    }

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(B.legalName, 184, 27, { width: 377, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
      .text(B.address, 184, 44, { width: 377, align: 'right' })
      .text(B.phones, 184, 57, { width: 377, align: 'right' })
      .text(B.emails, 184, 70, { width: 377, align: 'right' })
      .text(`TIN No. ${B.tin}   VAT NO. ${B.vat}`, 184, 83, { width: 377, align: 'right' });

    doc.moveTo(left, 104).lineTo(right, 104).strokeColor('#1e3a8a').lineWidth(1.1).stroke();
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f172a').text(revised ? 'Revised Quotation' : 'Quotation', left, 116, { width: 300 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155').text('Quotation#', 374, 118, { width: 78, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#111827').text(quoteNo, 457, 118, { width: 104, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155').text('Date:', 374, 134, { width: 78, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#111827').text(dayjs().format('DD/MM/YYYY'), 457, 134, { width: 104, align: 'right' });

    let y = 160;
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#334155').text('To,', left, y);
    y += 13;
    doc.font('Helvetica-Bold').fontSize(9.7).fillColor('#111827').text(job.customer_name || 'Valued Customer', left, y, { width });
    y += 16;
    if (job.customer_phone) {
      doc.font('Helvetica').fontSize(7.7).fillColor('#475569').text(job.customer_phone, left, y, { width });
      y += 13;
    }
    doc.font('Helvetica').fontSize(8.2).fillColor('#334155').text('Dear Sir/Mam,', left, y);
    y += 15;
    doc.text('Thank you for your valuable inquiry. We are pleased to quote as below', left, y, { width });
    y += 22;

    const c0 = left;
    const c1 = left + 23;
    const c2 = left + 302;
    const c3 = left + 342;
    const c4 = left + 407;
    const c5 = left + 468;
    const c6 = right;
    const headerH = 23;
    doc.rect(left, y, width, headerH).fill('#1e3a8a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.9);
    doc.text('#', c0 + 5, y + 8, { width: 13, align: 'center' });
    doc.text('DESCRIPTION', c1 + 5, y + 8, { width: c2 - c1 - 10 });
    doc.text('QTY', c2 + 3, y + 8, { width: c3 - c2 - 6, align: 'center' });
    doc.text('PRICE', c3 + 3, y + 8, { width: c4 - c3 - 6, align: 'right' });
    doc.text('TAX', c4 + 3, y + 8, { width: c5 - c4 - 6, align: 'right' });
    doc.text('TOTAL', c5 + 3, y + 8, { width: c6 - c5 - 6, align: 'right' });
    y += headerH;

    const description = part?.fitment_description || part?.name || job.service || 'Auto glass service';
    const details = [job.vehicle || '', part?.sku ? `Product Code: ${part.sku}` : '', job.reg_no ? `Registration: ${job.reg_no}` : ''].filter(Boolean).join(' | ');
    const descText = `${part?.name || job.service || 'Quotation Item'}\n${description}${details ? `\n${details}` : ''}`;
    const rowH = Math.max(58, doc.heightOfString(descText, { width: c2 - c1 - 14 }) + 15);
    doc.rect(left, y, width, rowH).fillAndStroke('#ffffff', '#cbd5e1');
    [c1,c2,c3,c4,c5].forEach(x => doc.moveTo(x, y).lineTo(x, y + rowH).strokeColor('#cbd5e1').lineWidth(0.5).stroke());
    doc.font('Helvetica').fontSize(7.8).fillColor('#111827').text('1', c0 + 5, y + 10, { width: 13, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8.1).fillColor('#111827').text(part?.name || job.service || 'Quotation Item', c1 + 6, y + 8, { width: c2 - c1 - 12 });
    doc.font('Helvetica').fontSize(7.1).fillColor('#475569').text(`${description}${details ? `\n${details}` : ''}`, c1 + 6, y + 23, { width: c2 - c1 - 12, lineGap: 1 });
    doc.font('Helvetica').fontSize(7.8).fillColor('#111827').text(String(pricing.quantity), c2 + 3, y + 14, { width: c3 - c2 - 6, align: 'center' });
    doc.text(`$${pricing.unitPrice.toFixed(2)}`, c3 + 3, y + 14, { width: c4 - c3 - 6, align: 'right' });
    doc.text(`$${pricing.taxAmount.toFixed(2)}`, c4 + 3, y + 9, { width: c5 - c4 - 6, align: 'right' });
    doc.fontSize(6.2).fillColor('#64748b').text(`${pricing.taxRate.toFixed(2)}%`, c4 + 3, y + 24, { width: c5 - c4 - 6, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#111827').text(`$${pricing.grandTotal.toFixed(2)}`, c5 + 3, y + 14, { width: c6 - c5 - 6, align: 'right' });
    y += rowH + 7;

    const totalsX = 353;
    const labelW = 112;
    const valueW = 96;
    for (const [label, value] of [['SUB TOTAL', pricing.subtotal], ['TAX', pricing.taxAmount], ['GRAND TOTAL', pricing.grandTotal]]) {
      const grand = label === 'GRAND TOTAL';
      if (grand) doc.rect(totalsX, y - 2, labelW + valueW, 21).fill('#eff6ff');
      doc.font(grand ? 'Helvetica-Bold' : 'Helvetica').fontSize(grand ? 8.8 : 8).fillColor(grand ? '#1e3a8a' : '#334155')
        .text(label, totalsX + 5, y + 4, { width: labelW - 8, align: 'right' });
      doc.font('Helvetica-Bold').fillColor(grand ? '#166534' : '#111827')
        .text(`$${Number(value).toFixed(2)}`, totalsX + labelW, y + 4, { width: valueW - 5, align: 'right' });
      y += 21;
    }

    y += 7;
    doc.font('Helvetica').fontSize(7.8).fillColor('#334155').text('We hope you find our offer to be in line with your requirement.', left, y, { width });
    y += 17;
    if (notes) {
      doc.font('Helvetica-Bold').fontSize(7.7).fillColor('#111827').text('Notes', left, y);
      y += 11;
      const noteH = Math.min(28, doc.heightOfString(notes, { width }));
      doc.font('Helvetica').fontSize(7).fillColor('#475569').text(notes, left, y, { width, height: noteH });
      y += noteH + 7;
    }

    doc.font('Helvetica-Bold').fontSize(8.4).fillColor('#111827').text('PAYMENT INSTRUCTIONS', left, y);
    y += 14;
    doc.font('Helvetica-Bold').fontSize(7.4).fillColor('#1e3a8a').text('NOSTRO USD', left, y);
    doc.text('ZWG', 309, y);
    y += 12;
    doc.font('Helvetica').fontSize(7).fillColor('#334155')
      .text(`Bank Name : ${B.bank}\nBranch ${B.branch}\nAccount Name ${B.accountName}\n${B.nostroUsd}`, left, y, { width: 235, lineGap: 1 })
      .text(`Bank Name: ${B.bank.toUpperCase()}\n${B.branch} Branch\nAccount Name : ${B.accountName}\nAccount No. ${B.zwg}`, 309, y, { width: 246, lineGap: 1 });
    y += 52;

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    y += 11;
    doc.font('Helvetica').fontSize(6.9).fillColor('#475569').text('For, SILTROM TRADING T/A WINDSCREEN FITMENT CENTRE', left, y, { width: 335 });
    doc.font('Helvetica-Bold').fontSize(6.9).fillColor('#111827').text('AUTHORIZED SIGNATURE', 397, y, { width: 164, align: 'right' });

    doc.font('Helvetica').fontSize(6.4).fillColor('#94a3b8').text('Page 1 of 1', left, 782, { width, align: 'right', lineBreak: false });
    doc.end();
  });

  return { filename, pdfPath, pdfUrl };
}

app.get('/api/studio/v3/jobs/:jobNo/quotations', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim().toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
    const quotations = db.prepare('SELECT * FROM job_quotations WHERE job_no=? ORDER BY id DESC LIMIT 50').all(jobNo).map(vpQuoteView);
    return res.json({ ok: true, quotations });
  } catch (e) {
    console.error('JOB_QUOTATIONS_LIST_ERROR:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/jobs/:jobNo/quotation', studioGuard, async (req, res) => {
  const jobNo = String(req.params.jobNo || '').trim().toUpperCase();
  const requestId = vpQuoteCleanText(req.body?.requestId, 120);
  const currency = String(req.body?.currency || 'USD').trim().toUpperCase();
  const pricing = vpQuotePricingFromBody(req.body || {});
  const notes = vpQuoteCleanText(req.body?.notes, 1200);
  const dryRun = req.body?.dryRun === true;
  const partId = Number(req.body?.partId || 0) || null;
  const matchStatus = vpQuoteCleanText(req.body?.matchStatus || (partId ? 'staff_selected' : 'manual'), 80);

  try {
    if (!Number.isInteger(pricing.quantity) || pricing.quantity < 1 || pricing.quantity > 1000) return res.status(400).json({ ok: false, error: 'Enter a valid whole-number quantity.' });
    if (!Number.isFinite(pricing.unitPrice) || pricing.unitPrice <= 0 || pricing.unitPrice > 1000000) return res.status(400).json({ ok: false, error: 'Enter a valid unit price.' });
    if (!Number.isFinite(pricing.taxRate) || pricing.taxRate < 0 || pricing.taxRate > 100) return res.status(400).json({ ok: false, error: 'Enter a valid VAT / tax rate.' });
    if (!Number.isFinite(pricing.grandTotal) || pricing.grandTotal <= 0 || pricing.grandTotal > 100000000) return res.status(400).json({ ok: false, error: 'Quotation total is invalid.' });
    if (currency !== 'USD') return res.status(400).json({ ok: false, error: 'Unsupported quotation currency.' });
    if (!dryRun && !requestId) return res.status(400).json({ ok: false, error: 'Quotation request ID is required.' });

    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
    const customerPhone = String(job.customer_phone || '').trim();
    if (!customerPhone) return res.status(400).json({ ok: false, error: 'This job does not have a customer phone number.' });

    let part = null;
    if (partId) {
      part = db.prepare('SELECT * FROM studio_parts WHERE id=?').get(partId);
      if (!part || Number(part.active || 0) !== 1) return res.status(400).json({ ok: false, error: 'Selected stock item is not active.' });
      if (Number(part.quantity || 0) < pricing.quantity) return res.status(409).json({ ok: false, error: `Selected stock item does not have enough stock. Available: ${Number(part.quantity || 0)}` });
    }

    const previousSent = Number(db.prepare("SELECT COUNT(*) AS c FROM job_quotations WHERE job_no=? AND status='sent'").get(jobNo)?.c || 0);
    const message = vpQuoteMessage(job, pricing, currency, notes, previousSent > 0, part);

    if (dryRun) {
      let pdf = null;
      if (req.body?.generatePdf === true) {
        const previewNo = `PREVIEW-${jobNo}-${Date.now()}`;
        pdf = await vpGenerateQuotationPdf({ quoteNo: previewNo, job, part, pricing, currency, notes, revised: previousSent > 0 });
      }
      return res.json({ ok: true, dryRun: true, preview: { jobNo, customerPhone, customerName: job.customer_name || '', vehicle: job.vehicle || '', service: job.service || '', pricing, currency, notes, message, part: part ? vpPartPublicView(part) : null, pdf } });
    }

    const existing = db.prepare('SELECT * FROM job_quotations WHERE job_no=? AND request_id=? LIMIT 1').get(jobNo, requestId);
    if (existing) return res.json({ ok: true, duplicate: true, quotation: vpQuoteView(existing) });

    const quoteNo = vpQuoteNumber(jobNo);
    const createdAt = now();
    db.prepare(`INSERT INTO job_quotations
      (quote_no, job_no, customer_phone, amount, currency, notes, message, status, request_id, actor, created_at, part_id, part_sku, part_name, match_status, quantity, unit_price, tax_rate, subtotal, tax_amount, grand_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, 'studio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(quoteNo, jobNo, customerPhone, pricing.grandTotal, currency, notes, message, requestId, createdAt, part?.id || null, part?.sku || '', part?.name || '', matchStatus, pricing.quantity, pricing.unitPrice, pricing.taxRate, pricing.subtotal, pricing.taxAmount, pricing.grandTotal);
    const row = db.prepare('SELECT * FROM job_quotations WHERE quote_no=?').get(quoteNo);

    let pdf = null;
    try {
      pdf = await vpGenerateQuotationPdf({ quoteNo, job, part, pricing, currency, notes, revised: previousSent > 0 });
      db.prepare('UPDATE job_quotations SET pdf_url=?, pdf_path=? WHERE id=?').run(pdf.pdfUrl, pdf.pdfPath, row.id);
    } catch (pdfError) {
      db.prepare("UPDATE job_quotations SET status='failed', failed_at=?, error=? WHERE id=?").run(now(), `PDF generation failed: ${pdfError.message}`.slice(0,1000), row.id);
      return res.status(500).json({ ok: false, error: 'The quotation PDF could not be generated. Nothing was sent to the customer.' });
    }

    try {
      const result = await sendButtons(customerPhone, message, [
        { id: `quote_approve_${jobNo}`, title: 'Approve' },
        { id: `quote_question_${jobNo}`, title: 'Ask Question' },
        { id: `quote_decline_${jobNo}`, title: 'Decline' }
      ]);
      await sendDocument(customerPhone, pdf.pdfUrl, pdf.filename, `${previousSent > 0 ? 'Revised quotation' : 'Quotation'} • ${quoteNo} • ${currency} ${pricing.grandTotal.toFixed(2)}`);
      const messageId = String(result?.id || result?.wamid || result?.message?.id || result?.data?.id || '');
      const sentAt = now();
      const data = safeJsonParse(job.data, {});
      Object.assign(data, {
        quoteAmount: pricing.grandTotal,
        quoteCurrency: currency,
        quoteNotes: notes,
        quoteQuantity: pricing.quantity,
        quoteUnitPrice: pricing.unitPrice,
        quoteTaxRate: pricing.taxRate,
        quoteSubtotal: pricing.subtotal,
        quoteTaxAmount: pricing.taxAmount,
        quoteGrandTotal: pricing.grandTotal,
        lastQuoteNo: quoteNo,
        lastQuoteSentAt: sentAt,
        lastQuotePdfUrl: pdf.pdfUrl,
        quotedPartId: part?.id || null,
        quotedPartSku: part?.sku || '',
        quotedPartName: part?.name || '',
        quoteMatchStatus: matchStatus
      });

      db.transaction(() => {
        db.prepare("UPDATE job_quotations SET status='sent', ycloud_message_id=?, ycloud_response=?, sent_at=?, error=NULL WHERE id=?")
          .run(messageId, JSON.stringify(result || {}).slice(0, 10000), sentAt, row.id);
        db.prepare("UPDATE jobs SET status='quote_sent', quote_amount=?, data=?, updated_at=? WHERE job_no=?")
          .run(String(pricing.grandTotal), JSON.stringify(data), sentAt, jobNo);
        db.prepare("INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, 'quotation_sent', ?, 'studio', ?)")
          .run(jobNo, `${quoteNo} sent: ${currency} ${pricing.grandTotal.toFixed(2)} | Subtotal ${pricing.subtotal.toFixed(2)} | VAT ${pricing.taxRate.toFixed(2)}% = ${pricing.taxAmount.toFixed(2)}${part ? ` | ${part.sku || part.id} ${part.name}` : ' | manual quote'}${notes ? ` | ${notes}` : ''}`, sentAt);
        db.prepare(`INSERT INTO attachments (phone,job_no,claim_no,type,media_id,url,caption,raw,created_at) VALUES (?,?,NULL,'document','',?,?,?,?)`)
          .run(customerPhone, jobNo, pdf.pdfUrl, `Quotation PDF ${quoteNo}`, JSON.stringify({ filename: pdf.filename, mimeType: 'application/pdf', source: 'smart_quotation', quoteNo }), sentAt);
        try {
          db.prepare(`CREATE TABLE IF NOT EXISTS studio_documents (id INTEGER PRIMARY KEY AUTOINCREMENT,ref TEXT,customer_phone TEXT,customer_name TEXT,type TEXT,filename TEXT,mime_type TEXT,url TEXT,source TEXT,created_at TEXT)`).run();
          db.prepare(`INSERT INTO studio_documents (ref,customer_phone,customer_name,type,filename,mime_type,url,source,created_at) VALUES (?,?,?,'document',?,'application/pdf',?,'smart_quotation',?)`)
            .run(jobNo, customerPhone, job.customer_name || 'WhatsApp Customer', pdf.filename, pdf.pdfUrl, sentAt);
        } catch {}
      })();

      return res.json({ ok: true, quotation: vpQuoteView(db.prepare('SELECT * FROM job_quotations WHERE id=?').get(row.id)), record: v3Job(db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo)) });
    } catch (sendError) {
      db.prepare("UPDATE job_quotations SET status='failed', failed_at=?, error=? WHERE id=?")
        .run(now(), String(sendError.message || sendError).slice(0, 1000), row.id);
      console.error('DIRECT_JOB_QUOTATION_SEND_ERROR:', jobNo, sendError.message);
      return res.status(502).json({ ok: false, error: 'The quotation could not be sent to WhatsApp. No job status was changed.' });
    }
  } catch (e) {
    console.error('DIRECT_JOB_QUOTATION_ERROR:', jobNo, e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/message', studioGuard, async (req, res) => {
  const { phone = '', message = '' } = req.body || {};
  if (!phone || !message) return res.status(400).json({ ok: false, error: 'phone and message are required.' });
  await sendText(phone, message);
  res.json({ ok: true });
});

app.post('/api/studio/v3/reset-data', studioGuard, (req, res) => {
  console.warn('STUDIO_PRODUCTION_RESET_BLOCKED', {
    time: new Date().toISOString()
  });

  return res.status(403).json({
    ok: false,
    error: 'Dashboard data reset is disabled in production.'
  });
});




// ==============================
// STUDIO_PHASE_6J_SCHEDULE_FIELDS_PATCHED
// STUDIO_PHASE_6A_OPERATIONAL_BACKEND
// Manual dashboard operations: customers, bookings, quotes, jobs, notes
// ==============================
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      name TEXT,
      vehicle TEXT,
      registration TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS studio_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT,
      type TEXT,
      note TEXT,
      actor TEXT,
      created_at TEXT
    );
  `);
} catch (e) {
  console.error('STUDIO_6A_TABLE_ERROR:', e.message);
}

function studio6Cols(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name);
  } catch (e) {
    return [];
  }
}

function studio6Insert(table, values) {
  const cols = studio6Cols(table);
  const usable = Object.keys(values).filter(k => cols.includes(k));
  if (!usable.length) throw new Error(`No usable columns for ${table}`);

  const sql = `INSERT INTO ${table} (${usable.join(',')}) VALUES (${usable.map(() => '?').join(',')})`;
  return db.prepare(sql).run(...usable.map(k => values[k]));
}

function studio6Update(table, idCol, idVal, values) {
  const cols = studio6Cols(table);
  const usable = Object.keys(values).filter(k => cols.includes(k));
  if (!usable.length) return;

  const sql = `UPDATE ${table} SET ${usable.map(k => `${k}=?`).join(',')} WHERE ${idCol}=?`;
  return db.prepare(sql).run(...usable.map(k => values[k]), idVal);
}

function studio6NextRef(prefix) {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${Date.now().toString().slice(-5)}${rand}`;
}

function studio6UpsertCustomer({ phone, name, vehicle, registration, notes }) {
  if (!phone) throw new Error('Customer phone is required.');

  const existing = db.prepare('SELECT * FROM studio_customers WHERE phone=?').get(phone);

  if (existing) {
    db.prepare(`
      UPDATE studio_customers
      SET name=COALESCE(NULLIF(?, ''), name),
          vehicle=COALESCE(NULLIF(?, ''), vehicle),
          registration=COALESCE(NULLIF(?, ''), registration),
          notes=COALESCE(NULLIF(?, ''), notes),
          updated_at=?
      WHERE phone=?
    `).run(name || '', vehicle || '', registration || '', notes || '', now(), phone);
  } else {
    db.prepare(`
      INSERT INTO studio_customers (phone, name, vehicle, registration, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(phone, name || '', vehicle || '', registration || '', notes || '', now(), now());
  }

  return db.prepare('SELECT * FROM studio_customers WHERE phone=?').get(phone);
}

function studio6CreateJob({ mode, customerPhone, customerName, vehicle, registration, service, location, notes, bookingDate, bookingTime, priority, fitter }) {
  if (!customerPhone) throw new Error('Customer phone is required.');

  studio6UpsertCustomer({
    phone: customerPhone,
    name: customerName,
    vehicle,
    registration,
    notes: ''
  });

  const jobNo = studio6NextRef('JC');
  const status =
    mode === 'quote' ? 'quote_requested' :
    mode === 'booking' ? 'booked' :
    'new';

  const jobType =
    mode === 'quote' ? 'quote' :
    mode === 'booking' ? 'booking' :
    'job';

  studio6Insert('jobs', {
    job_no: jobNo,
    customer_phone: customerPhone,
    customer_name: customerName || '',
    vehicle: vehicle || '',
    reg_no: registration || '',
    service: service || '',
    job_type: jobType,
    location: location || '',
    status,
    fitter: fitter || '',
    assigned_to: fitter || '',
    booking_date: bookingDate || '',
    data: JSON.stringify({
      source: 'studio_dashboard',
      notes: notes || '',
      bookingDate: bookingDate || '',
      bookingTime: bookingTime || '',
      priority: priority || 'Normal',
      fitter: fitter || ''
    }),
    created_at: now(),
    updated_at: now()
  });

  db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(jobNo, `${jobType}_created`, notes || `${jobType} created from dashboard`, 'studio', now());

  return db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
}

app.post('/api/studio/v3/customers', studioGuard, (req, res) => {
  try {
    const customer = studio6UpsertCustomer({
      phone: req.body?.phone || '',
      name: req.body?.name || '',
      vehicle: req.body?.vehicle || '',
      registration: req.body?.registration || '',
      notes: req.body?.notes || ''
    });

    res.json({ ok: true, customer });
  } catch (e) {
    console.error('STUDIO_6A_CUSTOMER_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/bookings', studioGuard, async (req, res) => {
  try {
    const job = studio6CreateJob({
      mode: 'booking',
      customerPhone: req.body?.customerPhone || '',
      customerName: req.body?.customerName || '',
      vehicle: req.body?.vehicle || '',
      registration: req.body?.registration || '',
      service: req.body?.service || '',
      location: req.body?.location || '',
      notes: req.body?.notes || '',
      bookingDate: req.body?.bookingDate || '',
      bookingTime: req.body?.bookingTime || '',
      priority: req.body?.priority || 'Normal',
      fitter: req.body?.fitter || ''
    });

    let bookingPdf = null;
    try {
      bookingPdf = await vpGenerateBookingConfirmationPdf(
        job.job_no,
        job.customer_phone,
        {
          source: 'studio_dashboard',
          customerPhone: job.customer_phone,
          name: job.customer_name || '',
          vehicle: job.vehicle || '',
          reg: job.reg_no || '',
          service: job.service || '',
          jobType: 'Booking',
          location: job.location || '',
          bookingDate: req.body?.bookingDate || '',
          preferredDate: req.body?.bookingDate || '',
          bookingTime: req.body?.bookingTime || '',
          preferredTime: req.body?.bookingTime || '',
          priority: req.body?.priority || 'Normal',
          idStepComplete: true
        }
      );
    } catch (pdfError) {
      console.error('STUDIO_6A_BOOKING_PDF_ERROR:', job.job_no, pdfError.message);
    }

    const freshJob = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(job.job_no) || job;
    res.json({ ok: true, job: freshJob, bookingPdf });
  } catch (e) {
    console.error('STUDIO_6A_BOOKING_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/quotes', studioGuard, (req, res) => {
  try {
    const job = studio6CreateJob({
      mode: 'quote',
      customerPhone: req.body?.customerPhone || '',
      customerName: req.body?.customerName || '',
      vehicle: req.body?.vehicle || '',
      registration: req.body?.registration || '',
      service: req.body?.service || '',
      location: req.body?.location || '',
      notes: req.body?.notes || '',
      bookingDate: req.body?.bookingDate || '',
      bookingTime: req.body?.bookingTime || '',
      priority: req.body?.priority || 'Normal',
      fitter: req.body?.fitter || ''
    });

    res.json({ ok: true, job });
  } catch (e) {
    console.error('STUDIO_6A_QUOTE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/jobs', studioGuard, (req, res) => {
  try {
    const job = studio6CreateJob({
      mode: 'job',
      customerPhone: req.body?.customerPhone || '',
      customerName: req.body?.customerName || '',
      vehicle: req.body?.vehicle || '',
      registration: req.body?.registration || '',
      service: req.body?.service || '',
      location: req.body?.location || '',
      notes: req.body?.notes || '',
      bookingDate: req.body?.bookingDate || '',
      bookingTime: req.body?.bookingTime || '',
      priority: req.body?.priority || 'Normal',
      fitter: req.body?.fitter || ''
    });

    res.json({ ok: true, job });
  } catch (e) {
    console.error('STUDIO_6A_JOB_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/notes', studioGuard, (req, res) => {
  try {
    const ref = String(req.body?.ref || '').trim();
    const note = String(req.body?.note || '').trim();
    const type = String(req.body?.type || 'general').trim();

    if (!ref || !note) return res.status(400).json({ ok: false, error: 'ref and note are required.' });

    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ref, type, note, 'studio', now());

    res.json({ ok: true });
  } catch (e) {
    console.error('STUDIO_6A_NOTE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6E_GET_NOTES
// ==============================
app.get('/api/studio/v3/notes', studioGuard, (req, res) => {
  try {
    const ref = String(req.query?.ref || '').trim();
    if (!ref) return res.json({ ok: true, notes: [] });

    const notes = db.prepare(`
      SELECT id, ref, type, note, actor, created_at AS createdAt
      FROM studio_notes
      WHERE ref=?
      ORDER BY id DESC
      LIMIT 50
    `).all(ref);

    res.json({ ok: true, notes });
  } catch (e) {
    console.error('STUDIO_6E_GET_NOTES_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6F_JOB_WORKFLOW_ACTIONS
// Quote amount, fitter, invoice, paid, convert to job
// ==============================
function studio6fJob(jobNo) {
  return db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
}

function studio6fPatchJob(jobNo, values) {
  const cols = studio6Cols('jobs');
  const usable = Object.keys(values).filter(k => cols.includes(k));

  if (!usable.length) return;

  const sql = `UPDATE jobs SET ${usable.map(k => `${k}=?`).join(',')} WHERE job_no=?`;
  db.prepare(sql).run(...usable.map(k => values[k]), jobNo);
}

function studio6fNote(ref, type, note) {
  try {
    db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ref, type, note, 'studio', now());
  } catch (e) {
    console.error('STUDIO_6F_NOTE_ERROR:', e.message);
  }
}

app.post('/api/studio/v3/jobs/:jobNo/workflow', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim();
    const action = String(req.body?.action || '').trim();
    const value = req.body?.value;

    if (!jobNo || !action) return res.status(400).json({ ok: false, error: 'jobNo and action are required.' });

    const job = studio6fJob(jobNo);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });

    if (action === 'set_quote_amount') {
      const amount = Number(value || 0);
      studio6fPatchJob(jobNo, {
        quote_amount: amount,
        status: 'quoted',
        updated_at: now()
      });
      studio6fNote(jobNo, 'quote_amount', `Quote amount set to $${amount.toFixed(2)}.`);
      return res.json({ ok: true });
    }

    if (action === 'assign_fitter') {
      const fitter = String(value || '').trim();
      if (!fitter) return res.status(400).json({ ok: false, error: 'Fitter name is required.' });

      studio6fPatchJob(jobNo, {
        fitter,
        assigned_to: fitter,
        status: 'assigned',
        updated_at: now()
      });
      studio6fNote(jobNo, 'assigned', `Assigned to ${fitter}.`);
      return res.json({ ok: true });
    }

    if (action === 'invoice_sent') {
      studio6fPatchJob(jobNo, {
        invoice_status: 'sent',
        status: 'invoice_sent',
        updated_at: now()
      });
      studio6fNote(jobNo, 'invoice', 'Invoice marked as sent.');
      return res.json({ ok: true });
    }

    if (action === 'paid') {
      studio6fPatchJob(jobNo, {
        invoice_status: 'paid',
        status: 'paid',
        updated_at: now()
      });
      studio6fNote(jobNo, 'payment', 'Payment marked as received.');
      return res.json({ ok: true });
    }

    if (action === 'convert_to_job') {
      studio6fPatchJob(jobNo, {
        job_type: 'job',
        status: 'new',
        updated_at: now()
      });
      studio6fNote(jobNo, 'converted', 'Converted into active workshop job.');
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown workflow action.' });
  } catch (e) {
    console.error('STUDIO_6F_WORKFLOW_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6N_ACTIVITY_LOG_ENDPOINT
// Dashboard activity / audit trail
// ==============================
app.get('/api/studio/v3/activity', studioGuard, (req, res) => {
  try {
    const limit = Math.min(Number(req.query?.limit || 250), 1000);

    const rows = db.prepare(`
      SELECT
        id,
        ref,
        type,
        note,
        actor,
        created_at AS createdAt
      FROM studio_notes
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);

    res.json({ ok: true, activity: rows || [] });
  } catch (e) {
    console.error('STUDIO_6N_ACTIVITY_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6O_TEAM_FITTERS_ENDPOINTS
// Team / fitters management
// ==============================
db.prepare(`
  CREATE TABLE IF NOT EXISTS studio_fitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    role TEXT,
    active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT
  )
`).run();

app.get('/api/studio/v3/fitters', studioGuard, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        id,
        name,
        phone,
        role,
        active,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM studio_fitters
      ORDER BY active DESC, name COLLATE NOCASE ASC
    `).all();

    res.json({ ok: true, fitters: rows || [] });
  } catch (e) {
    console.error('STUDIO_6O_FITTERS_LIST_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/fitters', studioGuard, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const role = String(req.body?.role || 'Fitter').trim();
    const notes = String(req.body?.notes || '').trim();

    if (!name) return res.status(400).json({ ok: false, error: 'Name is required.' });

    const result = db.prepare(`
      INSERT INTO studio_fitters (name, phone, role, active, notes, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `).run(name, phone, role, notes, now(), now());

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`FITTER-${result.lastInsertRowid}`, 'team', `Team member added: ${name} (${role}).`, 'studio', now());
    } catch {}

    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('STUDIO_6O_FITTER_CREATE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/fitters/:id/status', studioGuard, (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = Number(req.body?.active ? 1 : 0);

    db.prepare('UPDATE studio_fitters SET active=?, updated_at=? WHERE id=?').run(active, now(), id);

    const fitter = db.prepare('SELECT * FROM studio_fitters WHERE id=?').get(id);
    if (fitter) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(`FITTER-${id}`, 'team', `${fitter.name} marked as ${active ? 'active' : 'inactive'}.`, 'studio', now());
      } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('STUDIO_6O_FITTER_STATUS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6Q_PARTS_INVENTORY_ENDPOINTS
// Parts / inventory management
// ==============================
db.prepare(`
  CREATE TABLE IF NOT EXISTS studio_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    sku TEXT,
    category TEXT,
    quantity REAL DEFAULT 0,
    low_stock REAL DEFAULT 1,
    supplier TEXT,
    cost_price REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT
  )
`).run();

// VP_SMART_STOCK_FITMENT_SCHEMA_V1
function vpEnsureStudioPartColumn(name, definition) {
  const cols = db.prepare('PRAGMA table_info(studio_parts)').all().map(row => row.name);
  if (!cols.includes(name)) db.prepare(`ALTER TABLE studio_parts ADD COLUMN ${name} ${definition}`).run();
}

vpEnsureStudioPartColumn('vehicle_make', 'TEXT');
vpEnsureStudioPartColumn('vehicle_model', 'TEXT');
vpEnsureStudioPartColumn('model_aliases', 'TEXT');
vpEnsureStudioPartColumn('year_from', 'INTEGER');
vpEnsureStudioPartColumn('year_to', 'INTEGER');
vpEnsureStudioPartColumn('glass_position', 'TEXT');
vpEnsureStudioPartColumn('fitment_description', 'TEXT');
vpEnsureStudioPartColumn('smart_quote_enabled', 'INTEGER DEFAULT 1');

db.prepare('CREATE INDEX IF NOT EXISTS idx_studio_parts_vehicle_fitment ON studio_parts(active, smart_quote_enabled, vehicle_make, vehicle_model, year_from, year_to)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_studio_parts_sku ON studio_parts(sku)').run();

function vpSmartNorm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function vpSmartTokens(value) {
  const stop = new Set(['vehicle','model','year','windscreen','windshield','glass','screen','replacement','replace','front','rear','auto','the','for']);
  return vpSmartNorm(value).split(' ').filter(token => token && !stop.has(token));
}

function vpVehicleYears(value) {
  return [...String(value || '').matchAll(/\b((?:19|20)\d{2})\b/g)]
    .map(match => Number(match[1]))
    .filter(year => year >= 1900 && year <= 2100);
}

function vpPhraseMatch(vehicleNorm, vehicleTokens, phrase) {
  const norm = vpSmartNorm(phrase);
  if (!norm) return { matched: false, ratio: 0, mode: 'missing' };
  if (vehicleNorm.includes(norm)) return { matched: true, ratio: 1, mode: 'phrase' };
  const tokens = vpSmartTokens(norm);
  if (!tokens.length) return { matched: false, ratio: 0, mode: 'missing' };
  const matchedCount = tokens.filter(token => vehicleTokens.includes(token)).length;
  const ratio = matchedCount / tokens.length;
  return { matched: ratio >= 0.6 && matchedCount >= 1, ratio, mode: 'tokens' };
}

function vpPartPublicView(row) {
  return {
    id: row.id,
    name: row.name || '',
    sku: row.sku || '',
    category: row.category || '',
    quantity: Number(row.quantity || 0),
    lowStock: Number(row.low_stock || 0),
    supplier: row.supplier || '',
    costPrice: Number(row.cost_price || 0),
    sellingPrice: Number(row.selling_price || 0),
    active: Number(row.active || 0),
    notes: row.notes || '',
    vehicleMake: row.vehicle_make || '',
    vehicleModel: row.vehicle_model || '',
    modelAliases: row.model_aliases || '',
    yearFrom: row.year_from == null ? null : Number(row.year_from),
    yearTo: row.year_to == null ? null : Number(row.year_to),
    glassPosition: row.glass_position || '',
    fitmentDescription: row.fitment_description || '',
    smartQuoteEnabled: Number(row.smart_quote_enabled ?? 1),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function vpSmartQuoteForJobRow(job) {
  if (!job) return { status: 'manual_required', reason: 'Job not found.', candidates: [] };
  const vehicle = String(job.vehicle || '').trim();
  const service = String(job.service || '').trim();
  if (!vehicle) return { status: 'manual_required', reason: 'Vehicle description is missing.', vehicle, service, candidates: [] };

  const vehicleNorm = vpSmartNorm(vehicle);
  const vehicleTokens = vpSmartTokens(vehicle);
  const years = vpVehicleYears(vehicle);
  const jobYear = years[0] || null;
  const serviceNorm = vpSmartNorm(service);
  const rows = db.prepare(`
    SELECT * FROM studio_parts
    WHERE active=1 AND COALESCE(smart_quote_enabled,1)=1
      AND COALESCE(vehicle_make,'')<>''
      AND COALESCE(vehicle_model,'')<>''
    ORDER BY id ASC
  `).all();

  const candidates = [];
  for (const row of rows) {
    const make = vpPhraseMatch(vehicleNorm, vehicleTokens, row.vehicle_make);
    if (!make.matched) continue;

    const variants = [row.vehicle_model, ...String(row.model_aliases || '').split(/[;,|]/)]
      .map(x => String(x || '').trim()).filter(Boolean);
    let bestModel = { matched: false, ratio: 0, mode: 'missing', label: '' };
    for (const variant of variants) {
      const result = vpPhraseMatch(vehicleNorm, vehicleTokens, variant);
      if (result.matched && result.ratio >= bestModel.ratio) bestModel = { ...result, label: variant };
    }
    if (!bestModel.matched) continue;

    const from = row.year_from == null || row.year_from === '' ? null : Number(row.year_from);
    const to = row.year_to == null || row.year_to === '' ? from : Number(row.year_to);
    let yearStatus = 'not_required';
    if (from || to) {
      if (!jobYear) yearStatus = 'unknown';
      else if (jobYear >= Number(from || to) && jobYear <= Number(to || from)) yearStatus = 'matched';
      else continue;
    }

    let serviceScore = 0;
    const categoryNorm = vpSmartNorm(row.category);
    const positionNorm = vpSmartNorm(row.glass_position);
    if (serviceNorm.includes('windscreen') && (categoryNorm.includes('windscreen') || positionNorm.includes('windscreen'))) serviceScore = 10;
    else if (serviceNorm.includes('rear') && (categoryNorm.includes('rear') || positionNorm.includes('rear'))) serviceScore = 10;
    else if ((serviceNorm.includes('side') || serviceNorm.includes('door')) && (categoryNorm.includes('side') || positionNorm.includes('door'))) serviceScore = 10;

    const score = 40 + Math.round(bestModel.ratio * 35) + (yearStatus === 'matched' ? 20 : yearStatus === 'not_required' ? 8 : 0) + serviceScore + (Number(row.quantity || 0) > 0 ? 5 : 0);
    candidates.push({
      ...vpPartPublicView(row),
      score,
      match: {
        make: row.vehicle_make || '',
        model: bestModel.label || row.vehicle_model || '',
        year: jobYear,
        yearStatus,
        serviceMatched: serviceScore > 0
      }
    });
  }

  candidates.sort((a,b) => b.score - a.score || Number(b.quantity||0) - Number(a.quantity||0) || Number(a.id)-Number(b.id));
  const exact = candidates.filter(c => c.match.yearStatus === 'matched' && Number(c.sellingPrice || 0) > 0);
  let status = 'manual_required';
  let reason = 'No stock item safely matched this vehicle. Manual quotation required.';
  let recommended = null;

  if (exact.length === 1) {
    recommended = exact[0];
    if (Number(recommended.quantity || 0) <= 0) {
      status = 'out_of_stock';
      reason = 'Exact product match found, but it is currently out of stock.';
    } else {
      status = 'exact_match';
      reason = 'One exact make/model/year match was found in stock.';
    }
  } else if (exact.length > 1) {
    status = 'needs_selection';
    recommended = exact[0];
    reason = 'More than one exact stock item matches. Staff selection is required.';
  } else if (candidates.length === 1) {
    recommended = candidates[0];
    if (Number(recommended.sellingPrice || 0) <= 0) {
      status = 'manual_required';
      reason = 'A possible product was found, but no selling price is configured.';
    } else if (Number(recommended.quantity || 0) <= 0) {
      status = 'out_of_stock';
      reason = 'A possible product was found, but it is out of stock.';
    } else {
      status = 'review_required';
      reason = jobYear ? 'Possible match found; staff review is required.' : 'Vehicle year is missing, so staff review is required before quoting.';
    }
  } else if (candidates.length > 1) {
    status = 'needs_selection';
    recommended = candidates[0];
    reason = jobYear ? 'Several possible stock matches were found.' : 'Several possible matches were found and the vehicle year is missing.';
  }

  return {
    status,
    reason,
    vehicle,
    service,
    detectedYear: jobYear,
    recommended,
    candidates: candidates.slice(0, 12),
    generatedAt: now()
  };
}

function vpRefreshSmartQuoteDraftForJob(jobNo) {
  const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
  if (!job) return { status: 'manual_required', reason: 'Job not found.', candidates: [] };
  const result = vpSmartQuoteForJobRow(job);
  const data = safeJsonParse(job.data, {});
  data.smartQuoteDraft = {
    status: result.status,
    reason: result.reason,
    detectedYear: result.detectedYear,
    recommended: result.recommended ? {
      id: result.recommended.id,
      sku: result.recommended.sku,
      name: result.recommended.name,
      sellingPrice: result.recommended.sellingPrice,
      quantity: result.recommended.quantity,
      vehicleMake: result.recommended.vehicleMake,
      vehicleModel: result.recommended.vehicleModel,
      yearFrom: result.recommended.yearFrom,
      yearTo: result.recommended.yearTo,
      glassPosition: result.recommended.glassPosition
    } : null,
    generatedAt: result.generatedAt
  };
  db.prepare('UPDATE jobs SET data=?, updated_at=updated_at WHERE job_no=?').run(JSON.stringify(data), jobNo);
  return result;
}

function vpCsvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i=0; i<input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i+1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(v => String(v).trim())) rows.push(row); row=[]; field=''; }
      else field += ch;
    }
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some(v => String(v).trim())) rows.push(row);
  return rows;
}

function vpImportHeaderKey(value) {
  return vpSmartNorm(value).replace(/ /g, '');
}

function vpStockImportObject(raw) {
  const map = {};
  for (const [key,value] of Object.entries(raw || {})) map[vpImportHeaderKey(key)] = value;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = map[vpImportHeaderKey(key)];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
  };
  const make = String(pick('Vehicle Make','Make','Car Make') || '').trim();
  const model = String(pick('Vehicle Model','Model','Car Model') || '').trim();
  const yearFromRaw = pick('Year From','From Year','Start Year','Year Start');
  const yearToRaw = pick('Year To','To Year','End Year','Year End');
  const yearFrom = Number(yearFromRaw || 0) || null;
  const yearTo = Number(yearToRaw || yearFrom || 0) || null;
  const glassPosition = String(pick('Glass Position','Position','Glass Type','Glass') || '').trim();
  const category = String(pick('Category','Type') || (glassPosition || 'Windscreen')).trim();
  const sku = String(pick('SKU','Product Code','Stock Code','Code') || '').trim();
  const description = String(pick('Description','Product Description','Fitment Description') || '').trim();
  const suppliedName = String(pick('Name','Part Name','Product Name') || '').trim();
  const name = suppliedName || [make, model, yearFrom && yearTo ? `${yearFrom}-${yearTo}` : '', glassPosition || category].filter(Boolean).join(' ');
  const activeRaw = vpSmartNorm(pick('Active','Status') || 'yes');
  const smartRaw = vpSmartNorm(pick('Smart Quote','Smart Quote Enabled','Auto Quote') || (make && model ? 'yes' : 'no'));
  return {
    name,
    sku,
    category,
    quantity: Number(pick('Quantity','Stock','Stock Quantity','Qty') || 0) || 0,
    lowStock: Number(pick('Low Stock','Low Stock Alert','Minimum Stock') || 1) || 0,
    supplier: String(pick('Supplier') || '').trim(),
    costPrice: Number(pick('Cost Price','Cost','Buying Price') || 0) || 0,
    sellingPrice: Number(pick('Selling Price','Price','Sale Price') || 0) || 0,
    notes: String(pick('Notes','Note') || '').trim(),
    vehicleMake: make,
    vehicleModel: model,
    modelAliases: String(pick('Model Aliases','Aliases','Chassis Code','Alternative Model') || '').trim(),
    yearFrom,
    yearTo,
    glassPosition,
    fitmentDescription: description,
    active: ['no','inactive','false','0','disabled','discontinued'].includes(activeRaw) ? 0 : 1,
    smartQuoteEnabled: ['no','false','0','disabled'].includes(smartRaw) ? 0 : 1
  };
}

function vpUpsertImportedStockItem(item, dryRun = false) {
  if (!item.name) return { action: 'skipped', error: 'Missing part/product name.' };
  let existing = null;
  if (item.sku) existing = db.prepare('SELECT * FROM studio_parts WHERE lower(trim(sku))=lower(trim(?)) LIMIT 1').get(item.sku);
  if (!existing && item.vehicleMake && item.vehicleModel && item.yearFrom) {
    existing = db.prepare(`SELECT * FROM studio_parts WHERE lower(trim(vehicle_make))=lower(trim(?)) AND lower(trim(vehicle_model))=lower(trim(?)) AND COALESCE(year_from,0)=? AND COALESCE(year_to,0)=? AND lower(trim(COALESCE(glass_position,'')))=lower(trim(?)) LIMIT 1`)
      .get(item.vehicleMake, item.vehicleModel, Number(item.yearFrom||0), Number(item.yearTo||item.yearFrom||0), item.glassPosition || '');
  }
  if (dryRun) return { action: existing ? 'update' : 'insert', id: existing?.id || null };

  if (existing) {
    db.prepare(`UPDATE studio_parts SET name=?, sku=?, category=?, quantity=?, low_stock=?, supplier=?, cost_price=?, selling_price=?, active=?, notes=?, vehicle_make=?, vehicle_model=?, model_aliases=?, year_from=?, year_to=?, glass_position=?, fitment_description=?, smart_quote_enabled=?, updated_at=? WHERE id=?`)
      .run(item.name, item.sku, item.category, item.quantity, item.lowStock, item.supplier, item.costPrice, item.sellingPrice, item.active, item.notes, item.vehicleMake, item.vehicleModel, item.modelAliases, item.yearFrom, item.yearTo, item.glassPosition, item.fitmentDescription, item.smartQuoteEnabled, now(), existing.id);
    return { action: 'update', id: existing.id };
  }
  const result = db.prepare(`INSERT INTO studio_parts (name,sku,category,quantity,low_stock,supplier,cost_price,selling_price,active,notes,vehicle_make,vehicle_model,model_aliases,year_from,year_to,glass_position,fitment_description,smart_quote_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(item.name, item.sku, item.category, item.quantity, item.lowStock, item.supplier, item.costPrice, item.sellingPrice, item.active, item.notes, item.vehicleMake, item.vehicleModel, item.modelAliases, item.yearFrom, item.yearTo, item.glassPosition, item.fitmentDescription, item.smartQuoteEnabled, now(), now());
  return { action: 'insert', id: result.lastInsertRowid };
}

async function vpParseStockImport(fileName, buffer) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.csv')) {
    const matrix = vpCsvRows(buffer.toString('utf8'));
    if (matrix.length < 2) return [];
    const headers = matrix[0].map(String);
    return matrix.slice(1).map(cells => Object.fromEntries(headers.map((h,i) => [h, cells[i] ?? ''])));
  }
  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col-1] = String(cell.text || '').trim(); });
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      let has = false;
      headers.forEach((header, i) => {
        const value = row.getCell(i+1).text;
        obj[header || `Column${i+1}`] = value;
        if (String(value || '').trim()) has = true;
      });
      if (has) rows.push(obj);
    });
    return rows;
  }
  throw new Error('Only CSV and XLSX files are supported.');
}

function vpPartInput(body = {}) {
  const vehicleMake = String(body.vehicleMake || '').trim();
  const vehicleModel = String(body.vehicleModel || '').trim();
  const yearFromRaw = body.yearFrom === '' || body.yearFrom == null ? null : Number(body.yearFrom);
  const yearToRaw = body.yearTo === '' || body.yearTo == null ? yearFromRaw : Number(body.yearTo);
  const yearFrom = Number.isFinite(yearFromRaw) && yearFromRaw >= 1900 && yearFromRaw <= 2100 ? yearFromRaw : null;
  const yearTo = Number.isFinite(yearToRaw) && yearToRaw >= 1900 && yearToRaw <= 2100 ? yearToRaw : yearFrom;
  const glassPosition = String(body.glassPosition || '').trim();
  const category = String(body.category || 'Windscreen').trim();
  const suppliedName = String(body.name || '').trim();
  const name = suppliedName || [vehicleMake, vehicleModel, yearFrom && yearTo ? `${yearFrom}-${yearTo}` : '', glassPosition || category].filter(Boolean).join(' ');
  const activeValue = vpSmartNorm(body.active);
  const smartValue = vpSmartNorm(body.smartQuoteEnabled);
  const active = body.active === undefined
    ? 1
    : Number(body.active === true || body.active === 1 || ['1','yes','true','active','enabled','on'].includes(activeValue));
  const smartQuoteEnabled = body.smartQuoteEnabled === undefined
    ? Number(Boolean(vehicleMake && vehicleModel))
    : Number(body.smartQuoteEnabled === true || body.smartQuoteEnabled === 1 || ['1','yes','true','active','enabled','on'].includes(smartValue));
  return {
    name,
    sku: String(body.sku || '').trim(),
    category,
    quantity: Math.max(0, Number(body.quantity || 0) || 0),
    lowStock: Math.max(0, Number(body.lowStock ?? 1) || 0),
    supplier: String(body.supplier || '').trim(),
    costPrice: Math.max(0, Number(body.costPrice || 0) || 0),
    sellingPrice: Math.max(0, Number(body.sellingPrice || 0) || 0),
    notes: String(body.notes || '').trim(),
    vehicleMake,
    vehicleModel,
    modelAliases: String(body.modelAliases || '').trim(),
    yearFrom,
    yearTo,
    glassPosition,
    fitmentDescription: String(body.fitmentDescription || '').trim(),
    active,
    smartQuoteEnabled
  };
}

app.get('/api/studio/v3/parts', studioGuard, (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM studio_parts ORDER BY active DESC, name COLLATE NOCASE ASC`).all().map(vpPartPublicView);
    res.json({ ok: true, parts: rows || [] });
  } catch (e) {
    console.error('STUDIO_6Q_PARTS_LIST_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/parts', studioGuard, (req, res) => {
  try {
    const item = vpPartInput(req.body || {});
    if (!item.name) return res.status(400).json({ ok: false, error: 'Part / glass name is required.' });
    if (item.yearFrom && item.yearTo && item.yearFrom > item.yearTo) return res.status(400).json({ ok: false, error: 'Year From cannot be later than Year To.' });
    if (item.sku && db.prepare('SELECT id FROM studio_parts WHERE lower(trim(sku))=lower(trim(?)) LIMIT 1').get(item.sku)) {
      return res.status(409).json({ ok: false, error: 'A stock item with this SKU / product code already exists.' });
    }
    const result = db.prepare(`
      INSERT INTO studio_parts
      (name, sku, category, quantity, low_stock, supplier, cost_price, selling_price, active, notes, vehicle_make, vehicle_model, model_aliases, year_from, year_to, glass_position, fitment_description, smart_quote_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.name, item.sku, item.category, item.quantity, item.lowStock, item.supplier, item.costPrice, item.sellingPrice, item.active, item.notes, item.vehicleMake, item.vehicleModel, item.modelAliases, item.yearFrom, item.yearTo, item.glassPosition, item.fitmentDescription, item.smartQuoteEnabled, now(), now());
    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`PART-${result.lastInsertRowid}`, 'inventory', `Stock item added: ${item.name}. Opening stock: ${item.quantity}.`, 'studio', now());
    } catch {}
    res.json({ ok: true, id: result.lastInsertRowid, part: vpPartPublicView(db.prepare('SELECT * FROM studio_parts WHERE id=?').get(result.lastInsertRowid)) });
  } catch (e) {
    console.error('STUDIO_SMART_PART_CREATE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/studio/v3/parts/:id', studioGuard, (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const existing = db.prepare('SELECT * FROM studio_parts WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Stock item not found.' });
    const current = vpPartPublicView(existing);
    const item = vpPartInput({
      ...current,
      ...req.body,
      active: req.body?.active === undefined ? current.active : req.body.active,
      smartQuoteEnabled: req.body?.smartQuoteEnabled === undefined ? current.smartQuoteEnabled : req.body.smartQuoteEnabled
    });
    if (!item.name) return res.status(400).json({ ok: false, error: 'Part / glass name is required.' });
    if (item.yearFrom && item.yearTo && item.yearFrom > item.yearTo) return res.status(400).json({ ok: false, error: 'Year From cannot be later than Year To.' });
    if (item.sku) {
      const duplicate = db.prepare('SELECT id FROM studio_parts WHERE lower(trim(sku))=lower(trim(?)) AND id<>? LIMIT 1').get(item.sku, id);
      if (duplicate) return res.status(409).json({ ok: false, error: 'Another stock item already uses this SKU / product code.' });
    }
    db.prepare(`UPDATE studio_parts SET name=?,sku=?,category=?,quantity=?,low_stock=?,supplier=?,cost_price=?,selling_price=?,active=?,notes=?,vehicle_make=?,vehicle_model=?,model_aliases=?,year_from=?,year_to=?,glass_position=?,fitment_description=?,smart_quote_enabled=?,updated_at=? WHERE id=?`)
      .run(item.name,item.sku,item.category,item.quantity,item.lowStock,item.supplier,item.costPrice,item.sellingPrice,item.active,item.notes,item.vehicleMake,item.vehicleModel,item.modelAliases,item.yearFrom,item.yearTo,item.glassPosition,item.fitmentDescription,item.smartQuoteEnabled,now(),id);
    const stockChanged = Number(existing.quantity || 0) !== Number(item.quantity || 0);
    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`PART-${id}`, 'inventory', `Stock item updated: ${item.name}.${stockChanged ? ` Quantity ${Number(existing.quantity||0)} → ${item.quantity}.` : ''}`, 'studio', now());
    } catch {}
    res.json({ ok: true, part: vpPartPublicView(db.prepare('SELECT * FROM studio_parts WHERE id=?').get(id)) });
  } catch (e) {
    console.error('STUDIO_SMART_PART_UPDATE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/parts/import', studioGuard, async (req, res) => {
  try {
    const fileName = String(req.body?.fileName || '').trim();
    const contentBase64 = String(req.body?.contentBase64 || '').trim();
    const dryRun = req.body?.dryRun === true;
    if (!fileName || !contentBase64) return res.status(400).json({ ok: false, error: 'Import file is required.' });
    if (!/\.(csv|xlsx)$/i.test(fileName)) return res.status(400).json({ ok: false, error: 'Only CSV and XLSX files are supported.' });
    if (contentBase64.length > 25 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Import file is too large.' });
    const buffer = Buffer.from(contentBase64, 'base64');
    const rawRows = await vpParseStockImport(fileName, buffer);
    const items = rawRows.map(vpStockImportObject).filter(item => item.name);
    if (!items.length) return res.status(400).json({ ok: false, error: 'No usable stock rows were found in the file.' });
    const summary = { total: items.length, inserted: 0, updated: 0, skipped: 0, errors: [] };
    const apply = db.transaction(() => {
      items.forEach((item, index) => {
        try {
          const result = vpUpsertImportedStockItem(item, dryRun);
          if (result.action === 'insert') summary.inserted++;
          else if (result.action === 'update') summary.updated++;
          else summary.skipped++;
          if (result.error) summary.errors.push({ row: index + 2, error: result.error });
        } catch (error) {
          summary.skipped++;
          summary.errors.push({ row: index + 2, error: error.message });
        }
      });
    });
    apply();
    if (!dryRun) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('STOCK-CATALOGUE', 'inventory_import', `Imported ${fileName}: ${summary.inserted} inserted, ${summary.updated} updated, ${summary.skipped} skipped.`, 'studio', now());
      } catch {}
    }
    res.json({ ok: true, dryRun, summary, sample: items.slice(0,5) });
  } catch (e) {
    console.error('STUDIO_SMART_STOCK_IMPORT_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/studio/v3/jobs/:jobNo/smart-quote', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim().toUpperCase();
    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });
    const match = vpRefreshSmartQuoteDraftForJob(jobNo);
    res.json({ ok: true, match });
  } catch (e) {
    console.error('SMART_QUOTE_MATCH_ENDPOINT_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/parts/:id/adjust', studioGuard, (req, res) => {
  try {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount || 0);
    const reason = String(req.body?.reason || 'Stock adjustment').trim();

    const part = db.prepare('SELECT * FROM studio_parts WHERE id=?').get(id);
    if (!part) return res.status(404).json({ ok: false, error: 'Part not found.' });

    const nextQty = Number(part.quantity || 0) + amount;
    if (nextQty < 0) return res.status(400).json({ ok: false, error: `Not enough stock. Available: ${Number(part.quantity || 0)}` });

    db.prepare('UPDATE studio_parts SET quantity=?, updated_at=? WHERE id=?')
      .run(nextQty, now(), id);

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`PART-${id}`, 'inventory', `${reason}. Adjustment: ${amount}. New stock: ${nextQty}.`, 'studio', now());
    } catch {}

    res.json({ ok: true, quantity: nextQty });
  } catch (e) {
    console.error('STUDIO_6Q_PART_ADJUST_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/parts/:id/status', studioGuard, (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = Number(req.body?.active ? 1 : 0);

    db.prepare('UPDATE studio_parts SET active=?, updated_at=? WHERE id=?').run(active, now(), id);

    res.json({ ok: true });
  } catch (e) {
    console.error('STUDIO_6Q_PART_STATUS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6R_JOB_PARTS_LINK_ENDPOINTS
// Link inventory parts/materials to jobs and reduce stock
// ==============================
db.prepare(`
  CREATE TABLE IF NOT EXISTS studio_job_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_no TEXT,
    part_id INTEGER,
    part_name TEXT,
    sku TEXT,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total REAL DEFAULT 0,
    created_at TEXT
  )
`).run();

// VP_QUOTED_STOCK_COMMIT_V1
try {
  const cols = db.prepare('PRAGMA table_info(studio_job_parts)').all().map(row => row.name);
  if (!cols.includes('source_quote_no')) db.prepare('ALTER TABLE studio_job_parts ADD COLUMN source_quote_no TEXT').run();
} catch (error) {
  console.error('JOB_PART_SOURCE_QUOTE_COLUMN_ERROR', error.message);
}

function vpCommitQuotedStock(jobNo) {
  const priorCommit = db.prepare("SELECT * FROM studio_job_parts WHERE job_no=? AND COALESCE(source_quote_no,'')<>'' ORDER BY id DESC LIMIT 1").get(jobNo);
  if (priorCommit) return { ok: true, committed: false, alreadyCommitted: true, reason: `Stock already committed from ${priorCommit.source_quote_no}.` };
  const quote = db.prepare("SELECT * FROM job_quotations WHERE job_no=? AND status='sent' ORDER BY id DESC LIMIT 1").get(jobNo);
  if (!quote || !quote.part_id) return { ok: true, committed: false, reason: 'No stock-linked quotation.' };
  if (quote.stock_committed_at) return { ok: true, committed: false, alreadyCommitted: true, reason: 'Stock already committed.' };
  const part = db.prepare('SELECT * FROM studio_parts WHERE id=?').get(Number(quote.part_id));
  if (!part) return { ok: false, committed: false, reason: 'Quoted stock item no longer exists.' };
  const currentQty = Number(part.quantity || 0);
  const commitQty = Math.max(1, Number(quote.quantity || 1));
  if (currentQty < commitQty) return { ok: false, committed: false, reason: `Not enough stock for the approved quotation. Required: ${commitQty}. Available: ${currentQty}` };
  const committedAt = now();
  const nextQty = currentQty - commitQty;
  const unitPrice = Number(quote.unit_price ?? part.selling_price ?? quote.amount ?? 0);
  const lineTotal = unitPrice * commitQty;
  db.transaction(() => {
    db.prepare(`INSERT INTO studio_job_parts (job_no,part_id,part_name,sku,quantity,unit_price,total,created_at,source_quote_no) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(jobNo, part.id, part.name || '', part.sku || '', commitQty, unitPrice, lineTotal, committedAt, quote.quote_no);
    db.prepare('UPDATE studio_parts SET quantity=?, updated_at=? WHERE id=?').run(nextQty, committedAt, part.id);
    db.prepare('UPDATE job_quotations SET stock_committed_at=? WHERE id=?').run(committedAt, quote.id);
    try {
      db.prepare("INSERT INTO studio_notes (ref,type,note,actor,created_at) VALUES (?,'inventory',?,'bot',?)")
        .run(jobNo, `Quote approved: ${commitQty} x ${part.name || 'stock item'} committed from ${quote.quote_no}. Stock ${currentQty} -> ${nextQty}.`, committedAt);
      db.prepare("INSERT INTO studio_notes (ref,type,note,actor,created_at) VALUES (?,'inventory',?,'bot',?)")
        .run(`PART-${part.id}`, `Committed ${commitQty} unit(s) to approved quote ${quote.quote_no} / job ${jobNo}. Stock ${currentQty} -> ${nextQty}.`, committedAt);
    } catch {}
  })();
  return { ok: true, committed: true, partId: part.id, quoteNo: quote.quote_no, previousQty: currentQty, quantity: nextQty };
}

app.get('/api/studio/v3/jobs/:jobNo/parts', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim();

    const rows = db.prepare(`
      SELECT
        id,
        job_no AS jobNo,
        part_id AS partId,
        part_name AS partName,
        sku,
        quantity,
        unit_price AS unitPrice,
        total,
        source_quote_no AS sourceQuoteNo,
        created_at AS createdAt
      FROM studio_job_parts
      WHERE job_no=?
      ORDER BY id DESC
    `).all(jobNo);

    res.json({ ok: true, parts: rows || [] });
  } catch (e) {
    console.error('STUDIO_6R_JOB_PARTS_LIST_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/jobs/:jobNo/parts', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim();
    const partId = Number(req.body?.partId || 0);
    const qty = Number(req.body?.quantity || 0);

    if (!jobNo || !partId || qty <= 0) {
      return res.status(400).json({ ok: false, error: 'jobNo, partId and quantity are required.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });

    const part = db.prepare('SELECT * FROM studio_parts WHERE id=?').get(partId);
    if (!part) return res.status(404).json({ ok: false, error: 'Part not found.' });

    const currentQty = Number(part.quantity || 0);
    if (currentQty < qty) {
      return res.status(400).json({ ok: false, error: `Not enough stock. Available: ${currentQty}` });
    }

    const unitPrice = Number(part.selling_price || part.cost_price || 0);
    const total = unitPrice * qty;
    const nextQty = currentQty - qty;

    db.prepare(`
      INSERT INTO studio_job_parts
      (job_no, part_id, part_name, sku, quantity, unit_price, total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobNo, partId, part.name || '', part.sku || '', qty, unitPrice, total, now());

    db.prepare('UPDATE studio_parts SET quantity=?, updated_at=? WHERE id=?')
      .run(nextQty, now(), partId);

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(jobNo, 'inventory', `Used ${qty} x ${part.name || 'part'} on job. Stock reduced to ${nextQty}.`, 'studio', now());

      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`PART-${partId}`, 'inventory', `Stock out to job ${jobNo}: ${qty}. New stock: ${nextQty}.`, 'studio', now());
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    console.error('STUDIO_6R_JOB_PART_ADD_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/jobs/:jobNo/parts/:id/remove', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim();
    const id = Number(req.params.id || 0);

    const used = db.prepare('SELECT * FROM studio_job_parts WHERE id=? AND job_no=?').get(id, jobNo);
    if (!used) return res.status(404).json({ ok: false, error: 'Job part record not found.' });

    const part = db.prepare('SELECT * FROM studio_parts WHERE id=?').get(used.part_id);
    const restoreQty = Number(used.quantity || 0);

    if (part) {
      const nextQty = Number(part.quantity || 0) + restoreQty;
      db.prepare('UPDATE studio_parts SET quantity=?, updated_at=? WHERE id=?')
        .run(nextQty, now(), used.part_id);

      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(`PART-${used.part_id}`, 'inventory', `Stock restored from job ${jobNo}: ${restoreQty}. New stock: ${nextQty}.`, 'studio', now());
      } catch {}
    }

    db.prepare('DELETE FROM studio_job_parts WHERE id=? AND job_no=?').run(id, jobNo);

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(jobNo, 'inventory', `Removed ${restoreQty} x ${used.part_name || 'part'} from job and restored stock.`, 'studio', now());
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    console.error('STUDIO_6R_JOB_PART_REMOVE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6S_PAYMENTS_ENDPOINTS
// Payments / invoices tracking
// ==============================
db.prepare(`
  CREATE TABLE IF NOT EXISTS studio_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_no TEXT,
    amount REAL DEFAULT 0,
    method TEXT,
    payment_type TEXT,
    note TEXT,
    created_at TEXT
  )
`).run();

app.get('/api/studio/v3/payments', studioGuard, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        id,
        job_no AS jobNo,
        amount,
        method,
        payment_type AS paymentType,
        note,
        created_at AS createdAt
      FROM studio_payments
      ORDER BY id DESC
      LIMIT 1000
    `).all();

    res.json({ ok: true, payments: rows || [] });
  } catch (e) {
    console.error('STUDIO_6S_PAYMENTS_LIST_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/studio/v3/jobs/:jobNo/payments', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim();

    const rows = db.prepare(`
      SELECT
        id,
        job_no AS jobNo,
        amount,
        method,
        payment_type AS paymentType,
        note,
        created_at AS createdAt
      FROM studio_payments
      WHERE job_no=?
      ORDER BY id DESC
    `).all(jobNo);

    res.json({ ok: true, payments: rows || [] });
  } catch (e) {
    console.error('STUDIO_6S_JOB_PAYMENTS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/jobs/:jobNo/payments', studioGuard, (req, res) => {
  try {
    const jobNo = String(req.params.jobNo || '').trim();
    const amount = Number(req.body?.amount || 0);
    const method = String(req.body?.method || 'Cash').trim();
    const paymentType = String(req.body?.paymentType || 'Payment').trim();
    const note = String(req.body?.note || '').trim();

    if (!jobNo || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'jobNo and valid amount are required.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE job_no=?').get(jobNo);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found.' });

    db.prepare(`
      INSERT INTO studio_payments (job_no, amount, method, payment_type, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jobNo, amount, method, paymentType, note, now());

    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM studio_payments WHERE job_no=?').get(jobNo)?.total || 0;
    const quote = Number(job.quote_amount || 0);

    let nextInvoiceStatus = 'partial';
    let nextStatus = job.status || 'payment_recorded';

    if (quote > 0 && paid >= quote) {
      nextInvoiceStatus = 'paid';
      nextStatus = 'paid';
    }

    const cols = studio6Cols('jobs');
    const updates = {};
    if (cols.includes('invoice_status')) updates.invoice_status = nextInvoiceStatus;
    if (cols.includes('updated_at')) updates.updated_at = now();
    if (cols.includes('status')) updates.status = nextStatus;

    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE jobs SET ${keys.map(k => `${k}=?`).join(',')} WHERE job_no=?`)
        .run(...keys.map(k => updates[k]), jobNo);
    }

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(jobNo, 'payment', `${paymentType} recorded: $${amount.toFixed(2)} via ${method}.${note ? ' ' + note : ''}`, 'studio', now());
    } catch {}

    res.json({ ok: true, paid, balance: Math.max(0, quote - paid) });
  } catch (e) {
    console.error('STUDIO_6S_PAYMENT_CREATE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});




// ==============================
// STUDIO_PHASE_6T_TASKS_ENDPOINTS
// Follow-ups / tasks / reminders
// ==============================
db.prepare(`
  CREATE TABLE IF NOT EXISTS studio_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT,
    customer_phone TEXT,
    title TEXT,
    task_type TEXT,
    assigned_to TEXT,
    due_date TEXT,
    due_time TEXT,
    status TEXT DEFAULT 'open',
    note TEXT,
    created_at TEXT,
    updated_at TEXT
  )
`).run();

app.get('/api/studio/v3/tasks', studioGuard, (req, res) => {
  try {
    const ref = String(req.query?.ref || '').trim();

    const rows = ref
      ? db.prepare(`
          SELECT
            id,
            ref,
            customer_phone AS customerPhone,
            title,
            task_type AS taskType,
            assigned_to AS assignedTo,
            due_date AS dueDate,
            due_time AS dueTime,
            status,
            note,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM studio_tasks
          WHERE ref=?
          ORDER BY status ASC, due_date ASC, due_time ASC, id DESC
        `).all(ref)
      : db.prepare(`
          SELECT
            id,
            ref,
            customer_phone AS customerPhone,
            title,
            task_type AS taskType,
            assigned_to AS assignedTo,
            due_date AS dueDate,
            due_time AS dueTime,
            status,
            note,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM studio_tasks
          ORDER BY status ASC, due_date ASC, due_time ASC, id DESC
          LIMIT 1000
        `).all();

    res.json({ ok: true, tasks: rows || [] });
  } catch (e) {
    console.error('STUDIO_6T_TASKS_LIST_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/tasks', studioGuard, (req, res) => {
  try {
    const ref = String(req.body?.ref || '').trim();
    const customerPhone = String(req.body?.customerPhone || '').trim();
    const title = String(req.body?.title || '').trim();
    const taskType = String(req.body?.taskType || 'Follow Up').trim();
    const assignedTo = String(req.body?.assignedTo || '').trim();
    const dueDate = String(req.body?.dueDate || '').trim();
    const dueTime = String(req.body?.dueTime || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!title) return res.status(400).json({ ok: false, error: 'Task title is required.' });

    const result = db.prepare(`
      INSERT INTO studio_tasks
      (ref, customer_phone, title, task_type, assigned_to, due_date, due_time, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(ref, customerPhone, title, taskType, assignedTo, dueDate, dueTime, note, now(), now());

    try {
      db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(ref || `TASK-${result.lastInsertRowid}`, 'task', `Task created: ${title}${dueDate ? ' due ' + dueDate : ''}${dueTime ? ' at ' + dueTime : ''}.`, 'studio', now());
    } catch {}

    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('STUDIO_6T_TASK_CREATE_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/studio/v3/tasks/:id/status', studioGuard, (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const status = String(req.body?.status || 'open').trim();

    db.prepare('UPDATE studio_tasks SET status=?, updated_at=? WHERE id=?')
      .run(status, now(), id);

    const task = db.prepare('SELECT * FROM studio_tasks WHERE id=?').get(id);

    if (task) {
      try {
        db.prepare('INSERT INTO studio_notes (ref, type, note, actor, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(task.ref || `TASK-${id}`, 'task', `Task marked as ${status}: ${task.title}.`, 'studio', now());
      } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('STUDIO_6T_TASK_STATUS_ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});



// VP_EXTERNAL_JOB_CARDS_BACKEND_V1
const vpExternalKeithTech = require('./integrations/keithstops');
// External workshop job cards received from WhatsApp or entered manually.
// Records remain under staff review until an authorised dashboard user
// completes the required commercial fields and explicitly submits them.

db.exec(`
  CREATE TABLE IF NOT EXISTS external_job_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_ref TEXT UNIQUE NOT NULL,
    source_message_id TEXT,
    source_hash TEXT UNIQUE NOT NULL,
    source_phone TEXT,
    raw_text TEXT NOT NULL,
    parsed_json TEXT NOT NULL DEFAULT '{}',
    review_status TEXT NOT NULL DEFAULT 'needs_review',
    payment_type TEXT NOT NULL DEFAULT 'Review Required',
    payment_reference TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    product_code TEXT,
    product_name TEXT,
    keithstops_customer_id TEXT,
    keithstops_customer_created_at TEXT,
    keithstops_status TEXT NOT NULL DEFAULT 'not_submitted',
    keithstops_reference TEXT,
    keithstops_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS
    idx_external_job_cards_source_hash
    ON external_job_cards(source_hash);

  CREATE INDEX IF NOT EXISTS
    idx_external_job_cards_review_status
    ON external_job_cards(review_status);

  CREATE INDEX IF NOT EXISTS
    idx_external_job_cards_created_at
    ON external_job_cards(created_at);
`);

// VP_EXTERNAL_KTPOS_CUSTOMER_REUSE_V1
function vpExternalEnsureColumn(
  columnName,
  definition
) {
  const columns = db.prepare(`
    PRAGMA table_info(external_job_cards)
  `).all();

  if (
    columns.some(
      column =>
        column.name === columnName
    )
  ) {
    return;
  }

  db.exec(
    `ALTER TABLE external_job_cards ` +
    `ADD COLUMN ${columnName} ${definition}`
  );
}

vpExternalEnsureColumn(
  'keithstops_customer_id',
  'TEXT'
);

vpExternalEnsureColumn(
  'keithstops_customer_created_at',
  'TEXT'
);

// VP_EXTERNAL_VERIFIED_PRODUCT_BACKEND_V1
vpExternalEnsureColumn(
  'glass_code',
  'TEXT'
);

vpExternalEnsureColumn(
  'product_quantity',
  'REAL NOT NULL DEFAULT 1'
);

vpExternalEnsureColumn(
  'matched_product_id',
  'TEXT'
);

vpExternalEnsureColumn(
  'matched_product_code',
  'TEXT'
);

vpExternalEnsureColumn(
  'matched_product_name',
  'TEXT'
);

vpExternalEnsureColumn(
  'matched_product_cost',
  'REAL'
);

vpExternalEnsureColumn(
  'matched_product_price',
  'REAL'
);

vpExternalEnsureColumn(
  'matched_product_stock',
  'REAL'
);

vpExternalEnsureColumn(
  'product_match_status',
  "TEXT NOT NULL DEFAULT 'unmatched'"
);

vpExternalEnsureColumn(
  'product_match_source',
  'TEXT'
);

vpExternalEnsureColumn(
  'product_match_checked_at',
  'TEXT'
);

// VP_EXTERNAL_FULL_PRODUCT_CATALOGUE_V1
db.exec(`
  CREATE TABLE IF NOT EXISTS keith_product_catalogue (
    product_code TEXT PRIMARY KEY,
    product_id TEXT,
    product_name TEXT,
    category TEXT,
    sub_category TEXT,
    cost REAL NOT NULL DEFAULT 0,
    price REAL,
    in_stock REAL,
    stock_control INTEGER NOT NULL DEFAULT 0,
    available_for_sale INTEGER,
    safety_stock REAL,
    barcode TEXT,
    measurement TEXT,
    metadata_complete INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    last_receipt_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    cached_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_keith_catalogue_name
    ON keith_product_catalogue(product_name);
  CREATE INDEX IF NOT EXISTS idx_keith_catalogue_category
    ON keith_product_catalogue(category);
  CREATE INDEX IF NOT EXISTS idx_keith_catalogue_active
    ON keith_product_catalogue(active, metadata_complete);

  CREATE TABLE IF NOT EXISTS keith_catalogue_state (
    state_key TEXT PRIMARY KEY,
    state_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS keith_product_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_ref TEXT,
    requested_code TEXT NOT NULL,
    requested_name TEXT,
    vehicle TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT NOT NULL DEFAULT 'studio',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_keith_product_requests_status
    ON keith_product_requests(status, created_at);
`);

let vpCatalogueRefreshPromise = null;

function vpCatalogueStats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN metadata_complete=1 THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN metadata_complete=0 THEN 1 ELSE 0 END) AS incomplete,
      SUM(CASE WHEN in_stock IS NOT NULL THEN 1 ELSE 0 END) AS stock_known,
      MAX(cached_at) AS cached_at
    FROM keith_product_catalogue
    WHERE active=1
  `).get();

  const state = db.prepare(`
    SELECT state_value, updated_at
    FROM keith_catalogue_state
    WHERE state_key='last_refresh'
  `).get();

  return {
    total: Number(totals?.total || 0),
    complete: Number(totals?.complete || 0),
    incomplete: Number(totals?.incomplete || 0),
    stockKnown: Number(totals?.stock_known || 0),
    cachedAt: totals?.cached_at || '',
    refresh: safeJsonParse(state?.state_value, {}),
    refreshedAt: state?.updated_at || ''
  };
}

function vpCatalogueView(row) {
  return {
    productId: row.product_id || '',
    productCode: row.product_code || '',
    productName: row.product_name || '',
    category: row.category || '',
    subCategory: row.sub_category || '',
    cost: Number(row.cost || 0),
    price: row.price === null || row.price === undefined
      ? null
      : Number(row.price || 0),
    inStock: row.in_stock === null || row.in_stock === undefined
      ? null
      : Number(row.in_stock || 0),
    stockControl: Boolean(row.stock_control),
    availableForSale:
      row.available_for_sale === null || row.available_for_sale === undefined
        ? null
        : Boolean(row.available_for_sale),
    safetyStock:
      row.safety_stock === null || row.safety_stock === undefined
        ? null
        : Number(row.safety_stock || 0),
    barcode: row.barcode || '',
    measurement: row.measurement || '',
    metadataComplete: Boolean(row.metadata_complete),
    source: row.source || '',
    lastReceiptDate: row.last_receipt_date || '',
    cachedAt: row.cached_at || ''
  };
}

async function vpRefreshCatalogue({ includeHistory = false } = {}) {
  if (vpCatalogueRefreshPromise) return vpCatalogueRefreshPromise;

  vpCatalogueRefreshPromise = (async () => {
    const catalogue = await vpExternalKeithTech.fetchFullProductCatalogue();
    let history = { products: [], stats: {} };

    if (includeHistory) {
      history = await vpExternalKeithTech.fetchHistoricalProductEvidence();
    }

    const historyByCode = new Map(
      history.products.map(item => [String(item.productCode || ''), item])
    );
    const oldByCode = new Map(
      db.prepare('SELECT * FROM keith_product_catalogue').all()
        .map(item => [String(item.product_code || ''), item])
    );
    const timestamp = now();

    const upsert = db.prepare(`
      INSERT INTO keith_product_catalogue (
        product_code, product_id, product_name, category, sub_category,
        cost, price, in_stock, stock_control, available_for_sale,
        safety_stock, barcode, measurement, metadata_complete, source,
        last_receipt_date, active, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(product_code) DO UPDATE SET
        product_id=excluded.product_id,
        product_name=excluded.product_name,
        category=excluded.category,
        sub_category=excluded.sub_category,
        cost=excluded.cost,
        price=excluded.price,
        in_stock=excluded.in_stock,
        stock_control=excluded.stock_control,
        available_for_sale=excluded.available_for_sale,
        safety_stock=excluded.safety_stock,
        barcode=excluded.barcode,
        measurement=excluded.measurement,
        metadata_complete=excluded.metadata_complete,
        source=excluded.source,
        last_receipt_date=excluded.last_receipt_date,
        active=1,
        cached_at=excluded.cached_at
    `);

    db.transaction(() => {
      db.prepare('UPDATE keith_product_catalogue SET active=0').run();

      for (const product of catalogue.products) {
        const code = String(product.productCode || '').trim();
        if (!code) continue;

        const historical = historyByCode.get(code) || {};
        const previous = oldByCode.get(code) || {};
        const complete = Boolean(product.metadataComplete);
        const name = String(
          product.productName || historical.productName || previous.product_name || ''
        ).trim();
        const category = String(
          product.category || historical.category || previous.category || ''
        ).trim();
        const cost = complete
          ? Number(product.cost || 0)
          : Number(historical.cost ?? previous.cost ?? 0);
        const price = product.price !== null && product.price !== undefined
          ? Number(product.price || 0)
          : historical.price !== undefined
            ? Number(historical.price || 0)
            : previous.price ?? null;
        const source = complete
          ? 'keith_products_php'
          : name
            ? 'keith_inventory_receipt_history'
            : 'keith_inventory_only';

        upsert.run(
          code,
          String(product.productId || historical.productId || previous.product_id || ''),
          name,
          category,
          String(product.subCategory || ''),
          cost,
          price,
          product.inStock,
          product.stockControl ? 1 : 0,
          product.availableForSale === null
            ? null
            : product.availableForSale ? 1 : 0,
          product.safetyStock,
          String(product.barcode || ''),
          String(product.measurement || ''),
          complete ? 1 : 0,
          source,
          String(historical.lastReceiptDate || previous.last_receipt_date || ''),
          timestamp
        );
      }

      const state = {
        ...catalogue.stats,
        history: history.stats || {},
        cachedAt: timestamp
      };

      db.prepare(`
        INSERT INTO keith_catalogue_state (state_key, state_value, updated_at)
        VALUES ('last_refresh', ?, ?)
        ON CONFLICT(state_key) DO UPDATE SET
          state_value=excluded.state_value,
          updated_at=excluded.updated_at
      `).run(JSON.stringify(state), timestamp);
    })();

    return vpCatalogueStats();
  })();

  try {
    return await vpCatalogueRefreshPromise;
  } finally {
    vpCatalogueRefreshPromise = null;
  }
}

async function vpEnsureCatalogue({ force = false } = {}) {
  const stats = vpCatalogueStats();
  const age = stats.cachedAt ? Date.now() - Date.parse(stats.cachedAt) : Infinity;

  if (force || stats.total < 600 || !Number.isFinite(age) || age > 30 * 60 * 1000) {
    return vpRefreshCatalogue({ includeHistory: stats.total === 0 });
  }

  return stats;
}

function vpCatalogueExactMatch(codeValue) {
  const requestedCode = String(codeValue || '').trim();
  const row = db.prepare(`
    SELECT * FROM keith_product_catalogue
    WHERE active=1 AND UPPER(product_code)=UPPER(?)
    LIMIT 1
  `).get(requestedCode);

  if (!row) {
    return {
      success: false,
      status: 'not_found',
      requestedCode,
      message: 'No exact Keith Tech product match was found. Use the full catalogue or request product creation.'
    };
  }

  const product = vpCatalogueView(row);

  if (!product.metadataComplete) {
    return {
      success: false,
      status: 'product_creation_required',
      requestedCode,
      ...product,
      message: 'This code exists in inventory but is not a complete active Keith Tech product. Submit a product creation request before using it.'
    };
  }

  return {
    success: true,
    status: 'verified',
    requestedCode,
    ...product,
    checkedAt: now(),
    message: 'Exact product verified from the complete Keith Tech catalogue cache.'
  };
}

function vpExternalCleanText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function vpExternalLines(value) {
  return vpExternalCleanText(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function vpExternalEscapeRegex(value) {
  return String(value || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function vpExternalField(rawText, labels) {
  const lines = vpExternalLines(rawText);
  const wanted = Array.isArray(labels) ? labels : [labels];

  // VP_EXTERNAL_STRICT_LABEL_DELIMITER_V1
  // Require an actual field delimiter. This prevents section headings such
  // as "VEHICLE INFO" from being read as Vehicle="INFO".
  for (const label of wanted) {
    const pattern = new RegExp(
      '^' +
      vpExternalEscapeRegex(label)
        .replace(/\\ /g, '\\s*') +
      '\\s*[:.\\-]+\\s*(.*)$',
      'i'
    );

    for (const line of lines) {
      const match = line.match(pattern);

      if (match) {
        return String(match[1] || '').trim();
      }
    }
  }

  return '';
}

function vpExternalBlockValue(rawText, labels) {
  const lines = vpExternalCleanText(rawText).split('\n');
  const wanted = Array.isArray(labels) ? labels : [labels];

  const stopPattern = /^(?:BOOKED\s*BY|FITTER\s*ASSIGNED|FITTER\s*NAME|SABS\s*APPROVED|CUSTOMER\s*INFO|VEHICLE\s*INFO|GLASS\s*INFO|INTERIOR|FORMS?\s+OF\s+PAYMENT)\b/i;

  for (const label of wanted) {
    const pattern = new RegExp(
      '^\\s*' +
      vpExternalEscapeRegex(label)
        .replace(/\\ /g, '\\s*') +
      '\\s*[:.\\-]*\\s*(.*)$',
      'i'
    );

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(pattern);

      if (!match) continue;

      const values = [];

      if (String(match[1] || '').trim()) {
        values.push(String(match[1]).trim());
      }

      for (
        let nextIndex = index + 1;
        nextIndex < lines.length;
        nextIndex += 1
      ) {
        const nextLine = String(lines[nextIndex] || '').trim();

        if (!nextLine) break;
        if (stopPattern.test(nextLine)) break;
        if (/^[A-Za-z][A-Za-z /]+:\s*/.test(nextLine)) break;

        values.push(nextLine);
      }

      return values.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  return '';
}

function vpExternalYesNo(value) {
  const clean = String(value || '').trim();

  if (/^(yes|y|true|present|working)$/i.test(clean)) {
    return 'Yes';
  }

  if (/^(no|n|false|missing|not working)$/i.test(clean)) {
    return 'No';
  }

  return clean;
}

function vpExternalPaymentType(cashInsurance) {
  const value = String(cashInsurance || '').trim();

  if (!value) {
    return 'Review Required';
  }

  if (/nmb\s*(usd|bank\s*usd)/i.test(value)) {
    return 'NMB USD';
  }

  if (/nmb\s*(zwg|zig)/i.test(value)) {
    return 'NMB ZWG';
  }

  if (/^(cash|cash payment|cash job)$/i.test(value)) {
    return 'Cash';
  }

  if (
    /\bcredit\b/i.test(value) ||
    /\binsurance\b/i.test(value) ||
    /old mutual|fbc|moovah|evolution|cell insurance|zimnat|allied|nicoz|clarion/i.test(value)
  ) {
    return 'Credit';
  }

  return 'Credit';
}

function vpExternalAmount(value) {
  const clean = String(value || '')
    .replace(/,/g, '')
    .trim();

  const match = clean.match(/-?\d+(?:\.\d+)?/);

  if (!match) return 0;

  const amount = Number(match[0]);

  return Number.isFinite(amount) && amount >= 0
    ? amount
    : 0;
}

function vpExternalCurrency(currencyValue, amountValue = '') {
  const value = String(
    currencyValue || amountValue || ''
  ).trim();

  if (/\b(?:ZWG|ZIG)\b/i.test(value)) {
    return 'ZWG';
  }

  return 'USD';
}

function vpExternalBookedBy(rawText) {
  const lines = vpExternalLines(rawText);

  for (const line of lines) {
    const match = line.match(
      /^Booked\s*By[\s.:_-]*(.+)$/i
    );

    if (match) {
      return String(match[1] || '')
        .replace(/^[.\s_-]+/, '')
        .trim();
    }
  }

  return '';
}

function vpExternalParseJobCard(rawText) {
  const text = vpExternalCleanText(rawText);

  // VP_EXTERNAL_COMMERCIAL_EXTRACTION_V1
  // Match the most specific payment labels first so "Payment"
  // cannot consume the "Type" portion of "Payment Type".
  const cashInsurance = vpExternalField(
    text,
    [
      'Payment Type',
      'Payment Method',
      'Cash/Insurance',
      'Cash / Insurance',
      'Payment'
    ]
  );

  const customerPhone = vpExternalField(
    text,
    [
      'Customer Phone',
      'Phone',
      'Cell',
      'Mobile'
    ]
  );

  const carModel = vpExternalField(
    text,
    ['Car Model', 'Vehicle', 'Vehicle Model']
  );

  const year = vpExternalField(
    text,
    ['Year', 'Vehicle Year']
  );

  const registration = vpExternalField(
    text,
    [
      'Plate Number',
      'Registration',
      'Reg Number',
      'Reg'
    ]
  );

  const fitterName = vpExternalField(
    text,
    ['Fitter Name', 'Fitter']
  );

  const amountText = vpExternalField(
    text,
    [
      'Amount',
      'Total Amount',
      'Invoice Amount'
    ]
  );

  const currencyText = vpExternalField(
    text,
    ['Currency']
  );

  const parsed = {
    customerName: vpExternalField(
      text,
      ['Name', 'Customer Name']
    ),
    customerPhone,
    cashInsurance,
    jobDate: vpExternalField(
      text,
      ['Date', 'Job Date']
    ),

    vehicle: carModel,
    vehicleYear: year,
    registration,
    mileage: vpExternalField(
      text,
      ['Mileage', 'Odometer']
    ),

    glassType: vpExternalField(
      text,
      ['Which Glass', 'Glass', 'Glass Type']
    ),
    sensorCamera: vpExternalField(
      text,
      [
        'Any Sensor/ Camera',
        'Any Sensor / Camera',
        'Sensor/Camera',
        'Sensor Camera'
      ]
    ),
    sealantType: vpExternalField(
      text,
      ['Sealant Type', 'Sealant']
    ),

    interior: {
      spareWheel: vpExternalYesNo(
        vpExternalField(text, ['Spare Wheel'])
      ),
      jack: vpExternalYesNo(
        vpExternalField(text, ['Jack'])
      ),
      wheelSpanner: vpExternalYesNo(
        vpExternalField(text, ['Wheel Spanner'])
      ),
      triangles: vpExternalYesNo(
        vpExternalField(text, ['Triangles'])
      ),
      fireExtinguisher: vpExternalYesNo(
        vpExternalField(text, ['Fire Extinguisher'])
      ),
      radio: vpExternalYesNo(
        vpExternalField(text, ['Radio'])
      ),
      mats: vpExternalYesNo(
        vpExternalField(text, ['Mats'])
      ),
      doorPanelsDamaged: vpExternalYesNo(
        vpExternalField(
          text,
          ['Door Panels Damaged']
        )
      ),
      windowWindersWork: vpExternalYesNo(
        vpExternalField(
          text,
          [
            'Window Winders work',
            'Window Winders Work'
          ]
        )
      ),
      valuablesRemoved: vpExternalYesNo(
        vpExternalField(
          text,
          ['Valuables Removed']
        )
      ),
      itemsLeft: vpExternalBlockValue(
        text,
        ['Items left', 'Items Left']
      )
    },

    bookedBy: vpExternalBookedBy(text),
    fitterName,

    sabsApproved:
      /SABS\s+APPROVED\s+WINDSCREEN/i.test(text)
        ? 'Yes'
        : vpExternalYesNo(
            vpExternalField(
              text,
              ['SABS Approved']
            )
          ),

    sourceDocumentType:
      /WINDSCREEN\s+JOB\s+CARD/i.test(text)
        ? 'Windscreen Job Card'
        : 'External Job Card',

    amount:
      vpExternalAmount(amountText),
    currency:
      vpExternalCurrency(
        currencyText,
        amountText
      ),
    paymentType:
      vpExternalPaymentType(cashInsurance)
  };

  parsed.vehicleDescription = [
    parsed.vehicle,
    parsed.vehicleYear
  ].filter(Boolean).join(' ').trim();

  const required = {
    customerName: parsed.customerName,
    customerPhone: parsed.customerPhone,
    vehicle: parsed.vehicle,
    registration: parsed.registration,
    glassType: parsed.glassType,
    bookedBy: parsed.bookedBy,
    fitterName: parsed.fitterName
  };

  parsed.missingFields = Object.entries(required)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);

  parsed.extractionComplete =
    parsed.missingFields.length === 0;

  parsed.extractionScore = Math.round(
    (
      (
        Object.keys(required).length -
        parsed.missingFields.length
      ) /
      Object.keys(required).length
    ) * 100
  );

  return parsed;
}

function vpExternalReadiness(record) {
  const parsed =
    typeof record.parsed === 'object'
      ? record.parsed
      : safeJsonParse(record.parsed_json, {});

  const missing = [];

  if (!String(parsed.customerName || '').trim()) {
    missing.push('customerName');
  }

  if (!String(parsed.customerPhone || record.source_phone || '').trim()) {
    missing.push('customerPhone');
  }

  if (!String(parsed.vehicle || '').trim()) {
    missing.push('vehicle');
  }

  if (!String(parsed.registration || '').trim()) {
    missing.push('registration');
  }

  if (
    !String(record.payment_type || '').trim() ||
    record.payment_type === 'Review Required'
  ) {
    missing.push('paymentType');
  }

  if (!(Number(record.amount || 0) > 0)) {
    missing.push('amount');
  }

  const glassCode =
    String(
      record.glass_code || ''
    ).trim();

  const productCode =
    String(
      record.product_code || ''
    ).trim();

  const productName =
    String(
      record.product_name || ''
    ).trim();

  const matchedProductCode =
    String(
      record.matched_product_code || ''
    ).trim();

  const matchedProductName =
    String(
      record.matched_product_name || ''
    ).trim();

  const productMatchStatus =
    String(
      record.product_match_status || ''
    ).trim();

  const productQuantity =
    Number(record.product_quantity || 0);

  if (!glassCode) {
    missing.push('glassCode');
  }

  if (!productCode) {
    missing.push('productCode');
  }

  if (!productName) {
    missing.push('productName');
  }

  if (
    !Number.isFinite(productQuantity) ||
    productQuantity <= 0
  ) {
    missing.push('productQuantity');
  }

  if (
    productMatchStatus !== 'verified' ||
    !productCode ||
    !productName ||
    glassCode !== productCode ||
    matchedProductCode !== productCode ||
    matchedProductName !== productName
  ) {
    missing.push('verifiedProduct');
  }

  return {
    ready: missing.length === 0,
    missing
  };
}

function vpExternalJobCardView(row) {
  const parsed = safeJsonParse(row?.parsed_json, {});
  const readiness = vpExternalReadiness({
    ...row,
    parsed
  });

  return {
    id: row.id,
    externalRef: row.external_ref,
    sourceMessageId: row.source_message_id || '',
    sourcePhone: row.source_phone || '',
    rawText: row.raw_text || '',
    parsed,
    reviewStatus: row.review_status || 'needs_review',
    paymentType: row.payment_type || 'Review Required',
    paymentReference: row.payment_reference || '',
    amount: Number(row.amount || 0),
    currency: row.currency || 'USD',
    glassCode:
      row.glass_code || '',
    productQuantity:
      Number(row.product_quantity || 1),
    productCode:
      row.product_code || '',
    productName:
      row.product_name || '',
    productMatchStatus:
      row.product_match_status ||
      'unmatched',
    matchedProductId:
      row.matched_product_id || '',
    matchedProductCode:
      row.matched_product_code || '',
    matchedProductName:
      row.matched_product_name || '',
    matchedProductCost:
      Number(row.matched_product_cost || 0),
    matchedProductPrice:
      Number(row.matched_product_price || 0),
    matchedProductStock:
      row.matched_product_stock === null ||
      row.matched_product_stock ===
        undefined
        ? null
        : Number(
            row.matched_product_stock
          ),
    productMatchSource:
      row.product_match_source || '',
    productMatchCheckedAt:
      row.product_match_checked_at || '',
    posCustomerId:
      row.keithstops_customer_id || '',
    posCustomerCreatedAt:
      row.keithstops_customer_created_at || '',
    posStatus: row.keithstops_status || 'not_submitted',
    posReference: row.keithstops_reference || '',
    posError: row.keithstops_error || '',
    readyForSubmission: readiness.ready,
    missingForSubmission: readiness.missing,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    submittedAt: row.submitted_at || ''
  };
}

function vpExternalNextRef() {
  const row = db.prepare(`
    SELECT COALESCE(MAX(id), 0) AS max_id
    FROM external_job_cards
  `).get();

  return (
    'EJC-' +
    String(Number(row?.max_id || 0) + 1)
      .padStart(6, '0')
  );
}

function vpExternalHash(rawText) {
  return crypto
    .createHash('sha256')
    .update(vpExternalCleanText(rawText))
    .digest('hex');
}

function vpExternalInsertJobCard({
  rawText,
  sourcePhone = '',
  sourceMessageId = ''
}) {
  const cleanText = vpExternalCleanText(rawText);

  if (!cleanText) {
    throw new Error('Job-card text is required.');
  }

  if (
    !/JOB\s*CARD/i.test(cleanText) &&
    !/CUSTOMER\s*INFO/i.test(cleanText) &&
    !/VEHICLE\s*INFO/i.test(cleanText)
  ) {
    throw new Error(
      'The supplied message does not look like a workshop job card.'
    );
  }

  const sourceHash = vpExternalHash(cleanText);

  const existing = db.prepare(`
    SELECT *
    FROM external_job_cards
    WHERE source_hash=?
    LIMIT 1
  `).get(sourceHash);

  if (existing) {
    return {
      created: false,
      duplicate: true,
      record: vpExternalJobCardView(existing)
    };
  }

  const parsed = vpExternalParseJobCard(cleanText);
  const timestamp = now();
  const externalRef = vpExternalNextRef();

  db.prepare(`
    INSERT INTO external_job_cards (
      external_ref,
      source_message_id,
      source_hash,
      source_phone,
      raw_text,
      parsed_json,
      review_status,
      payment_type,
      payment_reference,
      amount,
      currency,
      product_code,
      product_name,
      keithstops_status,
      created_at,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, 'needs_review',
      ?, '', ?, ?, ?, ?, 'not_submitted',
      ?, ?
    )
  `).run(
    externalRef,
    String(sourceMessageId || ''),
    sourceHash,
    String(
      sourcePhone ||
      parsed.customerPhone ||
      ''
    ),
    cleanText,
    JSON.stringify(parsed),
    parsed.paymentType || 'Review Required',
    Number(parsed.amount || 0),
    parsed.currency || 'USD',
    // VP_EXTERNAL_NO_UNVERIFIED_PRODUCT_DEFAULT_V1
    '',
    '',
    timestamp,
    timestamp
  );

  try {
    db.prepare(`
      INSERT INTO studio_notes (
        ref,
        type,
        note,
        actor,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      externalRef,
      'external_job_card',
      'External job card captured and queued for staff review.',
      'system',
      timestamp
    );
  } catch {}

  const row = db.prepare(`
    SELECT *
    FROM external_job_cards
    WHERE external_ref=?
  `).get(externalRef);

  return {
    created: true,
    duplicate: false,
    record: vpExternalJobCardView(row)
  };
}

app.post(
  '/api/studio/v3/external-job-cards/preview',
  studioGuard,
  (req, res) => {
    try {
      const rawText = vpExternalCleanText(
        req.body?.rawText || req.body?.text || ''
      );

      if (!rawText) {
        return res.status(400).json({
          ok: false,
          error: 'rawText is required.'
        });
      }

      const parsed = vpExternalParseJobCard(rawText);

      res.json({
        ok: true,
        parsed,
        paymentType: parsed.paymentType,
        extractionScore: parsed.extractionScore,
        missingFields: parsed.missingFields
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_PREVIEW_ERROR:',
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  '/api/studio/v3/external-job-cards',
  studioGuard,
  (req, res) => {
    try {
      const status = String(
        req.query?.status || ''
      ).trim();
      const month = String(
        req.query?.month || ''
      ).trim();

      if (month && !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({
          ok: false,
          error: 'Use a valid YYYY-MM month.'
        });
      }

      const clauses = [];
      const params = [];
      const countClauses = [];
      const countParams = [];
      let monthStart = '';
      let monthEnd = '';

      if (status) {
        clauses.push('review_status=?');
        params.push(status);
      }

      if (month) {
        const [year, monthNumber] = month.split('-').map(Number);
        // Africa/Harare is UTC+02:00 year-round. Convert local month boundaries to UTC.
        monthStart = new Date(Date.UTC(year, monthNumber - 1, 1, -2)).toISOString();
        monthEnd = new Date(Date.UTC(year, monthNumber, 1, -2)).toISOString();
        const monthStartClause = 'julianday(created_at) >= julianday(?)';
        const monthEndClause = 'julianday(created_at) < julianday(?)';
        clauses.push(monthStartClause, monthEndClause);
        params.push(monthStart, monthEnd);
        countClauses.push(monthStartClause, monthEndClause);
        countParams.push(monthStart, monthEnd);
      }

      const where = clauses.length
        ? `WHERE ${clauses.join(' AND ')}`
        : '';
      const countWhere = countClauses.length
        ? `WHERE ${countClauses.join(' AND ')}`
        : '';

      const rows = db.prepare(`
        SELECT *
        FROM external_job_cards
        ${where}
        ORDER BY id DESC
        LIMIT 500
      `).all(...params);

      const records = rows.map(
        vpExternalJobCardView
      );

      const counts = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(
            CASE
              WHEN review_status='needs_review'
              THEN 1 ELSE 0
            END
          ) AS needs_review,
          SUM(
            CASE
              WHEN review_status='ready'
              THEN 1 ELSE 0
            END
          ) AS ready,
          SUM(
            CASE
              WHEN review_status='submitted'
              THEN 1 ELSE 0
            END
          ) AS submitted,
          SUM(
            CASE
              WHEN review_status='failed'
              THEN 1 ELSE 0
            END
          ) AS failed
        FROM external_job_cards
        ${countWhere}
      `).get(...countParams);

      res.json({
        ok: true,
        month: month || null,
        submissionEnabled:
          String(
            process.env.EXTERNAL_JOB_CARD_POS_SUBMIT_ENABLED || ''
          ).toLowerCase() === 'true',
        counts: {
          total: Number(counts?.total || 0),
          needsReview: Number(counts?.needs_review || 0),
          ready: Number(counts?.ready || 0),
          submitted: Number(counts?.submitted || 0),
          failed: Number(counts?.failed || 0)
        },
        records
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARDS_LIST_ERROR:',
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  '/api/studio/v3/external-job-cards/:externalRef',
  studioGuard,
  (req, res) => {
    try {
      const externalRef = String(
        req.params.externalRef || ''
      ).trim().toUpperCase();

      const row = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      if (!row) {
        return res.status(404).json({
          ok: false,
          error: 'External job card not found.'
        });
      }

      res.json({
        ok: true,
        record: vpExternalJobCardView(row)
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_GET_ERROR:',
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.post(
  '/api/studio/v3/external-job-cards',
  studioGuard,
  (req, res) => {
    try {
      const result = vpExternalInsertJobCard({
        rawText:
          req.body?.rawText ||
          req.body?.text ||
          '',
        sourcePhone:
          req.body?.sourcePhone ||
          '',
        sourceMessageId:
          req.body?.sourceMessageId ||
          ''
      });

      res.status(
        result.created ? 201 : 200
      ).json({
        ok: true,
        ...result
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_CREATE_ERROR:',
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.patch(
  '/api/studio/v3/external-job-cards/:externalRef',
  studioGuard,
  (req, res) => {
    try {
      const externalRef = String(
        req.params.externalRef || ''
      ).trim().toUpperCase();

      const current = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      if (!current) {
        return res.status(404).json({
          ok: false,
          error: 'External job card not found.'
        });
      }

      if (
        String(current.review_status || '') ===
        'submitted'
      ) {
        return res.status(409).json({
          ok: false,
          error:
            'Submitted job cards cannot be edited.'
        });
      }

      const currentParsed = safeJsonParse(
        current.parsed_json,
        {}
      );

      const parsedPatch =
        req.body?.parsed &&
        typeof req.body.parsed === 'object'
          ? req.body.parsed
          : {};

      const nextParsed = {
        ...currentParsed,
        ...parsedPatch,
        interior: {
          ...(currentParsed.interior || {}),
          ...(parsedPatch.interior || {})
        }
      };

      const allowedPayments = [
        'Cash',
        'NMB USD',
        'NMB ZWG',
        'Credit',
        'Review Required'
      ];

      const paymentType = String(
        req.body?.paymentType ??
        current.payment_type ??
        'Review Required'
      ).trim();

      if (!allowedPayments.includes(paymentType)) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid payment type.'
        });
      }

      const amount = Number(
        req.body?.amount ??
        current.amount ??
        0
      );

      if (
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Amount must be a valid non-negative number.'
        });
      }

      const currency = String(
        req.body?.currency ??
        current.currency ??
        'USD'
      ).trim().toUpperCase();

      if (!['USD', 'ZWG'].includes(currency)) {
        return res.status(400).json({
          ok: false,
          error:
            'Currency must be USD or ZWG.'
        });
      }

      const requestedStatus = String(
        req.body?.reviewStatus ??
        current.review_status ??
        'needs_review'
      ).trim();

      const allowedStatuses = [
        'needs_review',
        'ready',
        'held',
        'failed'
      ];

      if (!allowedStatuses.includes(requestedStatus)) {
        return res.status(400).json({
          ok: false,
          error:
            'Invalid review status.'
        });
      }

      const candidate = {
        parsed: nextParsed,
        source_phone:
          current.source_phone,
        payment_type:
          paymentType,
        amount,
        glass_code:
          String(
            current.glass_code || ''
          ).trim(),
        product_quantity:
          Number(
            current.product_quantity || 1
          ),
        product_code:
          String(
            req.body?.productCode ??
            current.product_code ??
            ''
          ).trim(),
        product_name:
          String(
            req.body?.productName ??
            current.product_name ??
            ''
          ).trim(),
        product_match_status:
          current.product_match_status ||
          'unmatched',
        matched_product_code:
          current.matched_product_code ||
          '',
        matched_product_name:
          current.matched_product_name ||
          ''
      };

      const readiness =
        vpExternalReadiness(candidate);

      if (
        requestedStatus === 'ready' &&
        !readiness.ready
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'Job card is not ready for submission.',
          missing:
            readiness.missing
        });
      }

      db.prepare(`
        UPDATE external_job_cards
        SET
          parsed_json=?,
          review_status=?,
          payment_type=?,
          payment_reference=?,
          amount=?,
          currency=?,
          product_code=?,
          product_name=?,
          updated_at=?
        WHERE external_ref=?
      `).run(
        JSON.stringify(nextParsed),
        requestedStatus,
        paymentType,
        String(
          req.body?.paymentReference ??
          current.payment_reference ??
          ''
        ).trim(),
        amount,
        currency,
        String(
          req.body?.productCode ??
          current.product_code ??
          ''
        ).trim(),
        String(
          req.body?.productName ??
          current.product_name ??
          ''
        ).trim(),
        now(),
        externalRef
      );

      try {
        db.prepare(`
          INSERT INTO studio_notes (
            ref,
            type,
            note,
            actor,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(
          externalRef,
          'external_job_card_review',
          `External job card updated. Review status: ${requestedStatus}.`,
          'studio',
          now()
        );
      } catch {}

      const updated = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      res.json({
        ok: true,
        record:
          vpExternalJobCardView(updated)
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_UPDATE_ERROR:',
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// VP_EXTERNAL_CATALOGUE_ROUTES_V1
app.get('/api/studio/v3/keith-products', studioGuard, async (req, res) => {
  try {
    await vpEnsureCatalogue();
    const query = String(req.query?.query || '').trim();
    const includeIncomplete = String(req.query?.includeIncomplete || '').toLowerCase() === 'true';
    const requestedLimit = Number(req.query?.limit || 30);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 30));
    const like = `%${query}%`;
    const prefix = `${query}%`;

    const rows = db.prepare(`
      SELECT * FROM keith_product_catalogue
      WHERE active=1
        AND (?=1 OR metadata_complete=1)
        AND (
          ?='' OR
          product_code LIKE ? COLLATE NOCASE OR
          product_name LIKE ? COLLATE NOCASE OR
          category LIKE ? COLLATE NOCASE OR
          sub_category LIKE ? COLLATE NOCASE OR
          barcode LIKE ? COLLATE NOCASE
        )
      ORDER BY
        CASE
          WHEN UPPER(product_code)=UPPER(?) THEN 0
          WHEN product_code LIKE ? COLLATE NOCASE THEN 1
          WHEN product_name LIKE ? COLLATE NOCASE THEN 2
          ELSE 3
        END,
        metadata_complete DESC,
        product_code COLLATE NOCASE
      LIMIT ?
    `).all(
      includeIncomplete ? 1 : 0,
      query, like, like, like, like, like,
      query, prefix, prefix, limit
    );

    res.json({
      ok: true,
      query,
      products: rows.map(vpCatalogueView),
      stats: vpCatalogueStats()
    });
  } catch (error) {
    console.error('EXTERNAL_CATALOGUE_SEARCH_ERROR:', error);
    res.status(500).json({ ok: false, error: error.message || 'Catalogue search failed.' });
  }
});

app.post('/api/studio/v3/keith-products/refresh', studioGuard, async (req, res) => {
  try {
    const stats = await vpRefreshCatalogue({ includeHistory: Boolean(req.body?.includeHistory) });
    res.json({ ok: true, stats });
  } catch (error) {
    console.error('EXTERNAL_CATALOGUE_REFRESH_ERROR:', error);
    res.status(500).json({ ok: false, error: error.message || 'Catalogue refresh failed.' });
  }
});

app.get('/api/studio/v3/keith-product-requests', studioGuard, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM keith_product_requests ORDER BY id DESC LIMIT 300
  `).all();
  res.json({
    ok: true,
    requests: rows.map(row => ({
      id: row.id,
      externalRef: row.external_ref || '',
      requestedCode: row.requested_code || '',
      requestedName: row.requested_name || '',
      vehicle: row.vehicle || '',
      reason: row.reason || '',
      status: row.status || 'pending',
      requestedBy: row.requested_by || 'studio',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || ''
    }))
  });
});

app.post('/api/studio/v3/external-job-cards/:externalRef/product-request', studioGuard, (req, res) => {
  const externalRef = String(req.params.externalRef || '').trim().toUpperCase();

  try {
    const row = db.prepare('SELECT * FROM external_job_cards WHERE external_ref=?').get(externalRef);
    if (!row) return res.status(404).json({ ok: false, error: 'External job card not found.' });
    if (row.review_status === 'submitted' || String(row.keithstops_status || '').includes('submitted_to_keith_tech_pos')) {
      return res.status(409).json({ ok: false, error: 'Submitted job cards cannot create product requests.' });
    }

    const requestedCode = String(req.body?.requestedCode || row.glass_code || '').trim();
    if (!requestedCode) return res.status(400).json({ ok: false, error: 'A requested product code is required.' });

    const parsed = safeJsonParse(row.parsed_json, {});
    const requestedName = String(
      req.body?.requestedName || [parsed.vehicleDescription || parsed.vehicle || '', parsed.glassType || 'Glass'].filter(Boolean).join(' ')
    ).trim();
    const vehicle = String(parsed.vehicleDescription || parsed.vehicle || '').trim();
    const reason = String(req.body?.reason || 'No complete active Keith Tech product matched this code.').trim();
    const existing = db.prepare(`
      SELECT * FROM keith_product_requests
      WHERE external_ref=? AND UPPER(requested_code)=UPPER(?) AND status='pending'
      ORDER BY id DESC LIMIT 1
    `).get(externalRef, requestedCode);
    const timestamp = now();
    let requestId = existing?.id || 0;

    if (!existing) {
      const inserted = db.prepare(`
        INSERT INTO keith_product_requests (
          external_ref, requested_code, requested_name, vehicle, reason,
          status, requested_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 'studio', ?, ?)
      `).run(externalRef, requestedCode, requestedName, vehicle, reason, timestamp, timestamp);
      requestId = Number(inserted.lastInsertRowid);
      db.prepare(`
        INSERT INTO studio_notes (ref, type, note, actor, created_at)
        VALUES (?, 'product_creation_request', ?, 'studio', ?)
      `).run(
        externalRef,
        `Keith Tech product creation requested. Code: ${requestedCode}. Name: ${requestedName}. Reason: ${reason}`,
        timestamp
      );
    }

    db.prepare(`
      UPDATE external_job_cards SET
        glass_code=?, product_match_status='creation_requested', review_status='held',
        matched_product_id=NULL, matched_product_code=NULL, matched_product_name=NULL,
        matched_product_cost=NULL, matched_product_price=NULL, matched_product_stock=NULL,
        product_match_source=NULL, product_match_checked_at=?, updated_at=?
      WHERE external_ref=?
    `).run(requestedCode, timestamp, timestamp, externalRef);

    const request = db.prepare('SELECT * FROM keith_product_requests WHERE id=?').get(requestId);
    const updated = db.prepare('SELECT * FROM external_job_cards WHERE external_ref=?').get(externalRef);

    res.status(existing ? 200 : 201).json({
      ok: true,
      duplicate: Boolean(existing),
      request: {
        id: request.id,
        externalRef: request.external_ref || '',
        requestedCode: request.requested_code || '',
        requestedName: request.requested_name || '',
        vehicle: request.vehicle || '',
        reason: request.reason || '',
        status: request.status || 'pending',
        createdAt: request.created_at || ''
      },
      record: vpExternalJobCardView(updated)
    });
  } catch (error) {
    console.error('EXTERNAL_PRODUCT_REQUEST_ERROR:', error);
    res.status(500).json({ ok: false, error: error.message || 'Product request could not be created.' });
  }
});

// VP_EXTERNAL_VERIFIED_PRODUCT_ROUTE_V1
// This route performs Keith Tech GET requests only.
// It never creates a product, changes stock or submits an order.
app.post(
  '/api/studio/v3/external-job-cards/:externalRef/verify-product',
  studioGuard,
  async (req, res) => {
    const externalRef =
      String(
        req.params.externalRef || ''
      )
        .trim()
        .toUpperCase();

    try {
      const row = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      if (!row) {
        return res.status(404).json({
          ok: false,
          error:
            'External job card not found.'
        });
      }

      if (
        row.review_status ===
          'submitted' ||
        row.keithstops_status ===
          'submitted_to_keith_tech_pos' ||
        row.keithstops_status ===
          'already_submitted_to_keith_tech_pos'
      ) {
        return res.status(409).json({
          ok: false,
          error:
            'Submitted job cards cannot be remapped.'
        });
      }

      const glassCode =
        String(
          req.body?.glassCode ||
          req.body?.productCode ||
          row.glass_code ||
          row.product_code ||
          ''
        ).trim();

      const suppliedQuantity =
        Number(
          req.body?.productQuantity ??
          row.product_quantity ??
          1
        );

      const productQuantity =
        Number.isFinite(
          suppliedQuantity
        ) &&
        suppliedQuantity > 0
          ? suppliedQuantity
          : 1;

      if (!glassCode) {
        return res.status(400).json({
          ok: false,
          error:
            'Glass Code is required.'
        });
      }

      await vpEnsureCatalogue();

      const match =
        vpCatalogueExactMatch(
          glassCode
        );

      const timestamp = now();

      if (!match.success) {
        db.prepare(`
          UPDATE external_job_cards
          SET
            glass_code=?,
            product_quantity=?,
            product_match_status=?,
            matched_product_id=NULL,
            matched_product_code=NULL,
            matched_product_name=NULL,
            matched_product_cost=NULL,
            matched_product_price=NULL,
            matched_product_stock=NULL,
            product_match_source=NULL,
            product_match_checked_at=?,
            review_status=
              CASE
                WHEN review_status='ready'
                THEN 'held'
                ELSE review_status
              END,
            updated_at=?
          WHERE external_ref=?
        `).run(
          glassCode,
          productQuantity,
          match.status ||
            'unmatched',
          timestamp,
          timestamp,
          externalRef
        );

        try {
          db.prepare(`
            INSERT INTO studio_notes (
              ref,
              type,
              note,
              actor,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `).run(
            externalRef,
            'product_match',
            (
              'Glass Code verification failed: ' +
              glassCode +
              '. ' +
              (
                match.message ||
                'No exact product match.'
              )
            ),
            'studio',
            timestamp
          );
        } catch {}

        const unmatched =
          db.prepare(`
            SELECT *
            FROM external_job_cards
            WHERE external_ref=?
          `).get(externalRef);

        return res.status(404).json({
          ok: false,
          error:
            match.message ||
            'No exact Keith Tech product match was found.',
          matchStatus:
            match.status ||
            'unmatched',
          record:
            vpExternalJobCardView(
              unmatched
            )
        });
      }

      if (
        String(match.productCode || '').toUpperCase() !==
        String(glassCode || '').toUpperCase()
      ) {
        return res.status(409).json({
          ok: false,
          error:
            'Keith Tech returned a different product code. Submission remains blocked.'
        });
      }

      db.prepare(`
        UPDATE external_job_cards
        SET
          glass_code=?,
          product_quantity=?,
          product_code=?,
          product_name=?,
          matched_product_id=?,
          matched_product_code=?,
          matched_product_name=?,
          matched_product_cost=?,
          matched_product_price=?,
          matched_product_stock=?,
          product_match_status='verified',
          product_match_source=?,
          product_match_checked_at=?,
          updated_at=?
        WHERE external_ref=?
      `).run(
        glassCode,
        productQuantity,
        match.productCode,
        match.productName,
        match.productId,
        match.productCode,
        match.productName,
        Number(match.cost || 0),
        Number(match.price || 0),
        match.inStock === null ||
        match.inStock === undefined
          ? null
          : Number(match.inStock),
        match.source ||
          'keith_tech_live_exact_match',
        match.checkedAt ||
          timestamp,
        timestamp,
        externalRef
      );

      try {
        db.prepare(`
          INSERT INTO studio_notes (
            ref,
            type,
            note,
            actor,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(
          externalRef,
          'product_match',
          (
            'Verified Glass Code ' +
            match.productCode +
            ': ' +
            match.productName +
            '. Cost: $' +
            Number(
              match.cost || 0
            ).toFixed(2) +
            '. Stock: ' +
            (
              match.inStock === null ||
              match.inStock === undefined
                ? 'not returned'
                : String(
                    match.inStock
                  )
            ) +
            '.'
          ),
          'studio',
          timestamp
        );
      } catch {}

      const updated =
        db.prepare(`
          SELECT *
          FROM external_job_cards
          WHERE external_ref=?
        `).get(externalRef);

      return res.json({
        ok: true,
        match: {
          status:
            'verified',
          productCode:
            match.productCode,
          productName:
            match.productName,
          category:
            match.category || '',
          cost:
            Number(match.cost || 0),
          price:
            Number(match.price || 0),
          inStock:
            match.inStock,
          stockControl:
            Boolean(
              match.stockControl
            ),
          availableForSale:
            Boolean(
              match.availableForSale
            )
        },
        record:
          vpExternalJobCardView(
            updated
          )
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_PRODUCT_VERIFY_ERROR:',
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          error.message ||
          'Product verification failed.'
      });
    }
  }
);

// VP_EXTERNAL_CATALOGUE_BACKGROUND_REFRESH_V1
setTimeout(() => {
  const stats = vpCatalogueStats();
  vpRefreshCatalogue({ includeHistory: stats.total === 0 })
    .catch(error => console.error('EXTERNAL_CATALOGUE_STARTUP_REFRESH_ERROR:', error.message));
}, 8000).unref();

setInterval(() => {
  vpRefreshCatalogue({ includeHistory: false })
    .catch(error => console.error('EXTERNAL_CATALOGUE_PERIODIC_REFRESH_ERROR:', error.message));
}, 30 * 60 * 1000).unref();

// VP_EXTERNAL_JOB_CARDS_POS_SUBMISSION_V1
function vpExternalSubmissionPack(row) {
  const parsed =
    safeJsonParse(
      row.parsed_json,
      {}
    );

  const interior =
    parsed.interior || {};

  const orderComment = [
    `External job card ${row.external_ref}`,
    parsed.vehicleDescription ||
      parsed.vehicle ||
      '',
    parsed.registration
      ? `Registration: ${parsed.registration}`
      : '',
    parsed.glassType
      ? `Glass: ${parsed.glassType}`
      : '',
    parsed.fitterName
      ? `Fitter: ${parsed.fitterName}`
      : '',
    interior.itemsLeft
      ? `Items left: ${interior.itemsLeft}`
      : ''
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    existingCustomerId:
      row.keithstops_customer_id || '',
    claimNo:
      row.external_ref,
    customerName:
      parsed.customerName || '',
    customerPhone:
      parsed.customerPhone ||
      row.source_phone ||
      '',
    location:
      parsed.location || '',
    amount:
      Number(row.amount || 0),
    currency:
      row.currency || 'USD',
    paymentType:
      row.payment_type || '',
    paymentReference:
      row.payment_reference || '',
    productCode:
      row.matched_product_code || '',
    productName:
      row.matched_product_name || '',
    productQuantity:
      Number(row.product_quantity || 1),
    productCost:
      Number(row.matched_product_cost || 0),
    orderComment,
    sourceLabel:
      'external job card',
    claimData: {
      phone:
        parsed.customerPhone ||
        row.source_phone ||
        '',
      vehicle:
        parsed.vehicle || '',
      vehicleYear:
        parsed.vehicleYear || '',
      registration:
        parsed.registration || '',
      mileage:
        parsed.mileage || '',
      glassType:
        parsed.glassType || '',
      sensorCamera:
        parsed.sensorCamera || '',
      fitterName:
        parsed.fitterName || '',
      bookedBy:
        parsed.bookedBy || ''
    }
  };
}

app.post(
  '/api/studio/v3/external-job-cards/:externalRef/submission-preview',
  studioGuard,
  (req, res) => {
    try {
      const externalRef = String(
        req.params.externalRef || ''
      )
        .trim()
        .toUpperCase();

      const row = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      if (!row) {
        return res.status(404).json({
          ok: false,
          error:
            'External job card not found.'
        });
      }

      const readiness =
        vpExternalReadiness({
          ...row,
          parsed:
            safeJsonParse(
              row.parsed_json,
              {}
            )
        });

      if (!readiness.ready) {
        return res.status(400).json({
          ok: false,
          error:
            'External job card is not ready.',
          missing:
            readiness.missing
        });
      }

      const payload =
        vpExternalKeithTech
          .previewOrderPayload(
            vpExternalSubmissionPack(row)
          );

      return res.json({
        ok: true,
        mode:
          'external_job_card_submission_preview',
        apiPosts: 0,
        payload: {
          orderReference:
            payload.order_reference_id,
          orderTotal:
            payload.order_total,
          payment:
            payload.order_payments,
          products:
            payload.order_items.map(
              item => ({
                productCode:
                  item.product_code,
                productName:
                  item.product_name,
                quantity:
                  item.product_qty,
                unitPrice:
                  item.product_unit_price
              })
            ),
          shopConfigured:
            Boolean(payload.shop_id),
          terminalConfigured:
            Boolean(
              payload.target_terminal
            )
        }
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_SUBMISSION_PREVIEW_ERROR:',
        error
      );

      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.post(
  '/api/studio/v3/external-job-cards/:externalRef/submit',
  studioGuard,
  async (req, res) => {
    const enabled =
      String(
        process.env
          .EXTERNAL_JOB_CARD_POS_SUBMIT_ENABLED ||
        ''
      ).toLowerCase() === 'true';

    if (!enabled) {
      return res.status(423).json({
        ok: false,
        error:
          'Keith Tech submission is locked pending final activation.'
      });
    }

    const externalRef = String(
      req.params.externalRef || ''
    )
      .trim()
      .toUpperCase();

    try {
      const row = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      if (!row) {
        return res.status(404).json({
          ok: false,
          error:
            'External job card not found.'
        });
      }

      if (
        row.review_status ===
          'submitted' ||
        row.keithstops_status ===
          'submitted_to_keith_tech_pos' ||
        row.keithstops_status ===
          'already_submitted_to_keith_tech_pos'
      ) {
        return res.json({
          ok: true,
          duplicatePrevented: true,
          record:
            vpExternalJobCardView(row)
        });
      }

      const readiness =
        vpExternalReadiness({
          ...row,
          parsed:
            safeJsonParse(
              row.parsed_json,
              {}
            )
        });

      if (
        row.review_status !== 'ready' ||
        !readiness.ready
      ) {
        return res.status(400).json({
          ok: false,
          error:
            'External job card must be reviewed and marked ready.',
          missing:
            readiness.missing
        });
      }

      const updatedAt =
        Date.parse(
          row.updated_at || ''
        );

      const staleSubmitting =
        row.keithstops_status ===
          'submitting' &&
        (
          !Number.isFinite(updatedAt) ||
          Date.now() - updatedAt >
            10 * 60 * 1000
        );

      if (
        row.keithstops_status ===
          'submitting' &&
        !staleSubmitting
      ) {
        return res.status(409).json({
          ok: false,
          error:
            'This job card is already being submitted.'
        });
      }

      const lock = db.prepare(`
        UPDATE external_job_cards
        SET
          keithstops_status='submitting',
          keithstops_error='',
          updated_at=?
        WHERE
          external_ref=?
          AND (
            keithstops_status IN (
              'not_submitted',
              'failed',
              'api_error'
            )
            OR (
              keithstops_status='submitting'
              AND updated_at=?
            )
          )
      `).run(
        now(),
        externalRef,
        row.updated_at
      );

      if (lock.changes !== 1) {
        return res.status(409).json({
          ok: false,
          error:
            'Submission lock could not be acquired.'
        });
      }

      const submissionPack =
        vpExternalSubmissionPack(row);

      submissionPack.onCustomerResolved =
        async ({
          customerId,
          createdAt
        }) => {
          const safeCustomerId =
            String(
              customerId || ''
            ).trim();

          if (!safeCustomerId) {
            throw new Error(
              'Keith Tech returned an empty customer ID.'
            );
          }

          const persisted = db.prepare(`
            UPDATE external_job_cards
            SET
              keithstops_customer_id=?,
              keithstops_customer_created_at=
                COALESCE(
                  keithstops_customer_created_at,
                  ?
                ),
              updated_at=?
            WHERE
              external_ref=?
              AND (
                COALESCE(
                  keithstops_customer_id,
                  ''
                )=''
                OR keithstops_customer_id=?
              )
          `).run(
            safeCustomerId,
            createdAt || now(),
            now(),
            externalRef,
            safeCustomerId
          );

          if (persisted.changes !== 1) {
            throw new Error(
              'Could not persist the Keith Tech customer ID before order submission.'
            );
          }
        };

      const result =
        await vpExternalKeithTech
          .submitClaimPack(
            submissionPack
          );

      if (!result.success) {
        db.prepare(`
          UPDATE external_job_cards
          SET
            review_status='failed',
            keithstops_status=?,
            keithstops_error=?,
            updated_at=?
          WHERE external_ref=?
        `).run(
          result.status || 'failed',
          String(
            result.message ||
            'Keith Tech submission failed.'
          ).slice(0, 2000),
          now(),
          externalRef
        );

        const failed = db.prepare(`
          SELECT *
          FROM external_job_cards
          WHERE external_ref=?
        `).get(externalRef);

        return res.status(502).json({
          ok: false,
          error:
            result.message ||
            'Keith Tech submission failed.',
          record:
            vpExternalJobCardView(failed)
        });
      }

      db.prepare(`
        UPDATE external_job_cards
        SET
          review_status='submitted',
          keithstops_status=?,
          keithstops_reference=?,
          keithstops_error='',
          submitted_at=?,
          updated_at=?
        WHERE external_ref=?
      `).run(
        result.status ||
          'submitted_to_keith_tech_pos',
        String(
          result.reference ||
          externalRef
        ),
        now(),
        now(),
        externalRef
      );

      try {
        db.prepare(`
          INSERT INTO studio_notes (
            ref,
            type,
            note,
            actor,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(
          externalRef,
          'external_job_card_submission',
          `Submitted to Keith Tech POS. Reference: ${
            result.reference || externalRef
          }.`,
          'studio',
          now()
        );
      } catch {}

      const submitted = db.prepare(`
        SELECT *
        FROM external_job_cards
        WHERE external_ref=?
      `).get(externalRef);

      return res.json({
        ok: true,
        duplicatePrevented:
          result.status ===
          'already_submitted_to_keith_tech_pos',
        record:
          vpExternalJobCardView(
            submitted
          )
      });
    } catch (error) {
      console.error(
        'EXTERNAL_JOB_CARD_SUBMISSION_ERROR:',
        error
      );

      if (externalRef) {
        try {
          db.prepare(`
            UPDATE external_job_cards
            SET
              review_status='failed',
              keithstops_status='failed',
              keithstops_error=?,
              updated_at=?
            WHERE external_ref=?
          `).run(
            String(
              error.message || error
            ).slice(0, 2000),
            now(),
            externalRef
          );
        } catch {}
      }

      return res.status(500).json({
        ok: false,
        error:
          error.message ||
          'Submission failed.'
      });
    }
  }
);
// END_VP_EXTERNAL_JOB_CARDS_POS_SUBMISSION_V1

// END_VP_EXTERNAL_JOB_CARDS_BACKEND_V1

// VP_SECURE_CLAIM_DIGITAL_SIGNATURE_V1
const VP_CLAIM_SIGNATURE_DIR = path.join(ROOT, 'data', 'claim-signatures');
fs.mkdirSync(VP_CLAIM_SIGNATURE_DIR, { recursive: true });
try { fs.chmodSync(VP_CLAIM_SIGNATURE_DIR, 0o700); } catch (_) {}

db.exec(`
CREATE TABLE IF NOT EXISTS claim_signature_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_no TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  customer_phone TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claim_signature_tokens_claim
  ON claim_signature_tokens(claim_no, used_at, expires_at);
`);

function vpClaimSignatureTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function vpClaimSignatureHtmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function vpClaimSignatureLookup(token) {
  const tokenHash = vpClaimSignatureTokenHash(token);
  const row = db.prepare(`
    SELECT t.*, c.status AS claim_status, c.data AS claim_data,
           c.insurer, c.customer_phone AS claim_customer_phone
    FROM claim_signature_tokens t
    JOIN claims c ON c.claim_no=t.claim_no
    WHERE t.token_hash=?
    LIMIT 1
  `).get(tokenHash);

  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

function vpCreateClaimSignatureLink(claimNo, customerPhone) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = vpClaimSignatureTokenHash(rawToken);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + (60 * 60 * 1000)).toISOString();

  db.prepare(`
    UPDATE claim_signature_tokens
    SET used_at=?
    WHERE claim_no=? AND used_at IS NULL
  `).run(createdAt, claimNo);

  db.prepare(`
    INSERT INTO claim_signature_tokens
    (claim_no, token_hash, customer_phone, expires_at, used_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(
    claimNo,
    tokenHash,
    String(customerPhone || ''),
    expiresAt,
    createdAt
  );

  return {
    url: `${BASE_URL}/claim-sign/${rawToken}`,
    expiresAt
  };
}

async function vpSendClaimSignatureStep(to, claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) return sendText(to, 'Claim not found. Please reply MENU.');

  const data = safeJsonParse(claim.data, {});
  if (data.digitalSignaturePath || data.manualSignatureFallback) {
    return finishClaimDocuments(to, claimNo);
  }

  const signing = vpCreateClaimSignatureLink(claimNo, to);
  data.digitalSignatureStatus = 'pending';
  data.digitalSignatureRequestedAt = now();
  data.digitalSignatureExpiresAt = signing.expiresAt;

  db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
    .run('awaiting_digital_signature', JSON.stringify(data), now(), claimNo);

  setSession(to, 'claim_signature_pending', { claimNoInternal: claimNo });

  return sendButtons(to,
`Final step — sign your claim form

Open this secure link:
${signing.url}

Sign inside the box with your finger or stylus, then tap Submit Signature.

Wi-Fi is not required. Normal mobile data works.

If you do not have enough data to open the signing page, or you cannot use the link, tap Skip below. You will continue using the existing manual signature method.

Security:
- The link expires after 60 minutes
- It works once only
- The signature is stored securely on the workshop server
- The link does not expose your claim details`,
    [
      { id: 'claim_signature_skip', title: 'Skip' }
    ]
  );
}

async function handleClaimSignaturePending(to, input) {
  const session = getSession(to);
  const claimNo = session?.data?.claimNoInternal || '';
  const normalized = String(input || '').trim().toLowerCase();

  if (!claimNo) {
    resetSession(to);
    return sendText(to, 'Claim signing session expired. Please reply MENU.');
  }

  if ([
    'claim_signature_skip',
    'skip',
    'manual signature',
    'manual',
    'use manual signature',
    'manual signing'
  ].includes(normalized)) {
    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
    if (!claim) {
      resetSession(to);
      return sendText(to, 'Claim not found. Please reply MENU.');
    }

    const data = safeJsonParse(claim.data, {});
    data.manualSignatureFallback = true;
    data.digitalSignatureStatus = 'manual_fallback';
    data.signatureDate = data.signatureDate || harareDate();

    db.prepare(`
      UPDATE claim_signature_tokens
      SET used_at=?
      WHERE claim_no=? AND used_at IS NULL
    `).run(now(), claimNo);

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('generating_claim_pdf', JSON.stringify(data), now(), claimNo);

    resetSession(to);
    await sendText(to, 'Manual signature fallback selected. Generating your claim form using the existing signature method...');
    return finishClaimDocuments(to, claimNo);
  }

  if (['resend', 'resend link', 'new link', 'signature link'].includes(normalized)) {
    return vpSendClaimSignatureStep(to, claimNo);
  }

  return sendText(to,
`Please open the secure signing link sent above and submit your signature.

If the link expired, reply RESEND LINK.
If you cannot use the signing page, reply MANUAL SIGNATURE.`);
}

function vpClaimSignatureSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

app.get('/claim-sign/:token', (req, res) => {
  vpClaimSignatureSecurityHeaders(res);
  const row = vpClaimSignatureLookup(req.params.token);

  if (!row) {
    return res.status(404).type('html').send(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px"><h2>Signing link unavailable</h2><p>This link is invalid, expired or already used. Return to WhatsApp and reply <b>RESEND LINK</b>.</p></body></html>`);
  }

  const data = safeJsonParse(row.claim_data, {});
  const signer = vpClaimSignatureHtmlEscape(data.signatureOfInsured || data.insuredName || 'Insured customer');
  const claimRef = vpClaimSignatureHtmlEscape(row.claim_no);
  const insurer = vpClaimSignatureHtmlEscape(row.insurer || 'Insurance Claim');

  return res.status(200).type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Sign Claim Form</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#111827;font-family:Arial,sans-serif}.wrap{max-width:680px;margin:0 auto;padding:22px 16px 36px}.card{background:#fff;border-radius:18px;padding:22px;box-shadow:0 10px 30px rgba(15,23,42,.10)}h1{font-size:24px;margin:0 0 7px}.muted{color:#64748b;font-size:14px;line-height:1.45}.meta{margin:18px 0;padding:14px;border-radius:12px;background:#f8fafc;font-size:14px;line-height:1.6}.label{font-weight:700;margin:18px 0 8px}canvas{display:block;width:100%;height:230px;background:#fff;border:2px solid #cbd5e1;border-radius:12px;touch-action:none}.hint{font-size:12px;color:#64748b;margin-top:7px}.actions{display:flex;gap:10px;margin-top:18px}.btn{appearance:none;border:0;border-radius:12px;padding:14px 16px;font-size:16px;font-weight:700;cursor:pointer}.clear{background:#e2e8f0;color:#0f172a;flex:1}.submit{background:#0f172a;color:#fff;flex:2}.submit:disabled{opacity:.5}.status{margin-top:16px;padding:12px;border-radius:10px;display:none}.ok{background:#ecfdf5;color:#065f46}.err{background:#fef2f2;color:#991b1b}.secure{margin-top:18px;font-size:12px;color:#64748b;line-height:1.5}
</style>
</head>
<body>
<div class="wrap"><div class="card">
<h1>Sign your claim form</h1>
<div class="muted">Use your finger, stylus or mouse to sign below.</div>
<div class="meta"><b>${insurer}</b><br>Claim reference: ${claimRef}<br>Signer: ${signer}</div>
<div class="label">Signature of insured</div>
<canvas id="pad"></canvas>
<div class="hint">Sign naturally inside the box. You can clear and try again before submitting.</div>
<div class="actions"><button class="btn clear" id="clear">Clear</button><button class="btn submit" id="submit">Submit Signature</button></div>
<div id="status" class="status"></div>
<div class="secure">Secure one-time signing link. Your signature is attached only to this claim and the link expires automatically.</div>
</div></div>
<script>
const canvas=document.getElementById('pad'),ctx=canvas.getContext('2d');let drawing=false,drawn=false;
function fit(){const r=canvas.getBoundingClientRect(),d=Math.max(1,Math.min(2,window.devicePixelRatio||1));const old=canvas.toDataURL();canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0,0);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#111827';if(drawn){const i=new Image();i.onload=()=>ctx.drawImage(i,0,0,r.width,r.height);i.src=old}}
function point(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
canvas.addEventListener('pointerdown',e=>{drawing=true;drawn=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y)});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke()});
['pointerup','pointercancel','pointerleave'].forEach(n=>canvas.addEventListener(n,()=>{drawing=false}));
document.getElementById('clear').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);drawn=false};
document.getElementById('submit').onclick=async()=>{const btn=document.getElementById('submit'),st=document.getElementById('status');if(!drawn){st.className='status err';st.style.display='block';st.textContent='Please sign inside the box first.';return}btn.disabled=true;btn.textContent='Submitting...';try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signatureData:canvas.toDataURL('image/png')})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not submit signature');st.className='status ok';st.style.display='block';st.innerHTML='<b>Signature submitted.</b><br>You can return to WhatsApp. Your completed claim form will be sent there.';document.getElementById('clear').disabled=true;btn.textContent='Submitted'}catch(e){btn.disabled=false;btn.textContent='Submit Signature';st.className='status err';st.style.display='block';st.textContent=e.message||'Could not submit signature'}};
window.addEventListener('resize',fit);fit();
</script>
</body></html>`);
});

app.post('/claim-sign/:token', async (req, res) => {
  vpClaimSignatureSecurityHeaders(res);

  try {
    const row = vpClaimSignatureLookup(req.params.token);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Signing link is invalid, expired or already used.' });
    }

    const raw = String(req.body?.signatureData || '');
    const match = raw.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({ ok: false, error: 'A valid signature is required.' });
    }

    const input = Buffer.from(match[1], 'base64');
    if (input.length < 300 || input.length > 1500000) {
      return res.status(400).json({ ok: false, error: 'Signature image size is invalid.' });
    }
    if (!(input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4e && input[3] === 0x47)) {
      return res.status(400).json({ ok: false, error: 'Signature image format is invalid.' });
    }

    const fileName = `${row.claim_no}-${crypto.randomBytes(12).toString('hex')}-signature.png`;
    const absPath = path.join(VP_CLAIM_SIGNATURE_DIR, fileName);

    if (sharp) {
      await sharp(input, { limitInputPixels: 4000000 })
        .resize(1200, 420, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toFile(absPath);
    } else {
      fs.writeFileSync(absPath, input, { mode: 0o600 });
    }
    try { fs.chmodSync(absPath, 0o600); } catch (_) {}

    const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(row.claim_no);
    if (!claim) {
      try { fs.unlinkSync(absPath); } catch (_) {}
      return res.status(404).json({ ok: false, error: 'Claim was not found.' });
    }

    const data = safeJsonParse(claim.data, {});
    data.digitalSignaturePath = absPath;
    data.digitalSignatureStatus = 'completed';
    data.digitalSignatureMethod = 'drawn_web';
    data.digitalSignatureCompletedAt = now();
    data.signatureDate = harareDate();
    data.manualSignatureFallback = false;

    const tx = db.transaction(() => {
      const consumed = db.prepare(`
        UPDATE claim_signature_tokens
        SET used_at=?
        WHERE id=? AND used_at IS NULL
      `).run(now(), row.id);

      if (consumed.changes !== 1) {
        throw new Error('Signing link was already used.');
      }

      db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
        .run('digital_signature_received_generating_pdf', JSON.stringify(data), now(), row.claim_no);
    });
    tx();

    resetSession(row.customer_phone);

    res.status(200).json({ ok: true, claimNo: row.claim_no });

    setImmediate(() => {
      finishClaimDocuments(row.customer_phone, row.claim_no).catch(error => {
        console.error('CLAIM_SIGNATURE_PDF_COMPLETION_ERROR', {
          claimNo: row.claim_no,
          error: error.message
        });
      });
    });
  } catch (error) {
    console.error('CLAIM_SIGNATURE_SUBMIT_ERROR', error.message);
    return res.status(500).json({ ok: false, error: 'Could not submit the signature. Please return to WhatsApp and try again.' });
  }
});


app.listen(PORT, '127.0.0.1', () => {
  console.log(`Auto Glass Bot running on port ${PORT}`);
});

// VP_STRICT_OLD_MUTUAL_CLAIM_FLOW_V1
const VP_STRICT_CLAIM_FIELDS = [
  ['policyNo', 'Please type the policy number.', 'Example: POL123456'],
  ['agency', 'Please type the agency or broker name. If not applicable, type NONE.', 'Example: Direct / Broker name / NONE'],
  ['externalClaimNo', 'Please type the insurance claim number. If not available, type NOT SURE.', 'Example: CLM88991 or NOT SURE'],

  ['insuredName', 'Please type the name of insured.', 'Example: Tafadzwa Moyo'],
  ['occupation', 'Please type the occupation.', 'Example: Business owner'],
  ['address', 'Please type the full address.', 'Example: 24 Samora Machel Avenue, Harare'],
  ['email', 'Please type the email address.', 'Example: client@email.com'],
  ['telephone', 'Please type the business/contact telephone number.', 'Example: +263772935746'],
  ['homePhone', 'Please type the home phone number. If none, type NONE.', 'Example: NONE'],
  ['cell', 'Please type the cell number.', 'Example: +263772935746'],

  ['driverName', 'Please type the driver name at time of occurrence.', 'Example: Tafadzwa Moyo'],
  ['driverDob', 'Please type the driver date of birth.', 'Example: 14 May 1988'],
  ['driverAddress', 'Please type the driver address.', 'Example: 24 Samora Machel Avenue, Harare'],
  ['driverRelation', 'Is the driver the owner, owner’s employee, or owner’s relative/friend?', 'Please choose one option below.', [
    ['vp_rel_owner', 'Owner', 'owner'],
    ['vp_rel_employee', 'Employee', "owner's employee"],
    ['vp_rel_relative', 'Relative/Friend', "owner's relative or friend"]
  ]],
  ['fullLicence', 'Does the driver have a full driving licence?', 'Please choose Yes or No.', [
    ['vp_yes', 'Yes', 'Yes'],
    ['vp_no', 'No', 'No']
  ]],
  ['licenceNo', 'Please type the driver licence number.', 'Example: DL123456ZW'],
  ['licenceIssueDate', 'Please type the licence date of issue.', 'Example: 12 January 2022'],
  ['firstLicensed', 'When and where was the driver first licensed to drive?', 'Example: 2019, Harare VID'],
  ['drivingConvictions', 'Has the driver ever been convicted of a driving offence?', 'Please choose Yes or No.', [
    ['vp_yes', 'Yes', 'Yes'],
    ['vp_no', 'No', 'No']
  ]],
  ['drivingConvictionsDetails', 'If yes, give brief details and dates. If no, type NONE.', 'Example: NONE'],

  ['vehicle', 'Please type vehicle make/model/year.', 'Example: Toyota D-Max 2019'],
  ['reg', 'Please type vehicle registration number.', 'Example: ADF 1234'],
  ['bodyType', 'Please type body type.', 'Example: Sedan / SUV / Truck'],
  ['yearOfMake', 'Please type year of make. If already included, type SAME.', 'Example: 2019'],
  ['engineSize', 'Please type horsepower or engine size/cc. If not sure, type NOT SURE.', 'Example: 1500cc / NOT SURE'],
  ['vehicleUse', 'For what exact purpose was the vehicle being used?', 'Example: Personal use / company delivery'],

  ['damageDate', 'Please type the date of occurrence.', 'Example: 12 June 2026'],
  ['damageTime', 'Please type the time of occurrence.', 'Example: 8:30pm'],
  ['damagePlace', 'Please type the place of occurrence.', 'Example: Harare Drive'],
  ['cause', 'Please type the cause of breakage.', 'Example: Stone hit windscreen while driving'],
  ['otherDamage', 'Was there any other damage to the vehicle?', 'Please choose Yes or No.', [
    ['vp_yes', 'Yes', 'Yes'],
    ['vp_no', 'No', 'No']
  ]],
  ['otherDamageDetails', 'If yes, give details of the other damage. If no, type NONE.', 'Example: NONE'],
  ['glassType', 'Was the windscreen/glass clear, tinted, or shaded?', 'Please choose one option below.', [
    ['vp_clear', 'Clear', 'Clear'],
    ['vp_tinted', 'Tinted', 'Tinted'],
    ['vp_shaded', 'Shaded', 'Shaded']
  ]],
  ['existingDamage', 'Was the glass already damaged before this incident?', 'Please choose Yes or No.', [
    ['vp_yes', 'Yes', 'Yes'],
    ['vp_no', 'No', 'No']
  ]],
  ['existingDamageDetails', 'If yes, give details of the previous damage. If no, type NONE.', 'Example: NONE'],
  ['damageViewPlace', 'Where can the damaged vehicle be seen?', 'Example: 24 Samora Machel Avenue, Harare'],
  ['replacementInstructions', 'Have you given instructions for a replacement to be fitted?', 'Please choose one option below.', [
    ['vp_yes', 'Yes', 'Yes'],
    ['vp_no', 'No', 'No'],
    ['vp_notyet', 'Not Yet', 'Not yet']
  ]],
  ['estimatedCost', 'Please type the estimated cost, if known.', 'Example: USD 120 / NOT SURE'],

  ['signatureOfInsured', 'Please type the insured person’s full name exactly as it should appear with the signature.', 'Example: Tafadzwa Moyo']
];

function vpStrictClaimQuestion(idx) {
  const item = VP_STRICT_CLAIM_FIELDS[idx];
  if (!item) return 'Please continue.';

  return `${item[1]}

${item[2]}`;
}

function vpStrictClaimOptionValue(item, input) {
  const options = item?.[3] || [];
  const found = options.find(([id]) => id === input);
  return found ? found[2] : input;
}

async function sendClaimQuestion(to, idx) {
  const item = VP_STRICT_CLAIM_FIELDS[idx];
  if (!item) return sendText(to, 'Please continue.');

  const body = vpStrictClaimQuestion(idx);
  const options = item[3];

  if (Array.isArray(options) && options.length) {
    return sendButtons(
      to,
      body,
      options.map(([id, title]) => ({ id, title }))
    );
  }

  return sendGuidedPrompt(to, body, idx === 0 ? 'back_claim_insurers' : 'back_prev');
}

const vpClaimFlowLocks = new Map();

function vpQueueClaimAction(to, action) {
  const key = String(to);
  const previous =
    vpClaimFlowLocks.get(key) ||
    Promise.resolve();

  const running = previous
    .catch(() => null)
    .then(action);

  vpClaimFlowLocks.set(key, running);

  running.finally(() => {
    if (vpClaimFlowLocks.get(key) === running) {
      vpClaimFlowLocks.delete(key);
    }
  }).catch(() => null);

  return running;
}

function vpClaimPairRateLimited(error) {
  const payload =
    error?.response?.data ||
    error?.message ||
    error ||
    '';

  const serialized =
    typeof payload === 'string'
      ? payload
      : JSON.stringify(payload);

  return (
    serialized.includes('131056') ||
    /pair rate limit/i.test(serialized)
  );
}

function vpClaimWait(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

async function vpClaimSendReliable(
  to,
  label,
  sendAction
) {
  try {
    return await sendAction();
  } catch (error) {
    if (!vpClaimPairRateLimited(error)) {
      throw error;
    }

    console.warn('CLAIM_SEND_RATE_LIMIT_RETRY', {
      to,
      label,
      waitMs: 8000
    });

    await vpClaimWait(8000);

    const result = await sendAction();

    console.log('CLAIM_SEND_RETRY_SUCCESS', {
      to,
      label
    });

    return result;
  }
}

function vpClaimHasValue(value) {
  return !(
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  );
}

function vpNextMissingClaimFieldIndex(
  data,
  startingIndex = 0
) {
  for (
    let index = Math.max(0, startingIndex);
    index < VP_STRICT_CLAIM_FIELDS.length;
    index += 1
  ) {
    const key =
      VP_STRICT_CLAIM_FIELDS[index][0];

    if (
      typeof vpShouldSkipNextClaimField === 'function' &&
      vpShouldSkipNextClaimField(data, key)
    ) {
      continue;
    }

    if (!vpClaimHasValue(data[key])) {
      return index;
    }
  }

  return -1;
}

function vpMissingClaimUploadState(data) {
  const roles = data?.claimImageRoles || {};

  if (!roles.national_id) {
    return 'claim_upload_id';
  }

  if (!roles.driver_licence) {
    return 'claim_upload_licence';
  }

  if (!roles.vehicle_reg) {
    return 'claim_upload_vehicle_reg';
  }

  if (!roles.damage_glass) {
    return 'claim_upload_damage_glass';
  }

  return null;
}

function vpClaimUploadPrompt(state) {
  const prompts = {
    claim_upload_id:
`Please upload a clear photo of the customer's National ID.

The full ID card, name, ID number and photo must be visible.`,

    claim_upload_licence:
`Please upload a clear photo of the driver's licence.

The full licence card must be visible.`,

    claim_upload_vehicle_reg:
`Please upload a clear picture of the vehicle showing the registration number plate.`,

    claim_upload_damage_glass:
`Please upload a clear photo of the damaged glass.

Make sure the crack or damage is clearly visible.`
  };

  return (
    prompts[state] ||
    'Please upload the required claim document.'
  );
}

function vpClaimStatusForUploadState(state) {
  return {
    claim_upload_id: 'awaiting_id_photo',
    claim_upload_licence: 'awaiting_driver_licence',
    claim_upload_vehicle_reg:
      'awaiting_vehicle_reg_photo',
    claim_upload_damage_glass:
      'awaiting_damage_glass_photo'
  }[state] || 'collecting_claim_documents';
}

async function startClaim(
  to,
  insurer = 'Old Mutual'
) {
  const data = { insurer };

  await vpClaimSendReliable(
    to,
    'claim_introduction',
    () => sendText(
      to,
`${insurer} Motor Glass Claim Form

We will complete the full claim form step by step.

For professional accuracy, some questions will use buttons and some will require typed answers.

Required uploads after the form:
1. National ID photo
2. Driver's licence photo
3. Vehicle photo showing registration number
4. Clear photo of damaged glass

After the required fields and images are received, you will get a secure link to sign with your finger or stylus. The PDF is generated after signing.`
    )
  );

  setSession(to, 'claim_field_0', data);

  return vpClaimSendReliable(
    to,
    'claim_question_0',
    () => sendClaimQuestion(to, 0)
  );
}

function vpShouldSkipNextClaimField(data, nextKey) {
  const convictions = String(data.drivingConvictions || '').toLowerCase();
  const otherDamage = String(data.otherDamage || '').toLowerCase();
  const existingDamage = String(data.existingDamage || '').toLowerCase();

  if (nextKey === 'drivingConvictionsDetails' && convictions === 'no') {
    data.drivingConvictionsDetails = 'NONE';
    return true;
  }

  if (nextKey === 'otherDamageDetails' && otherDamage === 'no') {
    data.otherDamageDetails = 'NONE';
    return true;
  }

  if (nextKey === 'existingDamageDetails' && existingDamage === 'no') {
    data.existingDamageDetails = 'NONE';
    return true;
  }

  return false;
}

async function handleClaim(to, input) {
  const session = getSession(to);
  const data = session.data || {};
  const state = String(session.state || '');
  const index = Number(
    state.replace('claim_field_', '')
  );

  const item =
    VP_STRICT_CLAIM_FIELDS[index];

  if (!item) {
    return sendText(
      to,
      'Please reply MENU to restart.'
    );
  }

  const answer = String(input || '').trim();
  const key = item[0];
  const options = item[3] || [];

  if (!answer) {
    console.log('CLAIM_EMPTY_ANSWER_IGNORED', {
      to,
      state,
      key
    });

    return;
  }

  if (
    Array.isArray(options) &&
    options.length &&
    !vpClaimOptionMatch(item, answer)
  ) {
    console.log('CLAIM_INVALID_OPTION_BLOCKED', {
      to,
      state,
      key,
      input: answer.slice(0, 100)
    });

    return vpClaimSendReliable(
      to,
      `claim_repeat_${index}`,
      () => sendClaimQuestion(to, index)
    );
  }

  data[key] =
    vpStrictClaimOptionValue(item, answer);

  let nextIndex = index + 1;

  while (
    nextIndex <
    VP_STRICT_CLAIM_FIELDS.length
  ) {
    const nextKey =
      VP_STRICT_CLAIM_FIELDS[nextIndex][0];

    if (
      vpShouldSkipNextClaimField(
        data,
        nextKey
      )
    ) {
      nextIndex += 1;
      continue;
    }

    if (vpClaimHasValue(data[nextKey])) {
      nextIndex += 1;
      continue;
    }

    break;
  }

  const existingClaimNo =
    data.claimNoInternal ||
    data.claimNo ||
    data.claim ||
    data.claimRef ||
    '';

  if (
    nextIndex <
    VP_STRICT_CLAIM_FIELDS.length
  ) {
    await vpClaimSendReliable(
      to,
      `claim_question_${nextIndex}`,
      () => sendClaimQuestion(
        to,
        nextIndex
      )
    );

    setSession(
      to,
      `claim_field_${nextIndex}`,
      data
    );

    if (existingClaimNo) {
      db.prepare(`
        UPDATE claims
        SET status=?, data=?, updated_at=?
        WHERE claim_no=?
      `).run(
        'collecting_missing_required_fields',
        JSON.stringify(data),
        now(),
        existingClaimNo
      );
    }

    return;
  }

  data.signatureDate =
    data.signatureDate ||
    harareDate();

  if (existingClaimNo) {
    const uploadState =
      vpMissingClaimUploadState(data);

    if (uploadState) {
      await vpClaimSendReliable(
        to,
        uploadState,
        () => sendUploadPrompt(
          to,
          vpClaimUploadPrompt(uploadState),
          'back_prev'
        )
      );

      setSession(
        to,
        uploadState,
        data
      );

      db.prepare(`
        UPDATE claims
        SET status=?, data=?, updated_at=?
        WHERE claim_no=?
      `).run(
        vpClaimStatusForUploadState(
          uploadState
        ),
        JSON.stringify(data),
        now(),
        existingClaimNo
      );

      return;
    }

    const missing =
      vpRequiredClaimMissing(data);

    if (missing.length) {
      db.prepare(`
        UPDATE claims
        SET status=?, data=?, updated_at=?
        WHERE claim_no=?
      `).run(
        'claim_incomplete_missing_required_fields',
        JSON.stringify(data),
        now(),
        existingClaimNo
      );

      return vpClaimSendReliable(
        to,
        'claim_unresolved_missing_fields',
        () => sendText(
          to,
`The claim still needs attention.

Missing:
${missing.map(value => `- ${value}`).join('\n')}

Please choose Talk to Team from the menu for assistance.`
        )
      );
    }

    db.prepare(`
      UPDATE claims
      SET status=?, data=?, updated_at=?
      WHERE claim_no=?
    `).run(
      'generating_claim_pdf',
      JSON.stringify(data),
      now(),
      existingClaimNo
    );

    await vpClaimSendReliable(
      to,
      'claim_generating_pdf',
      () => sendText(
        to,
        'All claim details and required images have been received.\n\nGenerating your digital claim form PDF now...'
      )
    );

    return finishClaimDocuments(
      to,
      existingClaimNo
    );
  }

  const claimNo =
    nextNo('CL', 'claims');

  data.claimNoInternal = claimNo;
  data.idPhotoReceived = false;
  data.licencePhotoReceived = false;
  data.vehicleRegPhotoReceived = false;
  data.damageGlassPhotoReceived = false;
  data.documentVerification =
    'pending_upload';
  data.customerConfirmation = 'pending';

  await vpClaimSendReliable(
    to,
    'claim_first_upload_prompt',
    () => sendUploadPrompt(
      to,
`Claim details captured.

Claim Reference: ${claimNo}

Next step:
${vpClaimUploadPrompt('claim_upload_id')}`,
      'back_prev'
    )
  );

  db.prepare(`
    INSERT INTO claims
    (
      claim_no,
      customer_phone,
      insurer,
      status,
      data,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    claimNo,
    to,
    data.insurer || 'Old Mutual',
    'awaiting_id_photo',
    JSON.stringify(data),
    now(),
    now()
  );

  setSession(
    to,
    'claim_upload_id',
    data
  );
}

function vpClaimCompletenessMissing(data) {
  const required = [
    ['policyNo', 'Policy number'],
    ['agency', 'Agency / broker'],
    ['insuredName', 'Name of insured'],
    ['occupation', 'Occupation'],
    ['address', 'Address'],
    ['email', 'Email'],
    ['telephone', 'Telephone number'],
    ['driverName', 'Driver name'],
    ['driverDob', 'Driver date of birth'],
    ['driverAddress', 'Driver address'],
    ['driverRelation', 'Driver relationship'],
    ['fullLicence', 'Full driving licence answer'],
    ['licenceNo', 'Licence number'],
    ['licenceIssueDate', 'Licence date of issue'],
    ['firstLicensed', 'When/where first licensed'],
    ['drivingConvictions', 'Driving conviction answer'],
    ['vehicle', 'Vehicle make/model/year'],
    ['reg', 'Vehicle registration'],
    ['bodyType', 'Body type'],
    ['vehicleUse', 'Vehicle use'],
    ['damageDate', 'Date of occurrence'],
    ['damageTime', 'Time of occurrence'],
    ['damagePlace', 'Place of occurrence'],
    ['cause', 'Cause of breakage'],
    ['otherDamage', 'Other damage answer'],
    ['glassType', 'Glass type'],
    ['existingDamage', 'Existing damage answer'],
    ['damageViewPlace', 'Where vehicle can be seen'],
    ['replacementInstructions', 'Replacement instruction answer'],
    ['estimatedCost', 'Estimated cost'],
    ['signatureOfInsured', 'Signature of insured']
  ];

  const missing = [];

  for (const [key, label] of required) {
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === '') missing.push(label);
  }

  if (!data.idPhotoReceived) missing.push('National ID photo');
  if (!data.licencePhotoReceived) missing.push("Driver's licence photo");
  if (!data.vehicleRegPhotoReceived) missing.push('Vehicle photo showing registration number');
  if (!data.damageGlassPhotoReceived) missing.push('Clear damaged glass photo');

  return missing;
}

async function handleClaimUpload(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};
  const claimNo = data.claimNoInternal || data.claimNo || data.claim || data.claimRef;

  if (!claimNo) {
    resetSession(to);
    return sendText(to, 'Claim session expired. Please reply MENU and start again.');
  }

  if (!['image', 'document'].includes(inbound.type)) {
    if (s.state === 'claim_upload_id') {
      return sendUploadPrompt(to, 'Please upload a clear photo/document of the National ID.', 'back_prev');
    }

    if (s.state === 'claim_upload_licence') {
      return sendUploadPrompt(to, "Please upload a clear photo/document of the driver's licence.", 'back_prev');
    }

    if (s.state === 'claim_upload_vehicle_reg') {
      return sendUploadPrompt(to, 'Please upload a clear vehicle photo showing the registration number plate.', 'back_prev');
    }

    if (s.state === 'claim_upload_damage_glass') {
      return sendUploadPrompt(to, 'Please upload a clear photo of the damaged glass.', 'back_prev');
    }

    return sendUploadPrompt(to, 'Please upload the required photo/document.', 'back_prev');
  }

  const saved = saveAttachment(to, inbound, null, claimNo);

  if (s.state === 'claim_upload_id') {
    data.idPhotoReceived = true;
    data.nationalIdPhoto = saved.url || saved.path || '';
    data.documentVerification = 'id_received_waiting_licence';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('awaiting_driver_licence', JSON.stringify(data), now(), claimNo);

    setSession(to, 'claim_upload_licence', data);

    return sendUploadPrompt(to,
`National ID received.

Next required upload:
Please upload a clear photo of the driver's licence.

The photo must show the full licence card clearly.`,
      'back_prev'
    );
  }

  if (s.state === 'claim_upload_licence') {
    data.licencePhotoReceived = true;
    data.driverLicencePhoto = saved.url || saved.path || '';
    data.documentVerification = 'licence_received_waiting_vehicle_reg_photo';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('awaiting_vehicle_reg_photo', JSON.stringify(data), now(), claimNo);

    setSession(to, 'claim_upload_vehicle_reg', data);

    return sendUploadPrompt(to,
`Driver's licence received.

Next required upload:
Please take and upload a picture of the vehicle showing the registration number plate clearly.`,
      'back_prev'
    );
  }

  if (s.state === 'claim_upload_vehicle_reg') {
    data.vehicleRegPhotoReceived = true;
    data.vehicleRegPhoto = saved.url || saved.path || '';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('awaiting_damage_glass_photo', JSON.stringify(data), now(), claimNo);

    setSession(to, 'claim_upload_damage_glass', data);

    return sendUploadPrompt(to,
`Vehicle registration photo received.

Final required upload:
Please upload a clear photo of the damaged glass.

Make sure the crack/damage is visible.`,
      'back_prev'
    );
  }

  if (s.state === 'claim_upload_damage_glass') {
    data.damageGlassPhotoReceived = true;
    data.damagedGlassPhoto = saved.url || saved.path || '';
    data.documentVerification = 'documents_received_running_verification';

    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('generating_claim_pdf', JSON.stringify(data), now(), claimNo);

    resetSession(to);

    const missing = vpClaimCompletenessMissing(data);
    if (missing.length) {
      db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
        .run('claim_incomplete_missing_required_fields', JSON.stringify(data), now(), claimNo);

      return sendText(to,
`The claim is not complete yet.

Missing:
${missing.map(x => `- ${x}`).join('\n')}

Please reply MENU and start again, or contact the team to correct this claim.`
      );
    }

    await sendText(to, 'All claim details and required images have been received.\n\nGenerating your digital claim form PDF now...');
    return finishClaimDocuments(to, claimNo);
  }

  return sendText(to, 'Please reply MENU to restart.');
}

async function finishClaimDocuments(to, claimNo) {
  const claim = db.prepare('SELECT * FROM claims WHERE claim_no=?').get(claimNo);
  if (!claim) return sendText(to, 'Claim not found. Please reply MENU.');

  const data = safeJsonParse(claim.data, {});
  const missing = vpClaimCompletenessMissing(data);

  if (missing.length) {
    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('claim_incomplete_missing_required_fields', JSON.stringify(data), now(), claimNo);

    return sendText(to,
`The claim form cannot be generated yet.

Missing:
${missing.map(x => `- ${x}`).join('\n')}

Please contact the team so they can complete the missing information.`
    );
  }

  // VP_CLAIM_DIGITAL_SIGNATURE_GATE_V1
  if (!data.digitalSignaturePath && !data.manualSignatureFallback) {
    return vpSendClaimSignatureStep(to, claimNo);
  }

  const verification = await verifyClaimDocuments(claimNo);

  data.documentVerification = verification.status;
  data.verificationSummary = verification.summary || '';
  data.verificationScore = verification.score || null;
  data.customerConfirmation = 'pending';

  let status = 'documents_received_pending_confirmation';
  if (verification.status === 'verified') status = 'documents_verified_pending_customer_confirmation';
  if (verification.status === 'rejected') status = 'documents_rejected_pending_manual_review';

  db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
    .run(status, JSON.stringify(data), now(), claimNo);

  const pdf = await generateClaimPdfFile(claimNo);

  await sendDocument(to, pdf.pdfUrl, `${claimNo}-claim-form.pdf`,
`Claim form PDF

Claim Reference: ${claimNo}`
  );

  return sendButtons(to,
`CLAIM PDF GENERATED

Claim: ${claimNo}
Insurer: ${claim.insurer || data.insurer || '-'}
Customer: ${data.insuredName || '-'}
Phone: ${claim.customer_phone || to}
Vehicle: ${data.vehicle || '-'}
Reg: ${data.reg || '-'}

Documents:
National ID received
Driver's licence received
Vehicle registration photo received
Damaged glass photo received
Signature: ${data.signatureOfInsured || '-'}

Verification: ${verification.status}
Summary: ${verification.summary || '-'}

Is everything correct?`,
    [
      { id: `claim_confirm_${claimNo}`, title: 'Confirm Correct' },
      { id: `claim_change_${claimNo}`, title: 'Needs Changes' },
      { id: 'menu_team', title: 'Talk to Team' }
    ]
  );
}

// VP_CLAIM_NOT_SURE_AND_EXACT_PHOTO_LABELS_V1
const VP_NOT_SURE_CLAIM_FIELDS = new Set([
  'policyNo',
  'externalClaimNo',
  'homePhone',
  'engineSize',
  'estimatedCost'
]);

// VP_CLAIM_BUTTON_TITLE_COMPAT_V1
function vpClaimOptionNormalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function vpClaimOptionMatch(item, input) {
  const normalized = vpClaimOptionNormalize(input);
  const options = item?.[3] || [];

  if (!normalized) return null;

  return options.find(([id, title, value]) => {
    return [id, title, value]
      .some(candidate => vpClaimOptionNormalize(candidate) === normalized);
  }) || null;
}

function vpStrictClaimOptionValue(item, input) {
  if (vpClaimOptionNormalize(input) === 'vp_not_sure') return 'NOT SURE';

  const found = vpClaimOptionMatch(item, input);
  return found ? found[2] : input;
}

async function sendClaimQuestion(to, idx) {
  const item = VP_STRICT_CLAIM_FIELDS[idx];

  if (!item) return sendText(to, 'Please continue.');

  const key = item[0];
  const body = vpStrictClaimQuestion(idx);
  const options = item[3];

  if (Array.isArray(options) && options.length) {
    return sendButtons(
      to,
      body,
      options.map(([id, title]) => ({ id, title }))
    );
  }

  if (VP_NOT_SURE_CLAIM_FIELDS.has(key)) {
    return sendButtons(
      to,
`${body}

Type your answer below, or tap *Not Sure* if you do not have it.`,
      [
        { id: 'vp_not_sure', title: 'Not Sure' },
        { id: 'back_prev', title: 'Back' }
      ]
    );
  }

  return sendGuidedPrompt(to, body, idx === 0 ? 'back_claim_insurers' : 'back_prev');
}

// VP_POLISHED_CLAIM_QUESTION_WORDING_V2
function vpPolishClaimPrompt(body, mode = 'text') {
  if (mode === 'not_sure') {
    return `${body}

✍️ *Type your answer below.*

❓ If you do not have this information, tap *Not Sure*.

↩️ Use *Back* if you need to correct the previous step.`;
  }

  if (mode === 'choice') {
    return `${body}

👇 *Please tap the correct option below.*

↩️ If you need to correct the previous step, type *back*.`;
  }

  return `${body}

✍️ *Type your answer below.*

↩️ Use *Back* if you need to correct the previous step.`;
}

async function sendClaimQuestion(to, idx) {
  const item = VP_STRICT_CLAIM_FIELDS[idx];

  if (!item) return sendText(to, 'Please continue.');

  const key = item[0];
  const body = vpStrictClaimQuestion(idx);
  const options = item[3];

  if (Array.isArray(options) && options.length) {
    return sendButtons(
      to,
      vpPolishClaimPrompt(body, 'choice'),
      options.map(([id, title]) => ({ id, title }))
    );
  }

  if (VP_NOT_SURE_CLAIM_FIELDS.has(key)) {
    return sendButtons(
      to,
      vpPolishClaimPrompt(body, 'not_sure'),
      [
        { id: 'vp_not_sure', title: '❓ Not Sure' },
        { id: 'back_prev', title: '⬅️ Back' }
      ]
    );
  }

  return sendGuidedPrompt(to, vpPolishClaimPrompt(body, 'text'), idx === 0 ? 'back_claim_insurers' : 'back_prev');
}

// VP_CLAIM_IMAGE_ROLE_HANDLER_V4
function vpEnsureAttachmentRoleColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);

    if (!cols.includes('claim_role')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN claim_role TEXT").run();
    }

    if (!cols.includes('role_label')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN role_label TEXT").run();
    }

    if (!cols.includes('role_order')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN role_order INTEGER").run();
    }
  } catch (e) {
    console.error('VP_ENSURE_ATTACHMENT_ROLE_COLUMNS_ERROR', e.message);
  }
}

function vpClaimRoleLabel(role) {
  return {
    national_id: 'National ID',
    driver_licence: "Driver's Licence",
    vehicle_reg: 'Vehicle Registration Photo',
    damage_glass: 'Damaged Glass Photo'
  }[role] || 'Claim Image';
}

function vpClaimRoleOrder(role) {
  return {
    national_id: 1,
    driver_licence: 2,
    vehicle_reg: 3,
    damage_glass: 4
  }[role] || 99;
}

function vpTagLatestClaimAttachment(claimNo, saved, role) {
  vpEnsureAttachmentRoleColumns();

  const label = vpClaimRoleLabel(role);
  const order = vpClaimRoleOrder(role);

  try {
    const cols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);

    if (!cols.includes('claim_role')) return null;

    let row = null;

    if (saved?.id) {
      try {
        row = db.prepare('SELECT * FROM attachments WHERE id=?').get(saved.id);
      } catch (_) {}
    }

    if (!row && saved?.mediaId) {
      try {
        row = db.prepare('SELECT * FROM attachments WHERE claim_no=? AND media_id=? ORDER BY id DESC LIMIT 1').get(claimNo, saved.mediaId);
      } catch (_) {}
    }

    if (!row && saved?.url) {
      try {
        row = db.prepare('SELECT * FROM attachments WHERE claim_no=? AND url=? ORDER BY id DESC LIMIT 1').get(claimNo, saved.url);
      } catch (_) {}
    }

    if (!row) {
      row = db.prepare('SELECT * FROM attachments WHERE claim_no=? ORDER BY id DESC LIMIT 1').get(claimNo);
    }

    if (!row) return null;

    db.prepare('UPDATE attachments SET claim_role=?, role_label=?, role_order=? WHERE id=?')
      .run(role, label, order, row.id);

    return { ...row, claim_role: role, role_label: label, role_order: order };
  } catch (e) {
    console.error('VP_TAG_CLAIM_ATTACHMENT_ERROR', e.message);
    return null;
  }
}

function vpSavedClaimImageObject(saved, tagged, role) {
  return {
    role,
    label: vpClaimRoleLabel(role),
    url: saved?.url || tagged?.url || '',
    path: saved?.path || saved?.filePath || saved?.file_path || tagged?.file_path || tagged?.path || '',
    mediaId: saved?.mediaId || tagged?.media_id || '',
    attachmentId: tagged?.id || saved?.id || '',
    savedAt: now()
  };
}

async function handleClaimUpload(to, input, inbound) {
  const s = getSession(to);
  const data = s.data || {};
  const claimNo = data.claimNoInternal || data.claimNo || data.claim || data.claimRef;

  if (!claimNo) {
    resetSession(to);
    return sendText(to, 'Claim session expired. Please reply MENU and start again.');
  }

  const stepMap = {
    claim_upload_id: {
      role: 'national_id',
      dataKey: 'nationalIdPhoto',
      flag: 'idPhotoReceived',
      status: 'awaiting_driver_licence',
      nextState: 'claim_upload_licence',
      receivedText: 'National ID received.',
      nextPrompt: `Next required upload:
Please upload a clear photo of the driver's licence.

The photo must show the full licence card clearly.`
    },
    claim_upload_licence: {
      role: 'driver_licence',
      dataKey: 'driverLicencePhoto',
      flag: 'licencePhotoReceived',
      status: 'awaiting_vehicle_reg_photo',
      nextState: 'claim_upload_vehicle_reg',
      receivedText: "Driver's licence received.",
      nextPrompt: `Next required upload:
Please take and upload a picture of the vehicle showing the registration number plate clearly.`
    },
    claim_upload_vehicle_reg: {
      role: 'vehicle_reg',
      dataKey: 'vehicleRegPhoto',
      flag: 'vehicleRegPhotoReceived',
      status: 'awaiting_damage_glass_photo',
      nextState: 'claim_upload_damage_glass',
      receivedText: 'Vehicle registration photo received.',
      nextPrompt: `Final required upload:
Please upload a clear photo of the damaged glass.

Make sure the crack/damage is visible.`
    },
    claim_upload_damage_glass: {
      role: 'damage_glass',
      dataKey: 'damagedGlassPhoto',
      flag: 'damageGlassPhotoReceived',
      status: 'generating_claim_pdf',
      nextState: null,
      receivedText: 'Damaged glass photo received.',
      nextPrompt: ''
    }
  };

  const step = stepMap[s.state];

  if (!step) {
    return sendText(to, 'Please reply MENU to restart.');
  }

  if (!['image', 'document'].includes(inbound.type)) {
    return sendUploadPrompt(to, `Please upload the required image/document for: ${vpClaimRoleLabel(step.role)}.`, 'back_prev');
  }

  const saved = saveAttachment(to, inbound, null, claimNo);
  const tagged = vpTagLatestClaimAttachment(claimNo, saved, step.role);

  data[step.flag] = true;
  data[step.dataKey] = vpSavedClaimImageObject(saved, tagged, step.role);

  data.claimImageRoles = data.claimImageRoles || {};
  data.claimImageRoles[step.role] = data[step.dataKey];

  if (step.nextState) {
    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run(step.status, JSON.stringify(data), now(), claimNo);

    setSession(to, step.nextState, data);

    return sendUploadPrompt(to, `${step.receivedText}

${step.nextPrompt}`, 'back_prev');
  }

  data.documentVerification = 'documents_received_running_verification';

  db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
    .run(step.status, JSON.stringify(data), now(), claimNo);

  resetSession(to);

  const missing = vpClaimCompletenessMissing(data);

  if (missing.length) {
    db.prepare('UPDATE claims SET status=?, data=?, updated_at=? WHERE claim_no=?')
      .run('claim_incomplete_missing_required_fields', JSON.stringify(data), now(), claimNo);

    return sendText(to,
`The claim is not complete yet.

Missing:
${missing.map(x => `- ${x}`).join('\n')}

Please contact the team to correct this claim.`
    );
  }

  await sendText(to, 'All claim details and required images have been received.\n\nGenerating your digital claim form PDF now...');

  return finishClaimDocuments(to, claimNo);
}

function vpClaimCompletenessMissing(data) {
  const required = [
    ['policyNo', 'Policy number'],
    ['agency', 'Agency / broker'],
    ['insuredName', 'Name of insured'],
    ['occupation', 'Occupation'],
    ['address', 'Address'],
    ['email', 'Email'],
    ['telephone', 'Telephone number'],
    ['driverName', 'Driver name'],
    ['driverDob', 'Driver date of birth'],
    ['driverAddress', 'Driver address'],
    ['driverRelation', 'Driver relationship'],
    ['fullLicence', 'Full driving licence answer'],
    ['licenceNo', 'Licence number'],
    ['licenceIssueDate', 'Licence date of issue'],
    ['firstLicensed', 'When/where first licensed'],
    ['drivingConvictions', 'Driving conviction answer'],
    ['vehicle', 'Vehicle make/model/year'],
    ['reg', 'Vehicle registration'],
    ['bodyType', 'Body type'],
    ['vehicleUse', 'Vehicle use'],
    ['damageDate', 'Date of occurrence'],
    ['damageTime', 'Time of occurrence'],
    ['damagePlace', 'Place of occurrence'],
    ['cause', 'Cause of breakage'],
    ['otherDamage', 'Other damage answer'],
    ['glassType', 'Glass type'],
    ['existingDamage', 'Existing damage answer'],
    ['damageViewPlace', 'Where vehicle can be seen'],
    ['replacementInstructions', 'Replacement instruction answer'],
    ['estimatedCost', 'Estimated cost'],
    ['signatureOfInsured', 'Signature of insured']
  ];

  const missing = [];

  for (const [key, label] of required) {
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === '') missing.push(label);
  }

  const roles = data.claimImageRoles || {};

  if (!data.idPhotoReceived || !roles.national_id) missing.push('National ID photo');
  if (!data.licencePhotoReceived || !roles.driver_licence) missing.push("Driver's licence photo");
  if (!data.vehicleRegPhotoReceived || !roles.vehicle_reg) missing.push('Vehicle photo showing registration number');
  if (!data.damageGlassPhotoReceived || !roles.damage_glass) missing.push('Clear damaged glass photo');

  return missing;
}

// VP_COMPLETE_CLAIM_IMAGE_ROLE_REBUILD_V1
function vpImageRoleLabel(role) {
  return {
    national_id: 'National ID',
    driver_licence: "Driver's Licence",
    vehicle_reg: 'Vehicle Registration Photo',
    damage_glass: 'Damaged Glass Photo'
  }[role] || 'Claim Image';
}

function vpImageRoleOrder(role) {
  return {
    national_id: 1,
    driver_licence: 2,
    vehicle_reg: 3,
    damage_glass: 4
  }[role] || 99;
}

function vpEnsureImageRoleColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);

    if (!cols.includes('claim_role')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN claim_role TEXT").run();
    }

    if (!cols.includes('role_label')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN role_label TEXT").run();
    }

    if (!cols.includes('role_order')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN role_order INTEGER").run();
    }
  } catch (e) {
    console.error('VP_IMAGE_ROLE_COLUMNS_ERROR', e.message);
  }
}

function vpFindLatestAttachmentForUpload(claimNo, saved) {
  try {
    if (saved?.id) {
      const row = db.prepare('SELECT * FROM attachments WHERE id=?').get(saved.id);
      if (row) return row;
    }

    if (saved?.mediaId) {
      const row = db.prepare('SELECT * FROM attachments WHERE claim_no=? AND media_id=? ORDER BY id DESC LIMIT 1')
        .get(claimNo, saved.mediaId);
      if (row) return row;
    }

    if (saved?.url) {
      const row = db.prepare('SELECT * FROM attachments WHERE claim_no=? AND url=? ORDER BY id DESC LIMIT 1')
        .get(claimNo, saved.url);
      if (row) return row;
    }

    return db.prepare('SELECT * FROM attachments WHERE claim_no=? ORDER BY id DESC LIMIT 1').get(claimNo);
  } catch (e) {
    console.error('VP_FIND_LATEST_ATTACHMENT_ERROR', e.message);
    return null;
  }
}

function vpTagAttachmentWithRole(claimNo, saved, role) {
  vpEnsureImageRoleColumns();

  const row = vpFindLatestAttachmentForUpload(claimNo, saved);
  if (!row) return null;

  const label = vpImageRoleLabel(role);
  const order = vpImageRoleOrder(role);

  try {
    db.prepare('UPDATE attachments SET claim_role=?, role_label=?, role_order=? WHERE id=?')
      .run(role, label, order, row.id);

    return {
      ...row,
      claim_role: role,
      role_label: label,
      role_order: order
    };
  } catch (e) {
    console.error('VP_TAG_ATTACHMENT_ROLE_ERROR', e.message);
    return row;
  }
}

function vpRoleImageData(saved, tagged, role) {
  return {
    role,
    label: vpImageRoleLabel(role),
    url: saved?.url || tagged?.url || '',
    path: saved?.path || saved?.filePath || saved?.file_path || tagged?.file_path || tagged?.path || tagged?.url || '',
    mediaId: saved?.mediaId || tagged?.media_id || '',
    attachmentId: tagged?.id || saved?.id || '',
    uploadedAt: now()
  };
}

function vpRequiredClaimMissing(data) {
  const required = [
    ['policyNo', 'Policy number'],
    ['agency', 'Agency / broker'],
    ['insuredName', 'Name of insured'],
    ['occupation', 'Occupation'],
    ['address', 'Address'],
    ['email', 'Email'],
    ['telephone', 'Telephone number'],
    ['driverName', 'Driver name'],
    ['driverDob', 'Driver date of birth'],
    ['driverAddress', 'Driver address'],
    ['driverRelation', 'Driver relationship'],
    ['fullLicence', 'Full driving licence answer'],
    ['licenceNo', 'Licence number'],
    ['licenceIssueDate', 'Licence date of issue'],
    ['firstLicensed', 'When/where first licensed'],
    ['drivingConvictions', 'Driving conviction answer'],
    ['vehicle', 'Vehicle make/model/year'],
    ['reg', 'Vehicle registration'],
    ['bodyType', 'Body type'],
    ['vehicleUse', 'Vehicle use'],
    ['damageDate', 'Date of occurrence'],
    ['damageTime', 'Time of occurrence'],
    ['damagePlace', 'Place of occurrence'],
    ['cause', 'Cause of breakage'],
    ['otherDamage', 'Other damage answer'],
    ['glassType', 'Glass type'],
    ['existingDamage', 'Existing damage answer'],
    ['damageViewPlace', 'Where vehicle can be seen'],
    ['replacementInstructions', 'Replacement instruction answer'],
    ['estimatedCost', 'Estimated cost'],
    ['signatureOfInsured', 'Signature of insured']
  ];

  const missing = [];

  for (const [key, label] of required) {
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === '') missing.push(label);
  }

  const roles = data.claimImageRoles || {};

  if (!roles.national_id) missing.push('National ID photo');
  if (!roles.driver_licence) missing.push("Driver's licence photo");
  if (!roles.vehicle_reg) missing.push('Vehicle photo showing registration number');
  if (!roles.damage_glass) missing.push('Clear damaged glass photo');

  return missing;
}

function vpClaimCompletenessMissing(data) {
  return vpRequiredClaimMissing(data);
}

async function handleClaimUpload(
  to,
  input,
  inbound
) {
  const session = getSession(to);
  const data = session.data || {};
  const state = String(
    session.state || ''
  );

  const claimNo =
    data.claimNoInternal ||
    data.claimNo ||
    data.claim ||
    data.claimRef;

  if (!claimNo) {
    resetSession(to);

    return sendText(
      to,
      'Claim session expired. Please reply MENU and start again.'
    );
  }

  const steps = {
    claim_upload_id: {
      role: 'national_id',
      flag: 'idPhotoReceived',
      status: 'awaiting_driver_licence',
      nextState: 'claim_upload_licence',
      done: 'National ID received.'
    },

    claim_upload_licence: {
      role: 'driver_licence',
      flag: 'licencePhotoReceived',
      status: 'awaiting_vehicle_reg_photo',
      nextState: 'claim_upload_vehicle_reg',
      done: "Driver's licence received."
    },

    claim_upload_vehicle_reg: {
      role: 'vehicle_reg',
      flag: 'vehicleRegPhotoReceived',
      status: 'awaiting_damage_glass_photo',
      nextState: 'claim_upload_damage_glass',
      done:
        'Vehicle registration photo received.'
    },

    claim_upload_damage_glass: {
      role: 'damage_glass',
      flag: 'damageGlassPhotoReceived',
      status: 'generating_claim_pdf',
      nextState: null,
      done: 'Damaged glass photo received.'
    }
  };

  const step = steps[state];

  if (!step) {
    return sendText(
      to,
      'Please reply MENU to restart.'
    );
  }

  const existingRole =
    data.claimImageRoles?.[step.role];

  if (
    !existingRole &&
    !['image', 'document'].includes(
      String(inbound?.type || '')
    )
  ) {
    return vpClaimSendReliable(
      to,
      `claim_repeat_upload_${step.role}`,
      () => sendUploadPrompt(
        to,
        vpClaimUploadPrompt(state),
        'back_prev'
      )
    );
  }

  if (!existingRole) {
    const saved = saveAttachment(
      to,
      inbound,
      null,
      claimNo
    );

    const tagged =
      vpTagAttachmentWithRole(
        claimNo,
        saved,
        step.role
      );

    data.claimImageRoles =
      data.claimImageRoles || {};

    data.claimImageRoles[step.role] =
      vpRoleImageData(
        saved,
        tagged,
        step.role
      );

    data[step.flag] = true;

    if (step.role === 'national_id') {
      data.nationalIdPhoto =
        data.claimImageRoles[step.role];
    }

    if (step.role === 'driver_licence') {
      data.driverLicencePhoto =
        data.claimImageRoles[step.role];
    }

    if (step.role === 'vehicle_reg') {
      data.vehicleRegPhoto =
        data.claimImageRoles[step.role];
    }

    if (step.role === 'damage_glass') {
      data.damagedGlassPhoto =
        data.claimImageRoles[step.role];
    }

    // Preserve the successful upload while remaining
    // on the current state until the next prompt sends.
    setSession(to, state, data);

    db.prepare(`
      UPDATE claims
      SET status=?, data=?, updated_at=?
      WHERE claim_no=?
    `).run(
      step.status,
      JSON.stringify(data),
      now(),
      claimNo
    );
  } else {
    console.log(
      'CLAIM_DUPLICATE_UPLOAD_RETRY_SKIPPED',
      {
        to,
        claimNo,
        state,
        role: step.role
      }
    );
  }

  if (step.nextState) {
    await vpClaimSendReliable(
      to,
      `claim_next_upload_${step.role}`,
      () => sendUploadPrompt(
        to,
`${step.done}

Next required upload:
${vpClaimUploadPrompt(step.nextState)}`,
        'back_prev'
      )
    );

    setSession(
      to,
      step.nextState,
      data
    );

    db.prepare(`
      UPDATE claims
      SET status=?, data=?, updated_at=?
      WHERE claim_no=?
    `).run(
      step.status,
      JSON.stringify(data),
      now(),
      claimNo
    );

    return;
  }

  data.documentVerification =
    'documents_received_running_verification';

  setSession(to, state, data);

  db.prepare(`
    UPDATE claims
    SET status=?, data=?, updated_at=?
    WHERE claim_no=?
  `).run(
    step.status,
    JSON.stringify(data),
    now(),
    claimNo
  );

  const missingFieldIndex =
    vpNextMissingClaimFieldIndex(
      data,
      0
    );

  if (missingFieldIndex >= 0) {
    await vpClaimSendReliable(
      to,
      `claim_recover_field_${missingFieldIndex}`,
      () => sendClaimQuestion(
        to,
        missingFieldIndex
      )
    );

    setSession(
      to,
      `claim_field_${missingFieldIndex}`,
      data
    );

    db.prepare(`
      UPDATE claims
      SET status=?, data=?, updated_at=?
      WHERE claim_no=?
    `).run(
      'collecting_missing_required_fields',
      JSON.stringify(data),
      now(),
      claimNo
    );

    console.log(
      'CLAIM_MISSING_FIELD_RECOVERY_STARTED',
      {
        to,
        claimNo,
        missingFieldIndex,
        key:
          VP_STRICT_CLAIM_FIELDS[
            missingFieldIndex
          ][0]
      }
    );

    return;
  }

  const missingUploadState =
    vpMissingClaimUploadState(data);

  if (missingUploadState) {
    await vpClaimSendReliable(
      to,
      missingUploadState,
      () => sendUploadPrompt(
        to,
        vpClaimUploadPrompt(
          missingUploadState
        ),
        'back_prev'
      )
    );

    setSession(
      to,
      missingUploadState,
      data
    );

    db.prepare(`
      UPDATE claims
      SET status=?, data=?, updated_at=?
      WHERE claim_no=?
    `).run(
      vpClaimStatusForUploadState(
        missingUploadState
      ),
      JSON.stringify(data),
      now(),
      claimNo
    );

    return;
  }

  const missing =
    vpRequiredClaimMissing(data);

  if (missing.length) {
    db.prepare(`
      UPDATE claims
      SET status=?, data=?, updated_at=?
      WHERE claim_no=?
    `).run(
      'claim_incomplete_missing_required_fields',
      JSON.stringify(data),
      now(),
      claimNo
    );

    return vpClaimSendReliable(
      to,
      'claim_unresolved_completeness',
      () => sendText(
        to,
`The claim still needs attention.

Missing:
${missing.map(value => `- ${value}`).join('\n')}

Please choose Talk to Team from the menu for assistance.`
      )
    );
  }

  await vpClaimSendReliable(
    to,
    'claim_generating_pdf',
    () => sendText(
      to,
      'All claim details and required images have been received.\n\nFinal step: we will now send you a secure link to sign the claim form.'
    )
  );

  db.prepare(`
    UPDATE claims
    SET status=?, data=?, updated_at=?
    WHERE claim_no=?
  `).run(
    'generating_claim_pdf',
    JSON.stringify(data),
    now(),
    claimNo
  );

  return finishClaimDocuments(
    to,
    claimNo
  );
}

// VP_FINAL_ROLE_IMAGE_HANDLER_V6
function vpFinalRoleLabel(role) {
  return {
    national_id: 'National ID',
    driver_licence: "Driver's Licence",
    vehicle_reg: 'Vehicle Registration Photo',
    damage_glass: 'Damaged Glass Photo'
  }[role] || 'Claim Image';
}

function vpFinalRoleOrder(role) {
  return {
    national_id: 1,
    driver_licence: 2,
    vehicle_reg: 3,
    damage_glass: 4
  }[role] || 99;
}

function vpFinalRoleFromClaimState(state) {
  return {
    claim_upload_id: 'national_id',
    claim_upload_licence: 'driver_licence',
    claim_upload_vehicle_reg: 'vehicle_reg',
    claim_upload_damage_glass: 'damage_glass'
  }[state] || '';
}

function vpFinalEnsureAttachmentRoleColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);

    if (!cols.includes('claim_role')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN claim_role TEXT").run();
    }

    if (!cols.includes('role_label')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN role_label TEXT").run();
    }

    if (!cols.includes('role_order')) {
      db.prepare("ALTER TABLE attachments ADD COLUMN role_order INTEGER").run();
    }
  } catch (e) {
    console.error('VP_FINAL_ROLE_COLUMNS_ERROR', e.message);
  }
}

function vpFinalFindJustSavedAttachment(claimNo, saved) {
  try {
    if (saved?.id) {
      const row = db.prepare("SELECT * FROM attachments WHERE id=?").get(saved.id);
      if (row) return row;
    }

    if (saved?.mediaId) {
      const row = db.prepare("SELECT * FROM attachments WHERE claim_no=? AND media_id=? ORDER BY id DESC LIMIT 1")
        .get(claimNo, saved.mediaId);
      if (row) return row;
    }

    if (saved?.url) {
      const row = db.prepare("SELECT * FROM attachments WHERE claim_no=? AND url=? ORDER BY id DESC LIMIT 1")
        .get(claimNo, saved.url);
      if (row) return row;
    }

    return db.prepare("SELECT * FROM attachments WHERE claim_no=? ORDER BY id DESC LIMIT 1").get(claimNo);
  } catch (e) {
    console.error('VP_FINAL_FIND_SAVED_ATTACHMENT_ERROR', e.message);
    return null;
  }
}

function vpFinalTagClaimUpload(phone, claimNo, saved) {
  const session = getSession(phone);
  const role = vpFinalRoleFromClaimState(session?.state);

  if (!claimNo || !role) return saved;

  vpFinalEnsureAttachmentRoleColumns();

  const row = vpFinalFindJustSavedAttachment(claimNo, saved);
  if (!row) return saved;

  const label = vpFinalRoleLabel(role);
  const order = vpFinalRoleOrder(role);

  try {
    db.prepare("UPDATE attachments SET claim_role=?, role_label=?, role_order=? WHERE id=?")
      .run(role, label, order, row.id);
  } catch (e) {
    console.error('VP_FINAL_TAG_ATTACHMENT_ERROR', e.message);
  }

  try {
    const claim = db.prepare("SELECT * FROM claims WHERE claim_no=?").get(claimNo);

    if (claim) {
      const data = safeJsonParse(claim.data, {});
      data.claimImageRoles = data.claimImageRoles || {};

      const imageObject = {
        role,
        label,
        url: saved?.url || row.url || '',
        path: saved?.path || saved?.filePath || saved?.file_path || row.file_path || row.path || row.url || '',
        mediaId: saved?.mediaId || row.media_id || '',
        attachmentId: row.id,
        uploadedAt: now()
      };

      data.claimImageRoles[role] = imageObject;

      if (role === 'national_id') {
        data.nationalIdPhoto = imageObject;
        data.idPhotoReceived = true;
      }

      if (role === 'driver_licence') {
        data.driverLicencePhoto = imageObject;
        data.licencePhotoReceived = true;
      }

      if (role === 'vehicle_reg') {
        data.vehicleRegPhoto = imageObject;
        data.vehicleRegPhotoReceived = true;
      }

      if (role === 'damage_glass') {
        data.damagedGlassPhoto = imageObject;
        data.damageGlassPhotoReceived = true;
      }

      db.prepare("UPDATE claims SET data=?, updated_at=? WHERE claim_no=?")
        .run(JSON.stringify(data), now(), claimNo);
    }
  } catch (e) {
    console.error('VP_FINAL_UPDATE_CLAIM_ROLE_DATA_ERROR', e.message);
  }

  return {
    ...saved,
    claimRole: role,
    claim_role: role,
    roleLabel: label,
    role_label: label,
    roleOrder: order,
    role_order: order
  };
}

if (!global.__VP_FINAL_SAVE_ATTACHMENT_WRAPPED_V6) {
  global.__VP_FINAL_SAVE_ATTACHMENT_WRAPPED_V6 = true;

  const vpOriginalSaveAttachmentV6 = saveAttachment;

  saveAttachment = function(phone, inbound, jobNo = null, claimNo = null) {
    const saved = vpOriginalSaveAttachmentV6(phone, inbound, jobNo, claimNo);

    try {
      return vpFinalTagClaimUpload(phone, claimNo, saved);
    } catch (e) {
      console.error('VP_FINAL_SAVE_ATTACHMENT_WRAPPER_ERROR', e.message);
      return saved;
    }
  };
}

// VP_MEETING_CLAIM_IMAGE_FILE_FIX_V1
function vpMeetingClaimRoleLabel(role) {
  return {
    national_id: 'National ID',
    driver_licence: "Driver's Licence",
    vehicle_reg: 'Vehicle Registration Photo',
    damage_glass: 'Damaged Glass Photo'
  }[role] || 'Claim Image';
}

function vpMeetingClaimRoleOrder(role) {
  return {
    national_id: 1,
    driver_licence: 2,
    vehicle_reg: 3,
    damage_glass: 4
  }[role] || 99;
}

function vpMeetingRoleFromState(state) {
  return {
    claim_upload_id: 'national_id',
    claim_upload_licence: 'driver_licence',
    claim_upload_vehicle_reg: 'vehicle_reg',
    claim_upload_damage_glass: 'damage_glass'
  }[state] || '';
}

function vpMeetingEnsureRoleColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);

    if (!cols.includes('claim_role')) db.prepare("ALTER TABLE attachments ADD COLUMN claim_role TEXT").run();
    if (!cols.includes('role_label')) db.prepare("ALTER TABLE attachments ADD COLUMN role_label TEXT").run();
    if (!cols.includes('role_order')) db.prepare("ALTER TABLE attachments ADD COLUMN role_order INTEGER").run();
  } catch (e) {
    console.error('VP_MEETING_ROLE_COLUMNS_ERROR', e.message);
  }
}

function vpMeetingLocalPathFromValue(value) {
  if (!value) return null;

  let raw = '';

  if (typeof value === 'object') {
    raw = String(value.path || value.filePath || value.file_path || value.localPath || value.local_path || value.url || value.src || '').trim();
  } else {
    raw = String(value || '').trim();
  }

  if (!raw || !/\.(png|jpe?g|webp)(\?|$)/i.test(raw)) return null;

  const publicDir = path.join(__dirname, 'public');
  const tries = [];

  const add = v => {
    if (v && !tries.includes(v)) tries.push(v);
  };

  add(raw);

  try {
    const u = new URL(raw);
    add(u.pathname);
  } catch (_) {}

  let clean = raw.split('?')[0];

  if (BASE_URL && clean.startsWith(BASE_URL)) clean = clean.slice(String(BASE_URL).length);

  clean = clean.replace(/^\/?files\//, '').replace(/^\/+/, '');

  add(path.join(publicDir, clean));
  add(path.join(__dirname, clean));

  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    add(path.join(publicDir, raw.replace(/^\/+/, '')));
  }

  for (const candidate of tries) {
    try {
      const finalPath = path.isAbsolute(candidate) ? candidate : path.join(__dirname, candidate);
      if (fs.existsSync(finalPath) && fs.statSync(finalPath).isFile()) return finalPath;
    } catch (_) {}
  }

  return null;
}

function vpMeetingFindSavedAttachment(claimNo, saved) {
  try {
    if (saved?.id) {
      const row = db.prepare("SELECT * FROM attachments WHERE id=?").get(saved.id);
      if (row) return row;
    }

    if (saved?.mediaId) {
      const row = db.prepare("SELECT * FROM attachments WHERE claim_no=? AND media_id=? ORDER BY id DESC LIMIT 1")
        .get(claimNo, saved.mediaId);
      if (row) return row;
    }

    if (saved?.url) {
      const row = db.prepare("SELECT * FROM attachments WHERE claim_no=? AND url=? ORDER BY id DESC LIMIT 1")
        .get(claimNo, saved.url);
      if (row) return row;
    }

    return db.prepare("SELECT * FROM attachments WHERE claim_no=? ORDER BY id DESC LIMIT 1").get(claimNo);
  } catch (e) {
    console.error('VP_MEETING_FIND_ATTACHMENT_ERROR', e.message);
    return null;
  }
}

function vpMeetingCopyRoleImage(claimNo, role, saved, row) {
  const src =
    vpMeetingLocalPathFromValue(saved) ||
    vpMeetingLocalPathFromValue(row) ||
    vpMeetingLocalPathFromValue(row?.url) ||
    vpMeetingLocalPathFromValue(row?.file_path) ||
    vpMeetingLocalPathFromValue(row?.path);

  if (!src) return null;

  const roleDir = path.join(__dirname, 'public', 'claim-role-images');

  try {
    fs.mkdirSync(roleDir, { recursive: true });
  } catch (_) {}

  const ext = path.extname(src).toLowerCase() || '.jpg';
  const dest = path.join(roleDir, `${claimNo}-${role}${ext}`);

  try {
    fs.copyFileSync(src, dest);
  } catch (e) {
    console.error('VP_MEETING_COPY_ROLE_IMAGE_ERROR', e.message);
    return null;
  }

  return {
    localPath: dest,
    url: `/files/claim-role-images/${path.basename(dest)}`
  };
}

function vpMeetingSaveRoleImage(phone, claimNo, saved) {
  const session = getSession(phone);
  const role = vpMeetingRoleFromState(session?.state);

  if (!claimNo || !role) return saved;

  vpMeetingEnsureRoleColumns();

  const row = vpMeetingFindSavedAttachment(claimNo, saved);
  const copied = vpMeetingCopyRoleImage(claimNo, role, saved, row);

  const label = vpMeetingClaimRoleLabel(role);
  const order = vpMeetingClaimRoleOrder(role);

  try {
    if (row) {
      db.prepare("UPDATE attachments SET claim_role=?, role_label=?, role_order=? WHERE id=?")
        .run(role, label, order, row.id);
    }
  } catch (e) {
    console.error('VP_MEETING_TAG_ATTACHMENT_ERROR', e.message);
  }

  try {
    const claim = db.prepare("SELECT * FROM claims WHERE claim_no=?").get(claimNo);

    if (claim && copied) {
      const data = safeJsonParse(claim.data, {});
      data.claimImageRoles = data.claimImageRoles || {};

      const obj = {
        role,
        label,
        url: copied.url,
        path: copied.url,
        localPath: copied.localPath,
        attachmentId: row?.id || saved?.id || '',
        mediaId: saved?.mediaId || row?.media_id || '',
        uploadedAt: now()
      };

      data.claimImageRoles[role] = obj;

      if (role === 'national_id') {
        data.nationalIdPhoto = obj;
        data.idPhotoReceived = true;
      }

      if (role === 'driver_licence') {
        data.driverLicencePhoto = obj;
        data.licencePhotoReceived = true;
      }

      if (role === 'vehicle_reg') {
        data.vehicleRegPhoto = obj;
        data.vehicleRegPhotoReceived = true;
      }

      if (role === 'damage_glass') {
        data.damagedGlassPhoto = obj;
        data.damageGlassPhotoReceived = true;
      }

      db.prepare("UPDATE claims SET data=?, pdf_url=NULL, pdf_path=NULL, updated_at=? WHERE claim_no=?")
        .run(JSON.stringify(data), now(), claimNo);
    }
  } catch (e) {
    console.error('VP_MEETING_UPDATE_CLAIM_IMAGE_DATA_ERROR', e.message);
  }

  if (copied) {
    return {
      ...saved,
      url: copied.url,
      path: copied.url,
      localPath: copied.localPath,
      claimRole: role,
      roleLabel: label
    };
  }

  return saved;
}

if (!global.__VP_MEETING_SAVE_ATTACHMENT_WRAPPED_V1) {
  global.__VP_MEETING_SAVE_ATTACHMENT_WRAPPED_V1 = true;

  const vpMeetingOriginalSaveAttachment = saveAttachment;

  saveAttachment = function(phone, inbound, jobNo = null, claimNo = null) {
    const saved = vpMeetingOriginalSaveAttachment(phone, inbound, jobNo, claimNo);

    try {
      return vpMeetingSaveRoleImage(phone, claimNo, saved);
    } catch (e) {
      console.error('VP_MEETING_SAVE_ATTACHMENT_WRAPPER_ERROR', e.message);
      return saved;
    }
  };
}

// VP_SAFE_ROLE_MAPPING_FIX_ONLY_V1
function vpSafeRoleFromUploadState(state) {
  return {
    claim_upload_id: 'national_id',
    claim_upload_licence: 'driver_licence',
    claim_upload_vehicle_reg: 'vehicle_reg',
    claim_upload_damage_glass: 'damage_glass'
  }[state] || '';
}

function vpSafeRoleLabel(role) {
  return {
    national_id: 'National ID',
    driver_licence: "Driver's Licence",
    vehicle_reg: 'Vehicle Registration Photo',
    damage_glass: 'Damaged Glass Photo'
  }[role] || 'Claim Image';
}

function vpSafeRoleOrder(role) {
  return {
    national_id: 1,
    driver_licence: 2,
    vehicle_reg: 3,
    damage_glass: 4
  }[role] || 99;
}

function vpSafeEnsureRoleColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);
    if (!cols.includes('claim_role')) db.prepare("ALTER TABLE attachments ADD COLUMN claim_role TEXT").run();
    if (!cols.includes('role_label')) db.prepare("ALTER TABLE attachments ADD COLUMN role_label TEXT").run();
    if (!cols.includes('role_order')) db.prepare("ALTER TABLE attachments ADD COLUMN role_order INTEGER").run();
  } catch (e) {
    console.error('VP_SAFE_ROLE_COLUMNS_ERROR', e.message);
  }
}

function vpSafeLocalImagePath(value) {
  if (!value) return null;

  let raw = '';

  if (typeof value === 'object') {
    raw = String(value.localPath || value.path || value.filePath || value.file_path || value.local_path || value.url || value.src || '').trim();
  } else {
    raw = String(value || '').trim();
  }

  if (!raw || !/\.(png|jpe?g|webp)(\?|$)/i.test(raw)) return null;

  const publicDir = path.join(__dirname, 'public');
  const tries = [];

  const add = v => {
    if (v && !tries.includes(v)) tries.push(v);
  };

  add(raw);

  try {
    const u = new URL(raw);
    add(u.pathname);
  } catch (_) {}

  let clean = raw.split('?')[0];
  if (BASE_URL && clean.startsWith(BASE_URL)) clean = clean.slice(String(BASE_URL).length);

  clean = clean.replace(/^\/?files\//, '').replace(/^\/+/, '');

  add(path.join(publicDir, clean));
  add(path.join(__dirname, clean));

  for (const candidate of tries) {
    try {
      const finalPath = path.isAbsolute(candidate) ? candidate : path.join(__dirname, candidate);
      if (fs.existsSync(finalPath) && fs.statSync(finalPath).isFile()) return finalPath;
    } catch (_) {}
  }

  return null;
}

function vpSafeFindLatestAttachment(claimNo, saved) {
  try {
    if (saved?.id) {
      const row = db.prepare("SELECT * FROM attachments WHERE id=?").get(saved.id);
      if (row) return row;
    }

    if (saved?.mediaId) {
      const row = db.prepare("SELECT * FROM attachments WHERE claim_no=? AND media_id=? ORDER BY id DESC LIMIT 1")
        .get(claimNo, saved.mediaId);
      if (row) return row;
    }

    if (saved?.url) {
      const row = db.prepare("SELECT * FROM attachments WHERE claim_no=? AND url=? ORDER BY id DESC LIMIT 1")
        .get(claimNo, saved.url);
      if (row) return row;
    }

    return db.prepare("SELECT * FROM attachments WHERE claim_no=? ORDER BY id DESC LIMIT 1").get(claimNo);
  } catch (e) {
    console.error('VP_SAFE_FIND_ATTACHMENT_ERROR', e.message);
    return null;
  }
}

function vpSafeCopyToRoleFile(claimNo, role, saved, row) {
  const source =
    vpSafeLocalImagePath(saved) ||
    vpSafeLocalImagePath(row) ||
    vpSafeLocalImagePath(row?.url) ||
    vpSafeLocalImagePath(row?.file_path) ||
    vpSafeLocalImagePath(row?.path);

  if (!source) return null;

  const roleDir = path.join(__dirname, 'public', 'claim-role-images');
  fs.mkdirSync(roleDir, { recursive: true });

  const ext = path.extname(source).toLowerCase() || '.jpg';
  const dest = path.join(roleDir, `${claimNo}-${role}${ext}`);

  fs.copyFileSync(source, dest);

  return {
    localPath: dest,
    url: `/files/claim-role-images/${path.basename(dest)}`
  };
}

function vpSafeAttachCurrentUploadRole(phone, claimNo, saved) {
  const session = getSession(phone);
  const role = vpSafeRoleFromUploadState(session?.state);

  if (!claimNo || !role) return saved;

  vpSafeEnsureRoleColumns();

  const row = vpSafeFindLatestAttachment(claimNo, saved);
  const copied = vpSafeCopyToRoleFile(claimNo, role, saved, row);

  const label = vpSafeRoleLabel(role);
  const order = vpSafeRoleOrder(role);

  if (row) {
    try {
      db.prepare("UPDATE attachments SET claim_role=?, role_label=?, role_order=? WHERE id=?")
        .run(role, label, order, row.id);
    } catch (e) {
      console.error('VP_SAFE_TAG_ATTACHMENT_ERROR', e.message);
    }
  }

  if (copied) {
    try {
      const claim = db.prepare("SELECT * FROM claims WHERE claim_no=?").get(claimNo);

      if (claim) {
        const data = safeJsonParse(claim.data, {});
        data.claimImageRoles = data.claimImageRoles || {};

        const imageObj = {
          role,
          label,
          url: copied.url,
          path: copied.url,
          localPath: copied.localPath,
          attachmentId: row?.id || saved?.id || '',
          mediaId: saved?.mediaId || row?.media_id || '',
          uploadedAt: now()
        };

        data.claimImageRoles[role] = imageObj;

        if (role === 'national_id') {
          data.nationalIdPhoto = imageObj;
          data.idPhotoReceived = true;
        }

        if (role === 'driver_licence') {
          data.driverLicencePhoto = imageObj;
          data.licencePhotoReceived = true;
        }

        if (role === 'vehicle_reg') {
          data.vehicleRegPhoto = imageObj;
          data.vehicleRegPhotoReceived = true;
        }

        if (role === 'damage_glass') {
          data.damagedGlassPhoto = imageObj;
          data.damageGlassPhotoReceived = true;
        }

        db.prepare("UPDATE claims SET data=?, pdf_url=NULL, pdf_path=NULL, updated_at=? WHERE claim_no=?")
          .run(JSON.stringify(data), now(), claimNo);
      }
    } catch (e) {
      console.error('VP_SAFE_UPDATE_CLAIM_IMAGE_ROLE_ERROR', e.message);
    }

    return {
      ...saved,
      url: copied.url,
      path: copied.url,
      localPath: copied.localPath,
      claimRole: role,
      roleLabel: label
    };
  }

  return saved;
}

if (!global.__VP_SAFE_ROLE_MAPPING_SAVE_WRAPPED_V1) {
  global.__VP_SAFE_ROLE_MAPPING_SAVE_WRAPPED_V1 = true;

  const vpSafeOriginalSaveAttachment = saveAttachment;

  saveAttachment = function(phone, inbound, jobNo = null, claimNo = null) {
    const saved = vpSafeOriginalSaveAttachment(phone, inbound, jobNo, claimNo);

    try {
      return vpSafeAttachCurrentUploadRole(phone, claimNo, saved);
    } catch (e) {
      console.error('VP_SAFE_ROLE_MAPPING_SAVE_ERROR', e.message);
      return saved;
    }
  };
}


// VP_SUPPRESS_FALSE_MEDIA_WARNING_V1
try {
  if (!global.__VP_SUPPRESS_FALSE_MEDIA_WARNING_V1 && typeof sendText === 'function') {
    global.__VP_SUPPRESS_FALSE_MEDIA_WARNING_V1 = true;

    const vpOriginalSendTextFalseMediaWarningV1 = sendText;

    sendText = async function(to, message, ...args) {
      const body = String(message || '');

      const isFalseMediaWarning =
        body.includes('We could not read that message') &&
        body.includes('Please send it as a normal WhatsApp message');

      if (isFalseMediaWarning) {
        console.log('VP_SUPPRESSED_FALSE_MEDIA_WARNING', {
          to,
          reason: 'media webhook placeholder ignored',
          time: typeof now === 'function' ? now() : new Date().toISOString()
        });

        return {
          ok: true,
          suppressed: true,
          reason: 'false_media_warning'
        };
      }

      return vpOriginalSendTextFalseMediaWarningV1.call(this, to, message, ...args);
    };
  }
} catch (e) {
  console.error('VP_SUPPRESS_FALSE_MEDIA_WARNING_INSTALL_ERROR', e.message);
}

'use strict';

const express = require('express');
const config = require('../config');
const { db, transaction } = require('../db');
const { sendMail } = require('../mailer');
const auth = require('../auth');

const router = express.Router();
const APPROVAL_DAYS = 30;

const limiter = auth.rateLimit({ windowMs: 15 * 60000, max: 20 });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function sendApprovalMail(user) {
  const token = auth.randomToken();
  const now = Date.now();
  db.prepare('INSERT INTO approval_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    auth.sha256(token),
    user.id,
    now,
    now + APPROVAL_DAYS * 86400000,
  );
  const url = `${config.publicUrl}/godkann/${token}`;
  return sendMail({
    to: config.adminEmail,
    subject: `Ny användare vill ladda upp klipp: ${user.email}`,
    text: `${user.email} har registrerat sig på Floorballflash och vill kunna ladda upp filmklipp.\nVälj om användaren ska godkännas eller nekas. Länken gäller i ${APPROVAL_DAYS} dagar.`,
    links: [
      { label: 'Godkänn användare', url: `${url}?val=godkann`, color: '#15803d' },
      { label: 'Neka användare', url: `${url}?val=neka`, color: '#b91c1c' },
    ],
  });
}

/** Applies an admin decision and tells the user. Shared with the admin API. */
async function decide(userId, status) {
  const user = db.prepare('SELECT id, email, status FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  transaction(() => {
    db.prepare('UPDATE users SET status = ?, decided_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(
      status,
      Date.now(),
      userId,
    );
    db.prepare('UPDATE approval_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), userId);
    if (status !== 'approved') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  });
  if (status === 'approved' && user.status !== 'approved') {
    await sendMail({
      to: user.email,
      subject: 'Ditt konto på Floorballflash är godkänt',
      text: 'Ditt konto har godkänts. Logga in med din e-postadress och din pinkod för att ladda upp filmklipp.',
      links: [{ label: 'Logga in', url: `${config.publicUrl}/login.html` }],
    });
  } else if (status === 'denied' && user.status === 'pending') {
    await sendMail({
      to: user.email,
      subject: 'Din registrering på Floorballflash',
      text: 'Din förfrågan om att få ladda upp filmklipp har tyvärr nekats.',
    });
  }
  return { ...user, status };
}

router.post('/api/auth/register', limiter, async (req, res) => {
  const email = auth.normalizeEmail(req.body.email);
  const pin = req.body.pin;
  if (!auth.validEmail(email)) return res.status(400).json({ error: 'Ange en giltig e-postadress.' });
  if (!auth.validPin(pin)) return res.status(400).json({ error: 'Pinkoden måste vara exakt 8 tecken (bokstäver och siffror).' });

  const existing = db.prepare('SELECT id, status FROM users WHERE email = ?').get(email);
  if (existing) {
    const msg = {
      pending: 'Den här adressen väntar redan på godkännande.',
      approved: 'Adressen är redan registrerad. Logga in i stället.',
      denied: 'Registreringen för den här adressen har nekats.',
      blocked: 'Kontot är spärrat.',
    }[existing.status];
    return res.status(409).json({ error: msg });
  }

  const pinHash = await auth.hash(pin);
  const info = db.prepare('INSERT INTO users (email, pin_hash, created_at) VALUES (?, ?, ?)').run(email, pinHash, Date.now());
  await sendApprovalMail({ id: Number(info.lastInsertRowid), email });
  res.status(201).json({ ok: true, message: 'Tack! Din registrering skickas för godkännande. Du får ett mejl när kontot är godkänt.' });
});

router.post('/api/auth/login', limiter, async (req, res) => {
  const email = auth.normalizeEmail(req.body.email);
  const pin = typeof req.body.pin === 'string' ? req.body.pin : '';
  const generic = { error: 'Fel e-postadress eller pinkod.' };
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    await auth.verify(pin, auth.dummyHash()); // equalize timing
    return res.status(401).json(generic);
  }
  if (user.locked_until && user.locked_until > Date.now()) {
    return res.status(429).json({ error: 'För många felaktiga försök. Kontot är låst i 15 minuter.' });
  }
  if (!(await auth.verify(pin, user.pin_hash))) {
    const failed = user.failed_attempts + 1;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      failed >= auth.MAX_FAILED ? 0 : failed,
      failed >= auth.MAX_FAILED ? Date.now() + auth.LOCK_MS : null,
      user.id,
    );
    return res.status(401).json(generic);
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  if (user.status !== 'approved') {
    const msg = {
      pending: 'Ditt konto väntar fortfarande på godkännande.',
      denied: 'Ditt konto har inte godkänts.',
      blocked: 'Ditt konto är spärrat.',
    }[user.status];
    return res.status(403).json({ error: msg });
  }
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
  auth.createSession(res, 'user', user.id);
  res.json({ ok: true, user: { email: user.email, kind: 'user' } });
});

router.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/api/me', (req, res) => {
  res.json({ user: req.user ? { email: req.user.email, kind: req.user.kind } : null });
});

// ---- approval link from the admin mail --------------------------------------

function findToken(token) {
  return db
    .prepare(
      `SELECT t.token_hash, t.expires_at, t.used_at, u.id AS user_id, u.email, u.status
         FROM approval_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
    )
    .get(auth.sha256(String(token)));
}

function page(title, body) {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} – Floorballflash</title><link rel="stylesheet" href="/app.css"></head>
<body><header class="topbar"><a class="brand" href="/">🏑 Floorballflash</a></header>
<main class="narrow"><section class="card">${body}</section></main></body></html>`;
}

const STATUS_SV = { pending: 'väntar', approved: 'godkänd', denied: 'nekad', blocked: 'spärrad' };

// GET only shows a confirmation; the decision is a POST so mail link scanners can't trigger it.
router.get('/godkann/:token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const t = findToken(req.params.token);
  if (!t) return res.status(404).send(page('Ogiltig länk', '<h1>Ogiltig länk</h1><p>Länken finns inte.</p>'));
  if (t.used_at || t.expires_at < Date.now()) {
    return res.send(
      page(
        'Länken är använd',
        `<h1>Länken är redan använd eller har gått ut</h1><p><strong>${escapeHtml(t.email)}</strong> är ${STATUS_SV[t.status]}.</p><p><a href="/admin.html">Gå till adminsidan</a></p>`,
      ),
    );
  }
  const pre = req.query.val;
  res.send(
    page(
      'Godkänn användare',
      `<h1>Godkänn användare</h1>
       <p><strong>${escapeHtml(t.email)}</strong> vill kunna logga in och ladda upp filmklipp.</p>
       <form method="post" class="row">
         <button class="btn ${pre === 'neka' ? 'secondary' : 'primary'}" name="action" value="approve">Godkänn</button>
         <button class="btn ${pre === 'neka' ? 'danger' : 'secondary'}" name="action" value="deny">Neka</button>
       </form>`,
    ),
  );
});

router.post('/godkann/:token', express.urlencoded({ extended: false }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const t = findToken(req.params.token);
  if (!t || t.used_at || t.expires_at < Date.now()) {
    return res.status(410).send(page('Ogiltig länk', '<h1>Länken är inte längre giltig</h1><p><a href="/admin.html">Gå till adminsidan</a></p>'));
  }
  const action = req.body.action;
  if (action !== 'approve' && action !== 'deny') return res.status(400).send(page('Fel', '<h1>Okänt val</h1>'));
  const user = await decide(t.user_id, action === 'approve' ? 'approved' : 'denied');
  res.send(
    page(
      'Klart',
      `<h1>${action === 'approve' ? '✅ Användaren är godkänd' : '⛔ Användaren är nekad'}</h1>
       <p><strong>${escapeHtml(user.email)}</strong> har fått besked via e-post.</p>
       <p><a href="/admin.html">Hantera användare på adminsidan</a></p>`,
    ),
  );
});

module.exports = { router, decide, sendApprovalMail };

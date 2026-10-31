'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('../config');
const { db, getSetting, getTeamSettings, setSetting } = require('../db');
const { sendMail } = require('../mailer');
const ibis = require('../ibis');
const auth = require('../auth');
const { decide, sendApprovalMail } = require('./users');

const router = express.Router();
const limiter = auth.rateLimit({ windowMs: 15 * 60000, max: 20 });
const SETUP_LINK_MINUTES = 60;

function adminRow() {
  return db.prepare('SELECT * FROM admin WHERE id = 1').get();
}

router.get('/api/admin/status', (req, res) => {
  res.json({
    hasPassword: Boolean(adminRow().password_hash),
    loggedIn: Boolean(req.user && req.user.kind === 'admin'),
  });
});

router.post('/api/admin/login', limiter, async (req, res) => {
  const email = auth.normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const admin = adminRow();
  if (admin.locked_until && admin.locked_until > Date.now()) {
    return res.status(429).json({ error: 'För många felaktiga försök. Inloggningen är låst i 15 minuter.' });
  }
  const ok = email === config.adminEmail && (await auth.verify(password, admin.password_hash || auth.dummyHash())) && Boolean(admin.password_hash);
  if (!ok) {
    const failed = admin.failed_attempts + 1;
    db.prepare('UPDATE admin SET failed_attempts = ?, locked_until = ? WHERE id = 1').run(
      failed >= auth.MAX_FAILED ? 0 : failed,
      failed >= auth.MAX_FAILED ? Date.now() + auth.LOCK_MS : null,
    );
    return res.status(401).json({ error: 'Fel e-postadress eller lösenord.' });
  }
  db.prepare('UPDATE admin SET failed_attempts = 0, locked_until = NULL WHERE id = 1').run();
  auth.createSession(res, 'admin');
  res.json({ ok: true });
});

// Creating or resetting the admin password always goes through a link mailed to the
// admin address, so nobody else can claim the admin account first.
router.post('/api/admin/request-password-link', limiter, async (req, res) => {
  const recent = db.prepare('SELECT MAX(created_at) AS t FROM admin_tokens').get().t;
  if (recent && Date.now() - recent < 2 * 60000) {
    return res.status(429).json({ error: 'En länk skickades nyss. Kontrollera inkorgen eller vänta två minuter.' });
  }
  const token = auth.randomToken();
  const now = Date.now();
  db.prepare('INSERT INTO admin_tokens (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    auth.sha256(token),
    now,
    now + SETUP_LINK_MINUTES * 60000,
  );
  await sendMail({
    to: config.adminEmail,
    subject: 'Skapa lösenord för Floorballflash admin',
    text: `Klicka på länken för att skapa ett nytt adminlösenord. Länken gäller i ${SETUP_LINK_MINUTES} minuter och kan bara användas en gång.\nOm du inte begärde detta kan du ignorera mejlet.`,
    links: [{ label: 'Skapa lösenord', url: `${config.publicUrl}/admin.html#token=${token}` }],
  });
  res.json({ ok: true, message: `En länk har skickats till ${config.adminEmail}.` });
});

router.post('/api/admin/set-password', limiter, async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = req.body.password;
  const row = db.prepare('SELECT * FROM admin_tokens WHERE token_hash = ?').get(auth.sha256(token));
  if (!row || row.used_at || row.expires_at < Date.now()) {
    return res.status(400).json({ error: 'Länken är ogiltig eller har gått ut. Begär en ny.' });
  }
  const problems = auth.passwordProblems(password);
  if (problems.length) return res.status(400).json({ error: `Lösenordet måste ha ${problems.join(', ')}.` });
  const digest = await auth.hash(password);
  db.prepare('UPDATE admin_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), row.token_hash);
  db.prepare('UPDATE admin SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = 1').run(digest, Date.now());
  db.prepare("DELETE FROM sessions WHERE kind = 'admin'").run();
  auth.createSession(res, 'admin');
  res.json({ ok: true });
});

router.post('/api/admin/password-check', (req, res) => {
  res.json({ problems: auth.passwordProblems(req.body.password) });
});

// ---- everything below requires an admin session --------------------------------

router.use('/api/admin', auth.requireAdmin);

router.get('/api/admin/users', (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.status, u.created_at, u.decided_at, u.last_login_at, u.locked_until,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id) AS videos
         FROM users u
        ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at DESC`,
    )
    .all();
  res.json({ users });
});

router.post('/api/admin/users/:id/status', async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'denied', 'blocked', 'pending'].includes(status)) return res.status(400).json({ error: 'Ogiltig status.' });
  const user = await decide(Number(req.params.id), status);
  if (!user) return res.status(404).json({ error: 'Användaren finns inte.' });
  res.json({ ok: true });
});

router.post('/api/admin/users/:id/resend', async (req, res) => {
  const user = db.prepare('SELECT id, email, status FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Användaren finns inte.' });
  await sendApprovalMail(user);
  res.json({ ok: true });
});

router.post('/api/admin/users/:id/reset-pin', async (req, res) => {
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Användaren finns inte.' });
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pin = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  db.prepare('UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(await auth.hash(pin), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  await sendMail({
    to: user.email,
    subject: 'Ny pinkod till Floorballflash',
    text: `Administratören har gett dig en ny pinkod: ${pin}\nLogga in med din e-postadress och den nya pinkoden.`,
    links: [{ label: 'Logga in', url: `${config.publicUrl}/login.html` }],
  });
  res.json({ ok: true, pin });
});

router.delete('/api/admin/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Användaren finns inte.' });
  res.json({ ok: true });
});

router.get('/api/admin/settings', (req, res) => {
  // The form edits only what is stored here; IDs from .env are always added on top.
  const settings = { ...getTeamSettings(), competitionIds: getSetting('competitionIds', []), extraMatchIds: getSetting('extraMatchIds', []) };
  res.json({
    settings,
    fromEnv: { competitionIds: config.competitionIds, extraMatchIds: config.extraMatchIds },
    mock: config.ibis.mock,
  });
});

function idList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  return [...new Set(list.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n) && n > 0))];
}

router.put('/api/admin/settings', async (req, res) => {
  const teamId = parseInt(req.body.teamId, 10);
  const seasonId = parseInt(req.body.seasonId, 10);
  if (!(teamId > 0) || !(seasonId > 0)) return res.status(400).json({ error: 'Lag-ID och säsongs-ID måste vara positiva heltal.' });
  const teamMatchesPath = String(req.body.teamMatchesPath || '').trim();
  if (teamMatchesPath && !/^\/[\w/{}.-]*$/.test(teamMatchesPath)) return res.status(400).json({ error: 'Ogiltig API-sökväg.' });
  setSetting('teamId', teamId);
  setSetting('seasonId', seasonId);
  setSetting('competitionIds', idList(req.body.competitionIds));
  setSetting('extraMatchIds', idList(req.body.extraMatchIds));
  setSetting('teamMatchesPath', teamMatchesPath);
  const schedule = await ibis.getSchedule({ force: true });
  res.json({ ok: true, settings: getTeamSettings(), matches: schedule.matches.length, source: schedule.source, error: schedule.error });
});

router.get('/api/admin/mail', (req, res) => {
  const mails = db.prepare('SELECT id, recipient, subject, body, status, error, created_at FROM mail_log ORDER BY id DESC LIMIT 50').all();
  res.json({ mails, smtpConfigured: Boolean(config.smtp.host) });
});

router.get('/api/admin/videos', (req, res) => {
  const videos = db.prepare('SELECT id, match_id, title, uploader, size, created_at, filename, mime FROM videos ORDER BY created_at DESC').all();
  res.json({ videos });
});

router.delete('/api/admin/videos/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Klippet finns inte.' });
  db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
  fs.rm(path.join(config.uploadDir, v.filename), { force: true }, () => {});
  res.json({ ok: true });
});

module.exports = { router };

'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { db } = require('./db');

const COOKIE = 'ff_session';
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^[A-Za-z0-9]{8}$/;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function validEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

function validPin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

/** Returns a list of problems with an admin password (empty when OK). */
function passwordProblems(password) {
  const problems = [];
  if (typeof password !== 'string' || password.length < 12) problems.push('minst 12 tecken');
  if (typeof password === 'string' && password.length > 200) problems.push('högst 200 tecken');
  const p = String(password || '');
  const classes = [/[a-zåäö]/, /[A-ZÅÄÖ]/, /[0-9]/, /[^A-Za-zÅÄÖåäö0-9]/].filter((re) => re.test(p)).length;
  if (classes < 3) problems.push('minst tre av: små bokstäver, stora bokstäver, siffror, specialtecken');
  if (/(.)\1{3,}/.test(p)) problems.push('inte samma tecken fyra gånger i rad');
  const local = config.adminEmail.split('@')[0];
  if (local.length >= 4 && p.toLowerCase().includes(local)) problems.push('får inte innehålla e-postadressen');
  if (/^(password|lösenord|losenord|qwerty|123456|innebandy)/i.test(p)) problems.push('för lätt att gissa');
  return problems;
}

const hash = (secret) => bcrypt.hash(secret, 12);
const verify = (secret, digest) => (digest ? bcrypt.compare(String(secret), digest) : Promise.resolve(false));
let dummy = null;
const dummyHash = () => (dummy ??= bcrypt.hashSync('timing-equalizer', 12));

// ---- sessions --------------------------------------------------------------

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieString(value, maxAgeSec) {
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
    config.cookieSecure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function createSession(res, kind, userId = null) {
  const token = randomToken();
  const now = Date.now();
  const days = kind === 'admin' ? 1 : config.sessionDays;
  db.prepare('INSERT INTO sessions (token_hash, kind, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    kind,
    userId,
    now,
    now + days * 86400000,
  );
  res.append('Set-Cookie', cookieString(token, days * 86400));
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.append('Set-Cookie', cookieString('', 0));
}

/** Middleware: sets req.user ({ kind, id, email }) for a valid session. */
function loadSession(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const row = db
    .prepare(
      `SELECT s.kind, s.user_id, s.expires_at, u.email, u.status
         FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row || row.expires_at < Date.now()) return next();
  if (row.kind === 'admin') req.user = { kind: 'admin', id: null, email: config.adminEmail };
  else if (row.status === 'approved') req.user = { kind: 'user', id: row.user_id, email: row.email };
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Du måste logga in.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.kind !== 'admin') return res.status(401).json({ error: 'Kräver administratörsinloggning.' });
  next();
}

/**
 * CSRF protection for state-changing requests: browsers only send the custom header from
 * same-origin scripts, and a present Origin header must match the host.
 */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Ogiltig källa för förfrågan.' });
  }
  if (req.path.startsWith('/api/') && req.headers['x-requested-with'] !== 'floorballflash') {
    return res.status(403).json({ error: 'Saknar säkerhetshuvud.' });
  }
  next();
}

// Simple in-memory per-IP limiter for auth endpoints.
const buckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.baseUrl}${req.path}|${req.ip}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) buckets.set(key, { count: 1, reset: now + windowMs });
    else if (++b.count > max) {
      res.set('Retry-After', Math.ceil((b.reset - now) / 1000));
      return res.status(429).json({ error: 'För många försök. Vänta en stund och försök igen.' });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}, 10 * 60000).unref();

module.exports = {
  sha256,
  randomToken,
  normalizeEmail,
  validEmail,
  validPin,
  passwordProblems,
  hash,
  verify,
  dummyHash,
  createSession,
  destroySession,
  loadSession,
  requireUser,
  requireAdmin,
  csrfGuard,
  rateLimit,
  MAX_FAILED,
  LOCK_MS,
};

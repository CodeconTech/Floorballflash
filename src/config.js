'use strict';

const path = require('node:path');

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function idList(value) {
  return [...new Set(String(value || '').split(/[\s,;]+/).map((v) => parseInt(v, 10)).filter((n) => n > 0))];
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
  port: int(process.env.PORT, 3000),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  adminEmail: (process.env.ADMIN_EMAIL || 'andreas.wallin@gmail.com').trim().toLowerCase(),
  dataDir,
  dbFile: path.join(dataDir, 'floorballflash.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 1024),
  trustProxy: process.env.TRUST_PROXY || 'loopback',
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true'
    : (process.env.PUBLIC_URL || '').startsWith('https://'),
  sessionDays: int(process.env.SESSION_DAYS, 30),
  // How long the approve/deny link mailed to the admin stays valid.
  approvalLinkDays: Math.max(1, int(process.env.APPROVAL_LINK_DAYS, 90)),
  // Clips can be uploaded until this many hours after a match has been played.
  uploadWindowHours: Math.max(1, int(process.env.UPLOAD_WINDOW_HOURS, 12)),

  // Default team/season, overridable from the admin page.
  teamId: int(process.env.TEAM_ID, 120879),
  seasonId: int(process.env.SEASON_ID, 44),
  // Competitions (series) and extra matches that are always included, on top of the admin page's.
  competitionIds: idList(process.env.COMPETITION_IDS),
  extraMatchIds: idList(process.env.EXTRA_MATCH_IDS),

  ibis: {
    baseUrl: (process.env.IBIS_BASE_URL || 'https://api.innebandy.se').replace(/\/+$/, ''),
    mock: process.env.IBIS_MOCK === '1',
    livePollSeconds: Math.max(10, int(process.env.LIVE_POLL_SECONDS, 20)),
    scheduleCacheSeconds: Math.max(30, int(process.env.SCHEDULE_CACHE_SECONDS, 120)),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'floorballflash@localhost',
  },
};

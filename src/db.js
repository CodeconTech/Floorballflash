'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    pin_hash        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied', 'blocked')),
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER,
    created_at      INTEGER NOT NULL,
    decided_at      INTEGER,
    last_login_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS approval_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS admin (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash   TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER,
    updated_at      INTEGER
  );
  INSERT OR IGNORE INTO admin (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS admin_tokens (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('user', 'admin')),
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploader      TEXT NOT NULL,
    match_id      INTEGER NOT NULL,
    title         TEXT NOT NULL,
    filename      TEXT NOT NULL UNIQUE,
    original_name TEXT,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS videos_match ON videos (match_id, created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_streams (
    match_id   INTEGER PRIMARY KEY,
    stream_id  TEXT NOT NULL,
    password   TEXT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    set_by     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mail_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient  TEXT NOT NULL,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    status     TEXT NOT NULL,
    error      TEXT,
    created_at INTEGER NOT NULL
  );
`);

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

function getTeamSettings() {
  return {
    teamId: getSetting('teamId', config.teamId),
    seasonId: getSetting('seasonId', config.seasonId),
    competitionIds: getSetting('competitionIds', []),
    extraMatchIds: getSetting('extraMatchIds', []),
    teamMatchesPath: getSetting('teamMatchesPath', ''),
  };
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, getSetting, setSetting, getTeamSettings, transaction };

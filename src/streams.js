'use strict';

/**
 * Live video streams from VDO.Ninja attached to matches.
 *
 * VDO.Ninja links come in two flavours: a "push" link that the camera phone opens to
 * publish, and a "view" link that shows the stream. Only the stream ID (and optional
 * password) is stored, and the page always embeds a view link, so a pasted push link can
 * never make visitors' browsers start publishing their own camera.
 */

const crypto = require('node:crypto');
const { db } = require('./db');

const HOSTS = new Set(['vdo.ninja', 'www.vdo.ninja', 'obs.ninja', 'www.obs.ninja']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VIEW_KEYS = ['view', 'v', 'pull'];
const PUSH_KEYS = ['push', 'id', 'permaid'];
const PASSWORD_KEYS = ['password', 'pass', 'pw', 'p'];

/** Parses a VDO.Ninja link (view or push) into { streamId, password }. Throws on invalid input. */
function parseLink(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw new Error('Ange en giltig länk från vdo.ninja.');
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Länken måste gå till https://vdo.ninja.');
  }
  const pick = (keys) => keys.map((k) => url.searchParams.get(k)).find((v) => v);
  const streamId = pick(VIEW_KEYS) || pick(PUSH_KEYS);
  if (!streamId || !ID_RE.test(streamId)) {
    throw new Error('Hittar inget giltigt sändnings-ID i länken (t.ex. ?view=abc123 eller ?push=abc123).');
  }
  const password = pick(PASSWORD_KEYS) || null;
  if (password && password.length > 100) throw new Error('Lösenordet i länken är för långt.');
  return { streamId, password };
}

function links({ stream_id: id, password }) {
  const pw = password ? `&password=${encodeURIComponent(password)}` : '';
  return {
    viewUrl: `https://vdo.ninja/?view=${encodeURIComponent(id)}${pw}`,
    pushUrl: `https://vdo.ninja/?push=${encodeURIComponent(id)}${pw}`,
  };
}

function newStreamId() {
  return `ff${crypto.randomBytes(6).toString('hex')}`;
}

function get(matchId) {
  return db.prepare('SELECT * FROM match_streams WHERE match_id = ?').get(matchId) || null;
}

function set(matchId, { streamId, password }, user) {
  db.prepare(
    `INSERT INTO match_streams (match_id, stream_id, password, user_id, set_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET stream_id = excluded.stream_id, password = excluded.password,
       user_id = excluded.user_id, set_by = excluded.set_by, updated_at = excluded.updated_at`,
  ).run(matchId, streamId, password, user.id, user.email, Date.now());
  return get(matchId);
}

function remove(matchId) {
  return db.prepare('DELETE FROM match_streams WHERE match_id = ?').run(matchId).changes > 0;
}

function matchIdsWithStream() {
  return new Set(db.prepare('SELECT match_id FROM match_streams').all().map((r) => r.match_id));
}

/** Public representation. The push link is only included for users allowed to manage the stream. */
function toJson(row, user) {
  if (!row) return null;
  const canManage = Boolean(user && (user.kind === 'admin' || user.id === row.user_id));
  const { viewUrl, pushUrl } = links(row);
  return {
    matchId: row.match_id,
    viewUrl,
    embedUrl: viewUrl,
    pushUrl: canManage ? pushUrl : undefined,
    setBy: row.set_by.replace(/@.*/, ''),
    updatedAt: row.updated_at,
    canManage,
  };
}

module.exports = { parseLink, newStreamId, get, set, remove, matchIdsWithStream, toJson };

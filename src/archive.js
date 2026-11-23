'use strict';

/**
 * Stores the last known data for every match the site has shown. Played matches stay
 * listed (with their clips) even after IBIS or the configured series stop returning them,
 * and the time a match was seen to finish decides when clip uploads close.
 */

const config = require('./config');
const { db } = require('./db');

const MATCH_LENGTH_MS = 2 * 3600000; // used when the end of a match was never observed

function parseStart(dateTime) {
  const t = dateTime ? Date.parse(dateTime) : NaN;
  return Number.isFinite(t) ? t : null;
}

// IBIS events are fetched again when needed; events reported on the site exist only here.
function strip(match) {
  if (match.report) return match;
  const { events, ...rest } = match;
  return rest;
}

/**
 * Saves the latest data for a match; records when it was first seen as finished.
 * `observed: false` is for data entered after the fact (imports), whose arrival time says
 * nothing about when the match ended.
 */
function remember(match, { observed = true } = {}) {
  if (!match || !match.id) return;
  const prev = db.prepare('SELECT status, finished_at FROM matches WHERE match_id = ?').get(match.id);
  // Only an observed transition gives a reliable end time; matches first seen as already
  // finished fall back to start time + match length.
  const finishedAt = prev && prev.finished_at
    ? prev.finished_at
    : observed && prev && prev.status !== 4 && match.status === 4 ? Date.now() : null;
  db.prepare(
    `INSERT INTO matches (match_id, data, start_at, status, finished_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET data = excluded.data, start_at = excluded.start_at,
       status = excluded.status, finished_at = excluded.finished_at, updated_at = excluded.updated_at`,
  ).run(match.id, JSON.stringify(strip(match)), parseStart(match.dateTime), match.status ?? null, finishedAt, Date.now());
}

function rememberAll(matches, options) {
  db.exec('BEGIN');
  try {
    for (const m of matches) remember(m, options);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Whether two match records are the same game from different sources: same series and a
 * start within 90 minutes (the same day when either has no set time).
 */
function sameGame(a, b) {
  if (!a.dateTime || !b.dateTime || !a.competition || a.competition.toLowerCase() !== (b.competition || '').toLowerCase()) return false;
  if (a.timeTbd || b.timeTbd) return a.dateTime.slice(0, 10) === b.dateTime.slice(0, 10);
  return Math.abs(new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()) <= 90 * 60000;
}

function all() {
  return db.prepare('SELECT data FROM matches').all().map((r) => JSON.parse(r.data));
}

function has(matchId) {
  return Boolean(db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(matchId));
}

function get(matchId) {
  const row = db.prepare('SELECT data FROM matches WHERE match_id = ?').get(matchId);
  return row ? { events: [], ...JSON.parse(row.data) } : null;
}

/**
 * Upload window for a match: open until `uploadWindowHours` after it ended. Returns
 * { deadline, open }; deadline is null when the start time is unknown.
 */
// A match without a set time (imported with timeTbd) is stored at 00:00; count the whole day.
const lengthOf = (data) => (JSON.parse(data).timeTbd ? 86400000 : MATCH_LENGTH_MS);

function uploadWindow(matchId) {
  const row = db.prepare('SELECT start_at, finished_at, data FROM matches WHERE match_id = ?').get(matchId);
  if (!row || (!row.finished_at && !row.start_at)) return { deadline: null, open: true, hours: config.uploadWindowHours };
  const ended = row.finished_at || row.start_at + lengthOf(row.data);
  const deadline = ended + config.uploadWindowHours * 3600000;
  return { deadline, open: Date.now() <= deadline, hours: config.uploadWindowHours };
}

/** Archived matches that have clips, excluding the given IDs (already in the schedule). */
function withVideos(excludeIds) {
  return db
    .prepare(
      `SELECT m.data FROM matches m
        WHERE EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.match_id)
        ORDER BY m.start_at DESC`,
    )
    .all()
    .map((r) => JSON.parse(r.data))
    .filter((m) => !excludeIds.has(m.id));
}

/** Matches the site keeps itself (pasted from stats.innebandy.se or synced from play.innebandy.se), oldest first. */
function imported() {
  return db
    .prepare("SELECT data FROM matches WHERE json_extract(data, '$.source') IN ('import', 'solidsport') ORDER BY start_at, match_id")
    .all()
    .map((r) => JSON.parse(r.data));
}

const PLAYED_AFTER_MS = 3 * 3600000; // a match without a reported result counts as played after this

/** All archived matches that have been played, newest first. */
function played() {
  const now = Date.now();
  return db
    .prepare('SELECT data, start_at, status FROM matches ORDER BY start_at DESC, match_id DESC')
    .all()
    .filter((r) => r.status === 4 || (r.start_at && r.start_at + Math.max(PLAYED_AFTER_MS, lengthOf(r.data)) < now && r.status !== 2 && r.status !== 3))
    .map((r) => JSON.parse(r.data));
}

module.exports = { sameGame, all, played, imported, remember, rememberAll, has, get, uploadWindow, withVideos, MATCH_LENGTH_MS };

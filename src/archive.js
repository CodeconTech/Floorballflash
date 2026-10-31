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

function strip(match) {
  const { events, ...rest } = match;
  return rest;
}

/** Saves the latest data for a match; records when it was first seen as finished. */
function remember(match) {
  if (!match || !match.id) return;
  const prev = db.prepare('SELECT status, finished_at FROM matches WHERE match_id = ?').get(match.id);
  // Only an observed transition gives a reliable end time; matches first seen as already
  // finished fall back to start time + match length.
  const finishedAt = prev && prev.finished_at
    ? prev.finished_at
    : prev && prev.status !== 4 && match.status === 4 ? Date.now() : null;
  db.prepare(
    `INSERT INTO matches (match_id, data, start_at, status, finished_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET data = excluded.data, start_at = excluded.start_at,
       status = excluded.status, finished_at = excluded.finished_at, updated_at = excluded.updated_at`,
  ).run(match.id, JSON.stringify(strip(match)), parseStart(match.dateTime), match.status ?? null, finishedAt, Date.now());
}

function rememberAll(matches) {
  db.exec('BEGIN');
  try {
    for (const m of matches) remember(m);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function has(matchId) {
  return Boolean(db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(matchId));
}

function get(matchId) {
  const row = db.prepare('SELECT data FROM matches WHERE match_id = ?').get(matchId);
  return row ? { ...JSON.parse(row.data), events: [] } : null;
}

/**
 * Upload window for a match: open until `uploadWindowHours` after it ended. Returns
 * { deadline, open }; deadline is null when the start time is unknown.
 */
function uploadWindow(matchId) {
  const row = db.prepare('SELECT start_at, finished_at FROM matches WHERE match_id = ?').get(matchId);
  if (!row || (!row.finished_at && !row.start_at)) return { deadline: null, open: true, hours: config.uploadWindowHours };
  const ended = row.finished_at || row.start_at + MATCH_LENGTH_MS;
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

module.exports = { remember, rememberAll, has, get, uploadWindow, withVideos, MATCH_LENGTH_MS };

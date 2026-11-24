'use strict';

const express = require('express');
const ibis = require('../ibis');
const live = require('../live');
const streams = require('../streams');
const archive = require('../archive');
const { getTeamSettings } = require('../db');
const auth = require('../auth');
const reporting = require('../reporting');

const router = express.Router();

router.get('/api/schedule', async (req, res) => {
  const s = await ibis.getSchedule();
  const withStream = streams.matchIdsWithStream();
  const inSchedule = new Set(s.matches.map((m) => m.id));
  res.set('Cache-Control', 'no-cache');
  res.json({
    teamId: s.teamId,
    seasonId: s.seasonId,
    updatedAt: s.at,
    error: s.matches.length ? null : s.error,
    matches: s.matches.map(({ events, ...m }) => ({ ...m, hasStream: withStream.has(m.id) })),
    // Played matches with clips that are no longer part of the schedule (e.g. earlier seasons).
    archived: archive.withVideos(inSchedule),
  });
});

// Played matches for the results page. Reads the archive, so it works without calling IBIS.
router.get('/api/results', (req, res) => {
  const { teamId } = getTeamSettings();
  res.set('Cache-Control', 'no-cache');
  res.json({ teamId, matches: archive.played() });
});

router.get('/api/matches/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(id > 0)) return res.status(400).json({ error: 'Ogiltigt match-ID.' });
  try {
    const match = await ibis.getMatch(id, { live: true });
    res.set('Cache-Control', 'no-cache');
    res.json({ match, upload: archive.uploadWindow(id), canReport: archive.has(id) && reporting.canReport(match, req.user) });
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.status === 404 ? 'Matchen hittades inte.' : 'Kunde inte hämta matchen just nu.' });
  }
});

// Live reporting from the match page (start, goal, pause, resume, end, undo).
router.post('/api/matches/:id/report', auth.requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const match = id > 0 ? archive.get(id) : null;
  if (!match) return res.status(404).json({ error: 'Matchen finns inte i lagets spelprogram.' });
  if (!reporting.canReport(match, req.user)) {
    return res.status(403).json({ error: 'Matchen kan inte rapporteras just nu (för långt före start eller redan slut).' });
  }
  let next;
  try {
    next = reporting.apply(match, req.body || {}, req.user);
  } catch (err) {
    if (err instanceof reporting.ReportError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (next !== match) {
    archive.remember(next);
    live.broadcast(next);
    ibis.getSchedule({ force: true }).catch(() => {});
  }
  res.json({ match: next });
});

router.get('/api/live', live.subscribe);

module.exports = { router };

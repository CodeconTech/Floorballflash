'use strict';

const express = require('express');
const ibis = require('../ibis');
const live = require('../live');
const streams = require('../streams');
const archive = require('../archive');

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

router.get('/api/matches/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(id > 0)) return res.status(400).json({ error: 'Ogiltigt match-ID.' });
  try {
    const match = await ibis.getMatch(id, { live: true });
    res.set('Cache-Control', 'no-cache');
    res.json({ match, upload: archive.uploadWindow(id) });
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.status === 404 ? 'Matchen hittades inte.' : 'Kunde inte hämta matchen just nu.' });
  }
});

router.get('/api/live', live.subscribe);

module.exports = { router };

'use strict';

const express = require('express');
const ibis = require('../ibis');
const live = require('../live');

const router = express.Router();

router.get('/api/schedule', async (req, res) => {
  const s = await ibis.getSchedule();
  res.set('Cache-Control', 'no-cache');
  res.json({
    teamId: s.teamId,
    seasonId: s.seasonId,
    updatedAt: s.at,
    error: s.matches.length ? null : s.error,
    matches: s.matches.map(({ events, ...m }) => m),
  });
});

router.get('/api/matches/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(id > 0)) return res.status(400).json({ error: 'Ogiltigt match-ID.' });
  try {
    res.set('Cache-Control', 'no-cache');
    res.json({ match: await ibis.getMatch(id, { live: true }) });
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.status === 404 ? 'Matchen hittades inte.' : 'Kunde inte hämta matchen just nu.' });
  }
});

router.get('/api/live', live.subscribe);

module.exports = { router };

'use strict';

const express = require('express');
const auth = require('../auth');
const streams = require('../streams');
const live = require('../live');

const router = express.Router();

function matchIdParam(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!(id > 0)) {
    res.status(400).json({ error: 'Ogiltigt match-ID.' });
    return null;
  }
  return id;
}

router.get('/api/matches/:id/stream', (req, res) => {
  const id = matchIdParam(req, res);
  if (id === null) return;
  res.set('Cache-Control', 'no-cache');
  res.json({ stream: streams.toJson(streams.get(id), req.user) });
});

// Any approved user may attach a stream to a match without one; replacing or removing an
// existing stream is limited to the user who added it and the admin.
function mayChange(req, existing) {
  return !existing || req.user.kind === 'admin' || req.user.id === existing.user_id;
}

router.put('/api/matches/:id/stream', auth.requireUser, (req, res) => {
  const id = matchIdParam(req, res);
  if (id === null) return;
  const existing = streams.get(id);
  if (!mayChange(req, existing)) {
    return res.status(403).json({ error: `Matchen har redan en sändning som ${existing.set_by.replace(/@.*/, '')} har lagt till.` });
  }
  let parsed;
  try {
    parsed = req.body.generate ? { streamId: streams.newStreamId(), password: null } : streams.parseLink(req.body.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const row = streams.set(id, parsed, req.user);
  live.broadcastStream(id, streams.toJson(row, null));
  res.json({ stream: streams.toJson(row, req.user) });
});

router.delete('/api/matches/:id/stream', auth.requireUser, (req, res) => {
  const id = matchIdParam(req, res);
  if (id === null) return;
  const existing = streams.get(id);
  if (!existing) return res.status(404).json({ error: 'Matchen har ingen sändning.' });
  if (!mayChange(req, existing)) return res.status(403).json({ error: 'Bara den som lade till sändningen eller admin kan ta bort den.' });
  streams.remove(id);
  live.broadcastStream(id, null);
  res.json({ ok: true });
});

module.exports = { router };

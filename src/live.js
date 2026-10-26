'use strict';

/**
 * Live updates: polls IBIS for matches that are (or are about to be) in progress and
 * pushes changes to browsers over Server-Sent Events.
 */

const config = require('./config');
const ibis = require('./ibis');

const clients = new Set(); // { res, matchId|null }
const lastSent = new Map(); // matchId -> JSON string
let timer = null;

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(match) {
  for (const c of clients) {
    if (c.matchId === null) send(c.res, 'score', summary(match));
    else if (c.matchId === match.id) send(c.res, 'match', match);
  }
}

function summary(m) {
  return {
    id: m.id,
    status: m.status,
    statusText: m.statusText,
    live: m.live,
    finished: m.finished,
    goalsHome: m.goalsHome,
    goalsAway: m.goalsAway,
  };
}

/** Express handler for GET /api/live[?match=ID] */
function subscribe(req, res) {
  const matchId = req.query.match ? parseInt(req.query.match, 10) : null;
  if (req.query.match && !Number.isFinite(matchId)) return res.status(400).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 5000\n\n`);
  const client = { res, matchId };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

/** Matches worth polling: live ones, ones starting soon or recently started, and watched ones. */
function matchesToPoll(schedule) {
  const now = Date.now();
  const ids = new Set();
  for (const m of schedule.matches) {
    if (m.finished || m.status === 0 && !m.dateTime) continue;
    const start = m.dateTime ? Date.parse(m.dateTime) : NaN;
    const nearStart = Number.isFinite(start) && now > start - 15 * 60000 && now < start + 4 * 3600000;
    if (m.live || nearStart) ids.add(m.id);
  }
  for (const c of clients) {
    if (c.matchId === null) continue;
    const known = schedule.matches.find((m) => m.id === c.matchId);
    if (!known || !known.finished) ids.add(c.matchId);
  }
  return ids;
}

async function tick() {
  try {
    const schedule = await ibis.getSchedule();
    for (const id of matchesToPoll(schedule)) {
      try {
        const match = await ibis.getMatch(id, { live: true, maxAgeMs: 5000 });
        const json = JSON.stringify(match);
        if (lastSent.get(id) !== json) {
          lastSent.set(id, json);
          broadcast(match);
        }
      } catch (err) {
        console.error('[live] match %s: %s', id, err.message);
      }
    }
  } catch (err) {
    console.error('[live] %s', err.message);
  } finally {
    timer = setTimeout(tick, config.ibis.livePollSeconds * 1000);
  }
}

function start() {
  if (!timer) timer = setTimeout(tick, 2000);
}

function stop() {
  clearTimeout(timer);
  timer = null;
  for (const c of clients) c.res.end();
  clients.clear();
}

module.exports = { subscribe, start, stop };

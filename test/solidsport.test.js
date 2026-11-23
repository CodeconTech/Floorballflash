'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-solidsport-'));
process.env.DATA_DIR = dataDir;
process.env.SOLIDSPORT_CHANNEL = 'holmsund-city-ibc-p14';
process.env.TEAM_ID = '120879';

const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const team = (name, channel) => ({ name, slug: channel, club_name: name, channel_slug: channel, badge_image: null });
const us = team('Holmsund City IBC P14', 'holmsund-city-ibc-p14');
const game = (slug, startUtc, home, away, extra = {}) => ({
  type: 'game', slug, ident: slug, start_at: epoch(startUtc), is_live: false, has_livestream: false,
  home_score: null, away_score: null, event: { name: 'Pantamera P Div. 12 Röd' }, groups: [],
  location: { name: 'Storsjöhallen ' }, home_team: home, away_team: away, ...extra,
});

let upcoming = [];
let past = [];
const stub = http.createServer((req, res) => {
  const body = req.url.includes('/past_games') ? past : req.url.includes('/collections/games') ? upcoming : null;
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(body ? JSON.stringify(body) : '');
});

let solidsport;
let archive;
before(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.SOLIDSPORT_BASE_URL = `http://127.0.0.1:${stub.address().port}/api/play_v1`;
  solidsport = require('../src/solidsport');
  archive = require('../src/archive');
});
after(() => {
  stub.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('adds the channel’s games in Swedish local time, with our team marked', async () => {
  upcoming = [game('up1', '2026-12-06T09:30:00Z', us, team('Sävar IK P13', 'savar'))];
  past = [
    game('p1', '2026-11-21T12:15:00Z', team('Team Thorengruppen P13', 'tt'), us, { home_score: 8, away_score: 4 }),
    game('old', '2025-11-01T12:00:00Z', us, team('IBF Dalen P14', 'dalen')), // earlier season, no score
  ];
  const now = new Date('2026-11-23T12:00:00Z').getTime();
  await solidsport.sync({ now });
  const all = archive.imported();
  assert.equal(all.length, 2, 'an earlier season without results is skipped');
  const [played, next] = all;
  assert.equal(played.dateTime, '2026-11-21T13:15:00', 'UTC to Swedish time');
  assert.deepEqual([played.goalsHome, played.goalsAway, played.status, played.away.id], [8, 4, 4, 120879]);
  assert.deepEqual([next.status, next.home.id, next.venue, next.competition], [1, 120879, 'Storsjöhallen', 'Pantamera P Div. 12 Röd']);
});

test('updates a pasted match instead of adding it again, keeping the official data', async () => {
  const official = {
    id: 1764911, source: 'import', competition: 'Pantamera P Div. 12 Röd', dateTime: '2027-01-11T18:45:00', timeTbd: false,
    status: 1, goalsHome: null, goalsAway: null, venue: 'Storsjöhallen',
    home: { id: 120879, name: 'Holmsund City IBC/OIK Svart' }, away: { id: 118485, name: 'Sandåkerns SK' }, events: [],
  };
  archive.remember(official, { observed: false });
  // Streamed game: Solidsport's start is the stream start, five minutes early.
  upcoming.push(game('jan11', '2027-01-11T17:40:00Z', us, team('Sandåkerns SK P13', 'sandakern'), { has_livestream: true }));
  await solidsport.sync({ now: new Date('2026-11-23T12:00:00Z').getTime() });
  const m = archive.get(1764911);
  assert.equal(archive.imported().filter((x) => x.dateTime.startsWith('2027-01-11')).length, 1, 'no duplicate');
  assert.equal(m.solidsport, 'jan11');
  assert.equal(m.dateTime, '2027-01-11T18:45:00', 'official time kept');
  assert.equal(m.home.name, 'Holmsund City IBC/OIK Svart', 'official name kept');
  assert.equal(m.broadcastUrl, 'https://play.innebandy.se/holmsund-city-ibc-p14/games/g/jan11');
});

test('follows a game live and records when it ended', async () => {
  const live = upcoming[0];
  const t = (iso) => new Date(iso).getTime();
  Object.assign(live, { is_live: true, home_score: 0, away_score: 0 });
  let changed = await solidsport.sync({ now: t('2026-12-06T09:35:00Z') });
  assert.equal(changed.length, 1);
  assert.deepEqual([changed[0].status, changed[0].live], [2, true]);

  Object.assign(live, { home_score: 2, away_score: 1 });
  changed = await solidsport.sync({ now: t('2026-12-06T09:50:00Z') });
  assert.deepEqual([changed[0].goalsHome, changed[0].goalsAway], [2, 1]);
  assert.equal((await solidsport.sync({ now: t('2026-12-06T09:51:00Z') })).length, 0, 'nothing new, nothing changed');

  Object.assign(live, { is_live: false, home_score: 3, away_score: 1 });
  changed = await solidsport.sync({ now: t('2026-12-06T10:40:00Z') });
  assert.deepEqual([changed[0].status, changed[0].finished, changed[0].goalsHome], [4, true, 3]);
  assert.equal(archive.uploadWindow(changed[0].id).open, true, 'upload window counts from the observed end');

  // A final result is not changed by later Solidsport data.
  Object.assign(live, { home_score: 9 });
  await solidsport.sync({ now: t('2026-12-06T11:00:00Z') });
  assert.equal(archive.get(changed[0].id).goalsHome, 3);
});

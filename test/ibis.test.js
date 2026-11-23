'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-ibis-'));
process.env.DATA_DIR = dataDir;
delete process.env.IBIS_MOCK;
process.env.COMPETITION_IDS = '999';

const TEAM = 120879;
const match = (id, home, away) => ({ MatchID: id, MatchDateTime: `2026-11-0${id % 10}T18:30:00`, HomeTeamID: home, AwayTeamID: away, HomeTeam: `Lag ${home}`, AwayTeam: `Lag ${away}`, MatchStatus: 1 });

// Behaves like the live API reported by users: no team schedule endpoint, and the team
// endpoint answers 401 without the startkit token but tells the team's competition with it.
const stub = http.createServer((req, res) => {
  if (req.url === '/v2/api/public/seasons/44/teams/120879' && req.headers.authorization !== 'Bearer tok') {
    res.writeHead(401);
    return res.end();
  }
  const routes = {
    '/StatsAppApi/api/startkit': { accessToken: 'tok', accessTokenExpiration: new Date(Date.now() + 3600000).toISOString() },
    '/v2/api/public/seasons/44/teams/120879': { TeamID: TEAM, TeamName: 'Floorballflash', CompetitionID: 4321 },
    '/v2/api/public/competitions/4321/matches': [match(1, TEAM, 2), match(2, 3, 4), match(3, 5, TEAM)],
    '/v2/api/public/competitions/999/matches': [match(4, TEAM, 6), match(5, 7, 8)],
  };
  const body = routes[req.url];
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(body ? JSON.stringify(body) : '');
});

let ibis;

before(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.IBIS_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  ibis = require('../src/ibis');
});

after(() => {
  stub.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('combines COMPETITION_IDS with the team’s competitions found using the startkit token', async () => {
  const schedule = await ibis.getSchedule({ force: true });
  assert.equal(schedule.error, null);
  assert.deepEqual(schedule.matches.map((m) => m.id), [1, 3, 4]);
  assert.equal(schedule.source, 'serie 999, serie 4321');
});

test('collect finds competition IDs nested anywhere', () => {
  const ids = ibis.collect({ Team: { Competitions: [{ CompetitionID: 7 }, { competitionId: 9 }] }, CompetitionID: 0 }, 'competitionid');
  assert.deepEqual([...ids], [7, 9]);
});

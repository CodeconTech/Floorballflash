'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-import-'));
const { parse } = require('../src/import');
const { tokensFromFixture } = require('./fixtures/tokens');

const now = new Date('2026-11-23T12:00:00');

test('reads matches copied with links from stats.innebandy.se', () => {
  const { matches, skipped } = parse(tokensFromFixture({ links: true }), { teamId: 120879, now });
  assert.equal(skipped, 0);
  assert.equal(matches.length, 5);

  const [first, tbd, nextYear, noTime] = matches;
  assert.deepEqual(
    { id: first.id, competitionId: first.competitionId, competition: first.competition, dateTime: first.dateTime, venue: first.venue },
    { id: 1764896, competitionId: 45226, competition: 'Pantamera P Div. 12 Röd', dateTime: '2026-11-19T20:10:00', venue: 'Musköten 2' },
  );
  assert.deepEqual([first.goalsHome, first.goalsAway, first.status, first.finished], [1, 8, 4, true]);
  assert.deepEqual([first.home.id, first.away.id], [118485, 120879]);

  assert.equal(tbd.timeTbd, true, '"saknar fastställd tid"');
  assert.equal(tbd.status, 1);
  assert.equal(tbd.goalsHome, null);
  assert.equal(nextYear.dateTime, '2027-01-11T18:45:00', 'January belongs to the next calendar year of the season');
  assert.equal(noTime.timeTbd, true, 'a played match listed without a time');
  assert.equal(noTime.competition, 'Pantamera P Div. 14 Röd');
});

test('reads the same schedule copied as plain text and finds the team by name', () => {
  const { matches } = parse(tokensFromFixture({ links: false }), { teamId: 120879, now });
  assert.equal(matches.length, 5);
  for (const m of matches) {
    assert.ok([m.home.id, m.away.id].includes(120879), `${m.home.name} – ${m.away.name}`);
    assert.ok(m.id > 3_000_000_000, 'synthetic ID without links');
  }
  // Pasting again gives the same IDs, so a re-import updates instead of duplicating.
  assert.deepEqual(parse(tokensFromFixture({ links: false }), { teamId: 120879, now }).matches.map((m) => m.id), matches.map((m) => m.id));
});

test('ignores text that is not a schedule', () => {
  const { matches } = parse([{ text: 'Utvalt Turneringar Serier' }, { text: 'hej' }], { teamId: 1, now });
  assert.equal(matches.length, 0);
});

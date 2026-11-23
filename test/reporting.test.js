'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-report-'));
const { apply, canReport, ReportError } = require('../src/reporting');

const user = { kind: 'user', id: 1, email: 'a@b.se' };
const base = { id: 1, status: 1, dateTime: '2026-11-29T13:30:00', home: { name: 'Hemma' }, away: { name: 'Borta' }, goalsHome: null, goalsAway: null, events: [] };
const at = (s) => new Date(`2026-11-29T${s}`).getTime();

test('reporting a match from start to end', () => {
  let m = apply(base, { action: 'start' }, user, at('13:31:00'));
  assert.deepEqual([m.status, m.live, m.goalsHome, m.goalsAway], [2, true, 0, 0]);

  m = apply(m, { action: 'goal', side: 'home', player: '#14 Erik' }, user, at('13:36:30'));
  assert.equal(apply(m, { action: 'goal', side: 'home' }, user, at('13:36:32')), m, 'a double tap counts once');
  m = apply(m, { action: 'goal', side: 'away' }, user, at('13:40:00'));
  assert.deepEqual([m.goalsHome, m.goalsAway], [1, 1]);
  assert.deepEqual(m.events.map((e) => [e.player, e.minute, e.second, e.goalsHome, e.goalsAway]), [['#14 Erik', 5, 30, 1, 0], ['', 9, 0, 1, 1]]);

  m = apply(m, { action: 'pause' }, user, at('13:52:00'));
  assert.deepEqual([m.status, m.live, m.statusText], [3, true, 'Paus']);
  assert.throws(() => apply(m, { action: 'goal', side: 'home' }, user), ReportError, 'no goals during a break');
  m = apply(m, { action: 'resume' }, user, at('13:55:00'));
  m = apply(m, { action: 'goal', side: 'home' }, user, at('13:57:00'));
  assert.equal(m.events.at(-1).period, 2);
  assert.deepEqual(m.periods, [{ period: 1, home: 1, away: 1 }, { period: 2, home: 1, away: 0 }]);

  m = apply(m, { action: 'undo' }, user, at('13:58:00'));
  assert.deepEqual([m.goalsHome, m.events.length, m.periods[1].home], [1, 2, 0]);

  m = apply(m, { action: 'end' }, user, at('14:30:00'));
  assert.deepEqual([m.status, m.finished, m.live], [4, true, false]);
  assert.equal(base.status, 1, 'the input is not changed');
});

test('who may report and when', () => {
  assert.equal(canReport(base, null, at('13:00:00')), false, 'not logged in');
  assert.equal(canReport(base, user, at('11:29:00')), false, 'too early');
  assert.equal(canReport(base, user, at('11:31:00')), true, 'two hours before start');
  assert.equal(canReport(base, user, new Date('2026-11-29T19:31:00').getTime()), false, 'six hours after');
  assert.equal(canReport({ ...base, status: 2 }, user, at('23:00:00')), true, 'a running match can always be reported');
  assert.equal(canReport({ ...base, status: 4 }, user, at('14:00:00')), false, 'finished');
  assert.equal(canReport(base, { kind: 'admin' }, 0), true, 'the admin any time');
  const tbd = { ...base, dateTime: '2026-11-29T00:00:00', timeTbd: true };
  assert.equal(canReport(tbd, user, at('20:00:00')), true, 'no set time: the whole day');
});

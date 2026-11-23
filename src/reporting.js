'use strict';

/**
 * Live reporting from the match page: approved users press Start, goal, Pause, Resume and
 * End during the game, and the score, periods and goal events are kept on the match in the
 * archive (match.report holds the clock state). Used now that the federation's live data
 * can't be fetched.
 */

const { STATUS_TEXT } = require('./ibis');

const HOUR = 3600000;

class ReportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * Who may report: approved users (and the admin) from two hours before the start until six
 * hours after; a match without a set time all of its day. Finished matches are corrected on
 * the admin page instead.
 */
function canReport(match, user, now = Date.now()) {
  if (!user || !match) return false;
  if (match.status === 4) return false;
  if (match.status === 2 || match.status === 3 || user.kind === 'admin') return true;
  const start = match.dateTime ? new Date(match.dateTime).getTime() : NaN;
  if (!Number.isFinite(start)) return false;
  const [from, to] = match.timeTbd ? [start, start + 24 * HOUR] : [start - 2 * HOUR, start + 6 * HOUR];
  return now >= from && now <= to;
}

function periodsFrom(events, lastPeriod) {
  const periods = [];
  for (let p = 1; p <= lastPeriod; p++) {
    const goals = events.filter((e) => e.reported && e.period === p);
    periods.push({ period: p, home: goals.filter((e) => e.side === 'home').length, away: goals.filter((e) => e.side === 'away').length });
  }
  return periods;
}

/** Returns a new match object with the action applied, or throws ReportError. */
function apply(current, { action, side, player }, user, now = Date.now()) {
  const m = structuredClone(current);
  m.events = Array.isArray(m.events) ? m.events : [];
  m.report = m.report || { period: 0, periodStartedAt: null, lastGoal: null };
  const r = m.report;
  const need = (ok, message) => {
    if (!ok) throw new ReportError(message);
  };

  switch (action) {
    case 'start':
      need(m.status !== 2 && m.status !== 3 && m.status !== 4, 'Matchen har redan startat.');
      Object.assign(r, { period: 1, periodStartedAt: now });
      m.status = 2;
      m.goalsHome = m.goalsHome ?? 0;
      m.goalsAway = m.goalsAway ?? 0;
      break;
    case 'pause':
      need(m.status === 2, 'Matchen pågår inte.');
      m.status = 3;
      break;
    case 'resume':
      need(m.status === 3, 'Matchen är inte i paus.');
      Object.assign(r, { period: r.period + 1, periodStartedAt: now });
      m.status = 2;
      break;
    case 'end':
      need(m.status === 2 || m.status === 3, 'Matchen pågår inte.');
      m.status = 4;
      break;
    case 'goal': {
      need(m.status === 2, 'Starta matchen (eller fortsätt efter paus) innan du rapporterar mål.');
      need(side === 'home' || side === 'away', 'Ange vilket lag som gjorde mål.');
      // A double tap from the same person within a few seconds counts once.
      if (r.lastGoal && r.lastGoal.side === side && r.lastGoal.by === user.email && now - r.lastGoal.at < 4000) return current;
      const elapsed = Math.max(0, now - (r.periodStartedAt || now));
      const team = m[side];
      if (side === 'home') m.goalsHome = (m.goalsHome ?? 0) + 1;
      else m.goalsAway = (m.goalsAway ?? 0) + 1;
      m.events.push({
        id: now,
        type: 'Mål',
        period: r.period,
        periodName: `Period ${r.period}`,
        minute: Math.floor(elapsed / 60000),
        second: Math.floor(elapsed / 1000) % 60,
        player: String(player || '').trim().slice(0, 60),
        playerNo: null,
        assist: '',
        penalty: '',
        team: team ? team.name : '',
        side,
        goalsHome: m.goalsHome,
        goalsAway: m.goalsAway,
        reported: true,
        reportedBy: user.email,
      });
      r.lastGoal = { side, by: user.email, at: now };
      break;
    }
    case 'undo': {
      need(m.status === 2 || m.status === 3, 'Matchen pågår inte.');
      const idx = m.events.map((e) => Boolean(e.reported)).lastIndexOf(true);
      need(idx >= 0, 'Det finns inget mål att ångra.');
      const [goal] = m.events.splice(idx, 1);
      if (goal.side === 'home') m.goalsHome = Math.max(0, m.goalsHome - 1);
      else m.goalsAway = Math.max(0, m.goalsAway - 1);
      r.lastGoal = null;
      break;
    }
    default:
      throw new ReportError('Okänd åtgärd.');
  }

  m.statusText = STATUS_TEXT[m.status];
  m.live = m.status === 2 || m.status === 3;
  m.finished = m.status === 4;
  if (r.period) m.periods = periodsFrom(m.events, r.period);
  return m;
}

module.exports = { apply, canReport, ReportError };

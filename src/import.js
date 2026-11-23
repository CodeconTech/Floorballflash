'use strict';

/**
 * Reads a team schedule copied from stats.innebandy.se (e.g. /sasong/44/lag/120879/spelprogram).
 *
 * The browser turns the pasted page into tokens: { text, href? } in document order. Each
 * match on the page is
 *   home team (link .../lag/{id}/trupp)
 *   result "1 - 8" or time "18:45" ("0:00" = no time set) (link .../serie/{id}/match/{id})
 *   away team
 *   "19 november 20:10" or "29 november, saknar fastställd tid", then the venue
 * and a series name ("Pantamera P Div. 12 Röd") heads each group. Copied as plain text the
 * same lines come without links and with the venue on the date line.
 */

const crypto = require('node:crypto');
const { STATUS_TEXT } = require('./ibis');

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const SCORE_RE = /^(\d+)\s*[-–]\s*(\d+)$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_RE = new RegExp(`^(\\d{1,2})\\s+(${MONTHS.join('|')})(?:,?\\s*saknar fastställd tid|\\s+(\\d{1,2}):(\\d{2}))?\\s*(.*)$`, 'i');
const IGNORED = /^(expand_less|expand_more)$/i;

const idFrom = (href, kind) => {
  const m = href && new RegExp(`/${kind}/(\\d+)`).exec(href);
  return m ? Number(m[1]) : null;
};

// Stable ID for matches pasted without links, far above IBIS's own match IDs.
function syntheticId(...parts) {
  return 3_000_000_000 + (crypto.createHash('sha1').update(parts.join('|')).digest().readUInt32BE(0) % 1_000_000_000);
}

/** The calendar year of a date in the season around `now` (seasons run August–July). */
function yearFor(monthIndex, now) {
  const seasonStart = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return monthIndex >= 7 ? seasonStart : seasonStart + 1;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Turns tokens into matches in the app's match format. `teamId` marks the team's own side
 * when the paste has no links. Returns { matches, skipped } where skipped counts match-like
 * blocks that couldn't be read.
 */
function parse(tokens, { teamId, now = new Date() } = {}) {
  const list = (Array.isArray(tokens) ? tokens : [])
    .slice(0, 5000)
    .map((t) => ({ text: String((t && t.text) || '').replace(/\s+/g, ' ').trim().slice(0, 200), href: t && t.href ? String(t.href).slice(0, 300) : '' }))
    .filter((t) => t.text && !IGNORED.test(t.text));

  const matches = [];
  let series = '';
  let skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const mid = list[i + 1];
    const date = list[i + 3] && DATE_RE.exec(list[i + 3].text);
    const isMatch = mid && (SCORE_RE.test(mid.text) || TIME_RE.test(mid.text)) && list[i + 2] && date;
    if (!isMatch) {
      // Text that isn't part of a match is a series heading (or page chrome before the first one).
      if (!list[i].href && !DATE_RE.test(list[i].text)) series = list[i].text;
      else if (SCORE_RE.test(list[i].text) || TIME_RE.test(list[i].text)) skipped++;
      continue;
    }
    const [home, , away] = [list[i], mid, list[i + 2]];
    const [, day, monthName, hh, mm, rest] = date;
    let venue = rest.trim();
    let consumed = 4;
    const next = list[i + 4];
    if (!venue && next && /\/anlaggning\//.test(next.href)) {
      venue = next.text;
      consumed = 5;
    }

    const monthIndex = MONTHS.indexOf(monthName.toLowerCase());
    const dateStr = `${yearFor(monthIndex, now)}-${pad(monthIndex + 1)}-${pad(day)}`;
    const timeKnown = hh !== undefined;
    const score = SCORE_RE.exec(mid.text);
    const status = score ? 4 : 1;
    const competitionId = idFrom(mid.href, 'serie');
    const id = idFrom(mid.href, 'match') || syntheticId(series, dateStr, home.text, away.text);
    const side = (t) => ({ id: idFrom(t.href, 'lag'), matchTeamId: null, name: t.text, shortName: t.text, logo: null });

    matches.push({
      id,
      matchNo: '',
      seasonId: idFrom(mid.href, 'sasong'),
      competitionId,
      competition: series,
      round: '',
      dateTime: `${dateStr}T${timeKnown ? `${pad(hh)}:${mm}` : '00:00'}:00`,
      timeTbd: !timeKnown,
      venue,
      spectators: null,
      status,
      statusText: STATUS_TEXT[status],
      live: false,
      finished: status === 4,
      goalsHome: score ? Number(score[1]) : null,
      goalsAway: score ? Number(score[2]) : null,
      home: side(home),
      away: side(away),
      periods: [],
      events: [],
      broadcastUrl: null,
      ticketUrl: null,
      statsUrl: /^https:\/\/stats\.innebandy\.se\//.test(mid.href) ? mid.href : null,
      source: 'import',
    });
    i += consumed - 1;
  }

  markOwnTeam(matches, teamId);
  return { matches, skipped };
}

/**
 * Without links there are no team IDs. The team is then the club that plays in the most
 * matches; names are compared up to the last "/", so "Holmsund City IBC/OIK Svart" and
 * "Holmsund City IBC/OIK Grön" both count.
 */
function markOwnTeam(matches, teamId) {
  const noIds = matches.filter((m) => m.home.id === null && m.away.id === null);
  if (!noIds.length || !teamId) return;
  const club = (name) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : name);
  const counts = new Map();
  for (const m of noIds) for (const c of new Set([club(m.home.name), club(m.away.name)])) counts.set(c, (counts.get(c) || 0) + 1);
  const [ours] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  for (const m of noIds) {
    for (const t of [m.home, m.away]) if (club(t.name) === ours) t.id = teamId;
  }
}

module.exports = { parse };

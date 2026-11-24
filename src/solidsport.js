'use strict';

/**
 * Schedule, results and live scores from the team's channel on play.innebandy.se, the
 * federation's streaming site run by Solidsport. Its API is open (no signing), unlike the
 * IBIS API behind stats.innebandy.se, and lists every game of the channel's teams with the
 * score and whether it is live – also for games that aren't streamed.
 *
 * Games are merged into the match archive: a game that matches a match already there (same
 * series and start time, e.g. pasted from stats.innebandy.se) updates it, so its ID and its
 * clips stay; other games are added. Polling is slow normally and fast around games.
 */

const crypto = require('node:crypto');
const config = require('./config');
const { getTeamSettings } = require('./db');
const archive = require('./archive');

const HOUR = 3600000;
const STATUS_TEXT = { 1: 'Ej påbörjad', 2: 'Pågår', 3: 'Paus', 4: 'Slut' };

const state = { lastSync: null, lastError: null, games: 0, timer: null };

async function get(path) {
  const res = await fetch(`${config.solidsport.baseUrl}${path}`, {
    headers: {
      accept: 'application/json',
      referer: 'https://play.innebandy.se/',
      'user-agent': `Floorballflash/1.0 (${config.publicUrl})`,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw Object.assign(new Error(`Solidsport ${path}: HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/** Upcoming and played games of the channel, newest data per game. */
async function fetchGames(channel) {
  const q = `company=${encodeURIComponent(channel)}&page=1&per_page=100&include_games_without_livestreams=true`;
  const [upcoming, past] = await Promise.all([
    get(`/timeline_objects/collections/games?${q}`),
    get(`/timeline_objects/collections/past_games?${q}`),
  ]);
  const bySlug = new Map();
  for (const g of [...(Array.isArray(past) ? past : []), ...(Array.isArray(upcoming) ? upcoming : [])]) {
    if (g && g.type === 'game' && g.slug && g.start_at) bySlug.set(g.slug, g);
  }
  return [...bySlug.values()];
}

// Solidsport gives UTC epoch seconds; the app stores Swedish local time without a zone.
const localFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const localDateTime = (epochSeconds) => localFmt.format(new Date(epochSeconds * 1000)).replace(' ', 'T');

function seriesOf(g) {
  const groups = (g.groups || []).map((x) => x.name).filter(Boolean);
  return (g.event && g.event.name) || groups.find((n) => /div|serie/i.test(n)) || groups[groups.length - 1] || '';
}

function seasonStart(now = new Date()) {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 7, 1).getTime();
}

const syntheticId = (slug) => 4_000_000_000 + (crypto.createHash('sha1').update(slug).digest().readUInt32BE(0) % 1_000_000_000);

/** The archived match this game is, if any: linked earlier, or same series and start time. */
function findExisting(g, matches) {
  const linked = matches.find((m) => m.solidsport === g.slug);
  if (linked) return linked;
  const asMatch = { competition: seriesOf(g), dateTime: localDateTime(g.start_at), timeTbd: false };
  return matches.find((m) => !m.solidsport && archive.sameGame(m, asMatch));
}

function side(team, channel, teamId) {
  return {
    id: team.channel_slug === channel ? teamId : null,
    matchTeamId: null,
    name: (team.name || '').trim(),
    shortName: (team.name || '').trim(),
    logo: team.badge_image && team.badge_image.sm ? team.badge_image.sm : null,
  };
}

/**
 * Applies a Solidsport game to an archived match (or builds a new one). Returns the updated
 * match, or null when nothing changed. A result already final in the archive (e.g. pasted
 * from stats.innebandy.se, the official source) is not overwritten.
 */
function merge(g, existing, { channel, teamId, now = Date.now() }) {
  const hasScore = g.home_score !== null && g.home_score !== undefined && g.away_score !== null && g.away_score !== undefined;
  const status = g.is_live ? 2 : hasScore && g.start_at * 1000 < now ? 4 : 1;
  const m = existing
    ? structuredClone(existing)
    : {
        id: syntheticId(g.slug),
        matchNo: '',
        seasonId: null,
        competitionId: null,
        round: '',
        spectators: null,
        periods: [],
        events: [],
        ticketUrl: null,
        statsUrl: null,
        source: 'solidsport',
      };
  const before = JSON.stringify(m);

  m.solidsport = g.slug;
  m.competition = m.competition || seriesOf(g);
  // The official time from stats.innebandy.se wins: for streamed games start_at is when the
  // stream starts, a few minutes early.
  if (!existing || existing.timeTbd || !existing.dateTime) {
    m.dateTime = localDateTime(g.start_at);
    m.timeTbd = false;
  }
  m.venue = (g.location && g.location.name ? g.location.name.trim() : '') || m.venue || '';
  for (const key of ['home', 'away']) {
    const fresh = side(g[`${key}_team`], channel, teamId);
    const old = existing && existing[key];
    // Keep IDs and names from stats.innebandy.se ("…/OIK Svart" tells the two P14 teams apart).
    m[key] = old ? { ...fresh, id: old.id ?? fresh.id, name: old.name || fresh.name, shortName: old.name || fresh.name } : fresh;
  }
  if (g.has_livestream) m.broadcastUrl = `https://play.innebandy.se/${channel}/games/g/${g.ident || g.slug}`;

  const finalInArchive = existing && existing.status === 4 && existing.goalsHome !== null && existing.goalsHome !== undefined;
  if (!finalInArchive) {
    if (hasScore) {
      m.goalsHome = g.home_score;
      m.goalsAway = g.away_score;
    }
    // Don't undo a match someone is reporting live on the site unless Solidsport has news.
    const reportingHere = existing && existing.report && (existing.status === 2 || existing.status === 3);
    if (!(reportingHere && status === 1)) m.status = status;
  }
  m.status = m.status ?? 1;
  m.statusText = STATUS_TEXT[m.status];
  m.live = m.status === 2 || m.status === 3;
  m.finished = m.status === 4;
  m.goalsHome = m.goalsHome ?? null;
  m.goalsAway = m.goalsAway ?? null;

  return JSON.stringify(m) === before ? null : m;
}

/** Fetches the channel and updates the archive. Returns the matches that changed. */
async function sync({ now = Date.now() } = {}) {
  const { channel } = config.solidsport;
  if (!channel) return [];
  const { teamId } = getTeamSettings();
  const games = (await fetchGames(channel)).filter((g) => {
    // Older seasons have no scores; only this season's games and any with a result.
    const scored = g.home_score !== null && g.home_score !== undefined;
    return scored || g.start_at * 1000 >= seasonStart(new Date(now));
  });
  const matches = archive.all();
  const changed = [];
  for (const g of games) {
    const existing = findExisting(g, matches);
    const updated = merge(g, existing, { channel, teamId, now });
    if (!updated) continue;
    // Only an end seen while polling (live before, or a game that just started) dates the end.
    const observed = Boolean(existing && (existing.status === 2 || existing.status === 3 || g.start_at * 1000 > now - 6 * HOUR));
    archive.remember(updated, { observed });
    if (!existing) matches.push(updated);
    changed.push(updated);
  }
  Object.assign(state, { lastSync: now, lastError: null, games: games.length });
  return changed;
}

/** Poll fast while a game is live or about to start, slowly otherwise. */
function nextDelay(now = Date.now()) {
  const busy = archive.imported().some((m) => {
    if (m.live) return true;
    if (m.finished || !m.dateTime) return false;
    const start = new Date(m.dateTime).getTime();
    return now > start - 15 * 60000 && now < start + 3 * HOUR;
  });
  return busy ? config.solidsport.livePollSeconds * 1000 : config.solidsport.pollMinutes * 60000;
}

function start({ onChange } = {}) {
  if (!config.solidsport.channel || state.timer) return;
  const run = async () => {
    try {
      const changed = await sync();
      if (changed.length && onChange) await onChange(changed);
    } catch (err) {
      state.lastError = err.message;
      console.error('[solidsport] %s', err.message);
    } finally {
      state.timer = setTimeout(run, nextDelay());
    }
  };
  state.timer = setTimeout(run, 3000);
}

function status() {
  return { channel: config.solidsport.channel, lastSync: state.lastSync, lastError: state.lastError, games: state.games };
}

module.exports = { sync, merge, findExisting, fetchGames, start, status, localDateTime };

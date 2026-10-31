'use strict';

/**
 * Client for the IBIS API (api.innebandy.se) that powers stats.innebandy.se.
 *
 * - Public data lives under /v2/api/public and needs no authentication.
 * - Live data for an ongoing match (events, goals) is only returned when the request
 *   carries the anonymous bearer token handed out by /StatsAppApi/api/startkit.
 */

const config = require('./config');
const { getTeamSettings } = require('./db');
const mock = require('./ibis-mock');

const ROOT = '/v2/api/public';
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'sv,en;q=0.8',
  origin: 'https://stats.innebandy.se',
  referer: 'https://stats.innebandy.se/',
  'user-agent': 'Mozilla/5.0 (compatible; Floorballflash/1.0)',
};

const STATUS_TEXT = {
  0: 'Okänd',
  1: 'Ej påbörjad',
  2: 'Pågår',
  3: 'Paus',
  4: 'Slut',
};

let token = null; // { value, expires }
let tokenBlockedUntil = 0;

async function getToken() {
  if (token && Date.now() < token.expires) return token.value;
  if (Date.now() < tokenBlockedUntil) throw new Error('IBIS-token: väntar efter tidigare fel');
  try {
    const res = await fetch(`${config.ibis.baseUrl}/StatsAppApi/api/startkit`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`IBIS-token: HTTP ${res.status}`);
    const body = await res.json();
    const expires = Date.parse(body.accessTokenExpiration);
    token = {
      value: body.accessToken,
      // Refresh a minute early; fall back to 10 minutes if the expiry is unparseable.
      expires: Number.isFinite(expires) ? expires - 60000 : Date.now() + 600000,
    };
    return token.value;
  } catch (err) {
    tokenBlockedUntil = Date.now() + 30000;
    throw err;
  }
}

async function request(path, { auth = false } = {}) {
  const doFetch = async () => {
    const headers = { ...HEADERS };
    if (auth) headers.authorization = `Bearer ${await getToken()}`;
    return fetch(`${config.ibis.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  };
  let res = await doFetch();
  if (res.status === 401) {
    // Some public endpoints (e.g. teams) need the anonymous startkit token too.
    if (auth) token = null;
    auth = true;
    res = await doFetch();
  }
  if (!res.ok) {
    const err = new Error(`IBIS ${path}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function team(m, side) {
  const p = side === 'home' ? 'HomeTeam' : 'AwayTeam';
  return {
    id: m[`${p}ID`] ?? null,
    matchTeamId: m[side === 'home' ? 'HomeMatchTeamID' : 'AwayMatchTeamID'] ?? null,
    name: m[p] || '',
    shortName: m[`${p}ShortName`] || m[p] || '',
    logo: m[`${p}LogotypeUrl`] || null,
  };
}

function normalizeEvent(e, m) {
  let teamName = e.MatchTeamName || '';
  if (!teamName && e.MatchTeamID) {
    if (e.MatchTeamID === m.HomeMatchTeamID) teamName = m.HomeTeam;
    else if (e.MatchTeamID === m.AwayMatchTeamID) teamName = m.AwayTeam;
  }
  let side = null;
  if (e.MatchTeamID && e.MatchTeamID === m.HomeMatchTeamID) side = 'home';
  else if (e.MatchTeamID && e.MatchTeamID === m.AwayMatchTeamID) side = 'away';
  return {
    id: e.MatchEventID ?? null,
    type: e.MatchEventType || '',
    typeId: e.MatchEventTypeID ?? null,
    period: e.Period ?? null,
    periodName: e.PeriodName || '',
    minute: e.Minute ?? 0,
    second: e.Second ?? 0,
    player: e.PlayerName || '',
    playerNo: e.PlayerShirtNo ?? null,
    assist: e.PlayerAssistName || '',
    assistNo: e.PlayerAssistShirtNo ?? null,
    penalty: e.PenaltyName || '',
    team: teamName,
    side,
    goalsHome: e.GoalsHomeTeam ?? null,
    goalsAway: e.GoalsAwayTeam ?? null,
  };
}

function normalizeMatch(m) {
  const status = m.MatchStatus ?? 0;
  const events = Array.isArray(m.Events)
    ? m.Events.map((e) => normalizeEvent(e, m)).sort(
        (a, b) => (a.period ?? 0) - (b.period ?? 0) || a.minute - b.minute || a.second - b.second || (a.id ?? 0) - (b.id ?? 0),
      )
    : [];
  const periods = Array.isArray(m.IntermediateResults)
    ? m.IntermediateResults.map((r) => ({ period: r.Period, home: r.GoalsHomeTeam ?? 0, away: r.GoalsAwayTeam ?? 0 }))
    : [];
  return {
    id: m.MatchID,
    matchNo: m.MatchNo || '',
    seasonId: m.SeasonID ?? null,
    competitionId: m.CompetitionID ?? null,
    competition: m.CompetitionName || m.CategoryName || '',
    round: m.RoundName || (m.Round ? `Omgång ${m.Round}` : ''),
    dateTime: m.MatchDateTime || null,
    venue: m.Venue || m.MainVenue || '',
    spectators: m.Spectators ?? null,
    status,
    statusText: m.Cancelled ? 'Inställd' : m.Postponed ? 'Uppskjuten' : m.Abandoned ? 'Avbruten' : STATUS_TEXT[status] || 'Okänd',
    live: status === 2 || status === 3,
    finished: status === 4,
    goalsHome: m.GoalsHomeTeam ?? null,
    goalsAway: m.GoalsAwayTeam ?? null,
    home: team(m, 'home'),
    away: team(m, 'away'),
    periods,
    events,
    broadcastUrl: m.BroadcastUrl || null,
    ticketUrl: m.TicketUrl || null,
    statsUrl: m.MatchID ? `https://stats.innebandy.se/match/${m.MatchID}` : null,
  };
}

function involvesTeam(m, teamId) {
  return [m.HomeTeamID, m.AwayTeamID, m.HomeMatchTeamID, m.AwayMatchTeamID].includes(teamId);
}

let schedule = { at: 0, key: '', matches: [], source: '', error: null };
let workingTeamPath = null;
const discovered = new Map(); // "seasonId/teamId" -> competition IDs found via the team endpoints

/** Collects values of keys named like `key` (case-insensitive) anywhere in a JSON value. */
function collect(value, key, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => collect(v, key, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase() === key && Number.isInteger(v) && v > 0) out.add(v);
      else collect(v, key, out);
    }
  }
  return out;
}

/**
 * Finds the competitions (series) a team plays in from the documented team endpoints
 * (api/seasons/{seasonID}/teams/{teamID} and api/teams/{teamID}).
 */
async function discoverCompetitions(s, errors) {
  const cacheKey = `${s.seasonId}/${s.teamId}`;
  if (discovered.has(cacheKey)) return discovered.get(cacheKey);
  const ids = new Set();
  for (const p of [`${ROOT}/seasons/${s.seasonId}/teams/${s.teamId}`, `${ROOT}/teams/${s.teamId}`]) {
    try {
      const team = await request(p);
      collect(team, 'competitionid', ids);
      if (ids.size) {
        console.log('[ibis] lag %s spelar i serie %s (från %s)', s.teamId, [...ids].join(', '), p);
        break;
      }
      console.warn('[ibis] %s gav inget serie-ID. Fält i svaret: %s', p, team && typeof team === 'object' ? Object.keys(team).join(', ') : typeof team);
    } catch (err) {
      errors.push(err.message);
    }
  }
  const list = [...ids];
  if (list.length) discovered.set(cacheKey, list);
  return list;
}

/**
 * Collects the team's fixtures. IBIS has no documented "matches for team" endpoint in the
 * public API, so several strategies are tried and combined:
 *   1. a team endpoint (a configurable path, or a few known patterns),
 *   2. all matches of the configured competitions, filtered on the team,
 *   3. explicitly listed match IDs.
 */
async function fetchSchedule() {
  const s = getTeamSettings();
  if (config.ibis.mock) return { matches: mock.schedule(s.teamId), source: 'mock' };

  const byId = new Map();
  const sources = [];
  const errors = [];
  const add = (list, source) => {
    let n = 0;
    for (const m of list || []) {
      if (m && m.MatchID && !byId.has(m.MatchID)) {
        byId.set(m.MatchID, m);
        n++;
      }
    }
    if (n) sources.push(source);
  };

  const fill = (p) => p.replaceAll('{teamId}', s.teamId).replaceAll('{seasonId}', s.seasonId);
  const candidates = s.teamMatchesPath
    ? [s.teamMatchesPath]
    : [
        workingTeamPath,
        `${ROOT}/seasons/{seasonId}/teams/{teamId}/matches`,
        `${ROOT}/teams/{teamId}/matches`,
      ].filter((p, i, arr) => p && arr.indexOf(p) === i);
  for (const p of candidates) {
    try {
      const list = await request(fill(p));
      if (Array.isArray(list)) {
        workingTeamPath = p;
        add(list.filter((m) => involvesTeam(m, s.teamId) || !('HomeTeamID' in m)), 'lag');
        break;
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  // Without a team schedule endpoint, use the team's own competitions plus configured ones.
  const competitionIds = new Set(s.competitionIds);
  if (!byId.size) for (const cid of await discoverCompetitions(s, errors)) competitionIds.add(cid);

  for (const cid of competitionIds) {
    try {
      const list = await request(`${ROOT}/competitions/${cid}/matches`);
      add((list || []).filter((m) => involvesTeam(m, s.teamId)), `serie ${cid}`);
    } catch (err) {
      errors.push(err.message);
    }
  }

  for (const mid of s.extraMatchIds) {
    if (byId.has(mid)) continue;
    try {
      add([await request(`${ROOT}/matches/${mid}`)], 'match-id');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (!byId.size && errors.length) {
    throw new Error(`${errors.join('; ')}. Ange lagets serie-ID på adminsidan (Lag och datakälla).`);
  }
  return { matches: [...byId.values()], source: sources.join(', ') };
}

async function getSchedule({ force = false } = {}) {
  const s = getTeamSettings();
  const key = JSON.stringify(s);
  const fresh = Date.now() - schedule.at < config.ibis.scheduleCacheSeconds * 1000;
  if (!force && fresh && schedule.key === key) return schedule;
  try {
    const { matches, source } = await fetchSchedule();
    const normalized = matches.map(normalizeMatch).sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
    // Keep fresher live data that the live poller may already have merged in.
    for (const m of normalized) {
      const known = liveCache.get(m.id);
      if (known && known.at > Date.now() - 120000) Object.assign(m, pickScore(known.match));
    }
    schedule = { at: Date.now(), key, matches: normalized, source, error: null, teamId: s.teamId, seasonId: s.seasonId };
  } catch (err) {
    console.error('[ibis] kunde inte hämta spelprogram:', err.message);
    schedule = { ...schedule, at: Date.now() - (config.ibis.scheduleCacheSeconds - 20) * 1000, key, error: err.message };
  }
  return schedule;
}

const liveCache = new Map(); // matchId -> { at, match }

function pickScore(m) {
  return {
    status: m.status,
    statusText: m.statusText,
    live: m.live,
    finished: m.finished,
    goalsHome: m.goalsHome,
    goalsAway: m.goalsAway,
    periods: m.periods,
  };
}

/** Fetches one match. `live` attaches the startkit token so ongoing events are included. */
async function getMatch(matchId, { live = true, maxAgeMs = 10000 } = {}) {
  const cached = liveCache.get(matchId);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.match;
  let raw;
  if (config.ibis.mock) {
    raw = mock.match(matchId, getTeamSettings().teamId);
    if (!raw) {
      const err = new Error('Matchen finns inte');
      err.status = 404;
      throw err;
    }
  } else {
    try {
      raw = await request(`${ROOT}/matches/${matchId}`, { auth: live });
    } catch (err) {
      // If the token flow is down, public data is still better than nothing.
      if (!live || err.status === 404) throw err;
      raw = await request(`${ROOT}/matches/${matchId}`);
    }
  }
  const match = normalizeMatch(raw);
  liveCache.set(matchId, { at: Date.now(), match });
  const inSchedule = schedule.matches.find((m) => m.id === matchId);
  if (inSchedule) Object.assign(inSchedule, pickScore(match));
  return match;
}

module.exports = { getSchedule, getMatch, normalizeMatch, request, collect, ROOT, STATUS_TEXT };

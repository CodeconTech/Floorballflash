'use strict';

/**
 * Fake IBIS data for local development (IBIS_MOCK=1). Produces raw objects in the same
 * shape as api.innebandy.se, including one match that is "live" and progresses over time
 * (one game minute every six seconds).
 */

const OPPONENTS = ['IBK Dalen', 'Pixbo Wallenstam', 'Storvreta IBK', 'FC Helsingborg', 'Växjö IBK', 'Mullsjö AIS', 'Linköping IBK', 'Visby IBK', 'Team Thorengruppen', 'IK Sirius'];
const OWN = 'Floorballflash IBK';
const bootTime = Date.now();
const LIVE_START = bootTime - 20 * 6000; // game minute 20 at boot
const DAY = 86400000;

const LIVE_EVENTS = [
  [3, 'home', 'Mål', 'Erik Lund', 14, 'Oscar Berg', 9],
  [8, 'away', 'Mål', 'Johan Ek', 22, '', null],
  [12, 'home', 'Utvisning', 'Leo Nyberg', 5, '', null, 'Slag'],
  [17, 'home', 'Mål', 'Oscar Berg', 9, 'Erik Lund', 14],
  [24, 'away', 'Mål', 'Johan Ek', 22, 'Max Ström', 11],
  [29, 'home', 'Mål', 'Hugo Sund', 18, '', null],
  [33, 'home', 'Mål', 'Erik Lund', 14, 'Hugo Sund', 18],
  [41, 'away', 'Utvisning', 'Max Ström', 11, '', null, 'Hakning'],
  [46, 'away', 'Mål', 'Ali Karim', 7, 'Johan Ek', 22],
  [52, 'home', 'Mål', 'Oscar Berg', 9, '', null],
  [58, 'away', 'Mål', 'Max Ström', 11, 'Ali Karim', 7],
];

function base(id, teamId, i, date, status) {
  const homeIsUs = i % 2 === 0;
  const opp = OPPONENTS[i % OPPONENTS.length];
  return {
    MatchID: id,
    MatchNo: `44${String(i + 1).padStart(3, '0')}`,
    SeasonID: 44,
    CompetitionID: 4001,
    CompetitionName: 'Herrar Division 1 (demo)',
    Round: i + 1,
    RoundName: `Omgång ${i + 1}`,
    MatchDateTime: new Date(date - new Date(date).getTimezoneOffset() * 60000).toISOString().slice(0, 19),
    HomeTeam: homeIsUs ? OWN : opp,
    AwayTeam: homeIsUs ? opp : OWN,
    HomeTeamID: homeIsUs ? teamId : 900000 + i,
    AwayTeamID: homeIsUs ? 900000 + i : teamId,
    HomeMatchTeamID: id * 10 + 1,
    AwayMatchTeamID: id * 10 + 2,
    Venue: homeIsUs ? 'Hemmahallen' : `${opp.split(' ')[0]} Arena`,
    MatchStatus: status,
    Spectators: status === 4 ? 150 + i * 23 : null,
    Events: [],
    IntermediateResults: [],
  };
}

function eventsUntil(m, minute) {
  let gh = 0;
  let ga = 0;
  const events = [];
  for (const [min, side, type, player, no, assist, assistNo, penalty] of LIVE_EVENTS) {
    if (min > minute) break;
    if (type === 'Mål') side === 'home' ? gh++ : ga++;
    events.push({
      MatchEventID: m.MatchID * 100 + events.length,
      MatchEventType: type,
      Period: Math.min(3, Math.floor((min - 1) / 20) + 1),
      PeriodName: `Period ${Math.min(3, Math.floor((min - 1) / 20) + 1)}`,
      Minute: min,
      Second: (min * 17) % 60,
      PlayerName: player,
      PlayerShirtNo: no,
      PlayerAssistName: assist,
      PlayerAssistShirtNo: assistNo,
      PenaltyName: penalty || '',
      MatchTeamID: side === 'home' ? m.HomeMatchTeamID : m.AwayMatchTeamID,
      GoalsHomeTeam: gh,
      GoalsAwayTeam: ga,
    });
  }
  const periods = [];
  for (let p = 1; p <= 3; p++) {
    if (minute <= (p - 1) * 20) break;
    const upTo = events.filter((e) => e.MatchEventType === 'Mål' && e.Period === p);
    periods.push({
      Period: p,
      GoalsHomeTeam: upTo.filter((e) => e.MatchTeamID === m.HomeMatchTeamID).length,
      GoalsAwayTeam: upTo.filter((e) => e.MatchTeamID === m.AwayMatchTeamID).length,
    });
  }
  return { events, gh, ga, periods };
}

function build(teamId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const list = [];
  for (let i = 0; i < 10; i++) {
    const id = 7000100 + i;
    const offsetDays = (i - 5) * 7;
    if (offsetDays === 0) {
      const m = base(id, teamId, i, LIVE_START, 2);
      const gameMinute = Math.floor((Date.now() - LIVE_START) / 6000);
      const { events, gh, ga, periods } = eventsUntil(m, Math.min(gameMinute, 60));
      const inBreak = gameMinute > 20 && gameMinute <= 22 || gameMinute > 42 && gameMinute <= 44;
      m.MatchStatus = gameMinute >= 64 ? 4 : inBreak ? 3 : 2;
      Object.assign(m, { Events: events, GoalsHomeTeam: gh, GoalsAwayTeam: ga, IntermediateResults: periods });
      list.push(m);
      continue;
    }
    const date = today.getTime() + offsetDays * DAY + (18 * 60 + 30) * 60000;
    const m = base(id, teamId, i, date, offsetDays < 0 ? 4 : 1);
    if (offsetDays < 0) {
      const { events, gh, ga, periods } = eventsUntil(m, 60 - i * 4);
      Object.assign(m, { Events: events, GoalsHomeTeam: gh, GoalsAwayTeam: ga, IntermediateResults: periods });
    }
    list.push(m);
  }
  return list;
}

module.exports = {
  schedule: (teamId) => build(teamId).map(({ Events, ...m }) => m),
  match: (id, teamId) => build(teamId).find((m) => m.MatchID === id) || null,
};

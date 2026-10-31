'use strict';

/**
 * Diagnostics for the IBIS API: shows which endpoints answer for the configured team.
 * Run on the server: docker compose exec app node src/ibis-check.js [teamId] [seasonId]
 */

const config = require('./config');
const { getTeamSettings } = require('./db');
const { request, collect, ROOT } = require('./ibis');

function describe(data) {
  if (Array.isArray(data)) {
    const first = data[0] && typeof data[0] === 'object' ? ` – fält: ${Object.keys(data[0]).slice(0, 15).join(', ')}` : '';
    return `lista med ${data.length} poster${first}`;
  }
  if (data && typeof data === 'object') return `objekt – fält: ${Object.keys(data).slice(0, 25).join(', ')}`;
  return JSON.stringify(data);
}

async function probe(label, path, opts) {
  try {
    const data = await request(path, opts);
    console.log(`OK   ${label}\n     ${path}\n     ${describe(data)}`);
    return data;
  } catch (err) {
    console.log(`FEL  ${label}\n     ${path}\n     ${err.message}`);
    return null;
  }
}

async function main() {
  const s = getTeamSettings();
  const teamId = parseInt(process.argv[2], 10) || s.teamId;
  const seasonId = parseInt(process.argv[3], 10) || s.seasonId;
  console.log(`IBIS: ${config.ibis.baseUrl}  lag ${teamId}  säsong ${seasonId}\n`);

  await probe('Säsonger', `${ROOT}/seasons`);
  const teamA = await probe('Laget (säsong)', `${ROOT}/seasons/${seasonId}/teams/${teamId}`);
  const teamB = await probe('Laget', `${ROOT}/teams/${teamId}`);
  await probe('Lagets matcher (säsong)', `${ROOT}/seasons/${seasonId}/teams/${teamId}/matches`);
  await probe('Lagets matcher', `${ROOT}/teams/${teamId}/matches`);

  const competitions = [...new Set([...collect(teamA, 'competitionid'), ...collect(teamB, 'competitionid'), ...s.competitionIds])];
  console.log(`\nSerie-ID:n (hittade + inställda): ${competitions.join(', ') || 'inga'}`);
  for (const cid of competitions) {
    const list = await probe(`Seriens matcher ${cid}`, `${ROOT}/competitions/${cid}/matches`);
    if (Array.isArray(list)) {
      const own = list.filter((m) => [m.HomeTeamID, m.AwayTeamID, m.HomeMatchTeamID, m.AwayMatchTeamID].includes(teamId));
      console.log(`     ${own.length} av ${list.length} matcher gäller lag ${teamId}`);
      if (!own.length && list.length) {
        const teams = new Map();
        for (const m of list) {
          teams.set(m.HomeTeamID, m.HomeTeam);
          teams.set(m.AwayTeamID, m.AwayTeam);
        }
        console.log(`     Lag i serien: ${[...teams].map(([id, name]) => `${name} (${id})`).join(', ')}`);
      }
    }
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});

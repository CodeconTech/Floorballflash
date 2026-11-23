'use strict';

(() => {
  const { api, el } = FF;
  const $ = (id) => document.getElementById(id);
  let teamId = null;
  let matches = [];
  let clipCounts = {};

  // Seasons run from August to July, e.g. 2025/26.
  function seasonOf(m) {
    const d = m.dateTime ? new Date(m.dateTime) : null;
    if (!d || Number.isNaN(d.getTime())) return 'Okänd säsong';
    const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return `${start}/${String(start + 1).slice(2)}`;
  }

  const isOurs = (t) => Boolean(teamId) && (t.id === teamId || t.matchTeamId === teamId);

  /** Goals for/against and W/D/L from the team's point of view, or null if unknown. */
  function outcome(m) {
    if (m.goalsHome == null || m.goalsAway == null) return null;
    const home = isOurs(m.home);
    if (!home && !isOurs(m.away)) return null;
    const gf = home ? m.goalsHome : m.goalsAway;
    const ga = home ? m.goalsAway : m.goalsHome;
    return { gf, ga, result: gf > ga ? 'V' : gf < ga ? 'F' : 'O' };
  }

  function fillSelect(select, values, allLabel) {
    const current = select.value;
    select.replaceChildren(el('option', { value: '' }, allLabel), ...values.map((v) => el('option', { value: v }, v)));
    if (values.includes(current)) select.value = current;
  }

  function tile(label, value, cls) {
    return el('div', { class: `tile${cls ? ` ${cls}` : ''}` }, el('div', { class: 'tile-value', text: String(value) }), el('div', { class: 'tile-label', text: label }));
  }

  function row(m) {
    const o = outcome(m);
    const score = m.goalsHome != null && m.goalsAway != null ? `${m.goalsHome}–${m.goalsAway}` : '–';
    const periods = m.periods && m.periods.length ? m.periods.map((p) => `${p.home}–${p.away}`).join(', ') : '';
    const clips = clipCounts[m.id];
    return el('a', { class: 'match-row result-row', href: `/match.html?id=${m.id}` },
      el('div', { class: 'when' }, el('strong', { text: FF.fmtDate(m.dateTime) }), m.competition || ''),
      el('div', { class: `team home${isOurs(m.home) ? ' us' : ''}` }, FF.teamLogo(m.home, 28), el('span', { text: m.home.name })),
      el('div', { class: 'score' }, score, periods ? el('div', { class: 'periods-small', text: `(${periods})` }) : ''),
      el('div', { class: `team away${isOurs(m.away) ? ' us' : ''}` }, FF.teamLogo(m.away, 28), el('span', { text: m.away.name })),
      el('div', { class: 'meta' },
        o ? el('span', { class: `res res-${o.result}`, title: { V: 'Vinst', O: 'Oavgjort', F: 'Förlust' }[o.result], text: o.result }) : '',
        clips ? el('span', { class: 'badge clips', text: `🎬 ${clips}` }) : ''),
    );
  }

  function render() {
    const season = $('season').value;
    const competition = $('competition').value;
    const list = matches.filter((m) => (!season || seasonOf(m) === season) && (!competition || m.competition === competition));

    const outcomes = list.map(outcome).filter(Boolean);
    const count = (r) => outcomes.filter((o) => o.result === r).length;
    const gf = outcomes.reduce((s, o) => s + o.gf, 0);
    const ga = outcomes.reduce((s, o) => s + o.ga, 0);
    const form = outcomes.slice(0, 5); // list is newest first
    $('summary').replaceChildren(
      tile('Matcher', outcomes.length),
      tile('Vinster', count('V'), 'w'),
      tile('Oavgjorda', count('O'), 'd'),
      tile('Förluster', count('F'), 'l'),
      tile('Mål', `${gf}–${ga}`),
      tile('Målskillnad', gf - ga > 0 ? `+${gf - ga}` : gf - ga),
      form.length
        ? el('div', { class: 'tile' },
            el('div', { class: 'tile-value form' }, form.map((o) => el('span', { class: `res res-${o.result}`, text: o.result }))),
            el('div', { class: 'tile-label', text: 'Form (senaste först)' }))
        : '',
    );

    $('results').replaceChildren(
      ...(list.length
        ? list.map(row)
        : [el('div', { class: 'empty', text: matches.length ? 'Inga matcher matchar filtret.' : 'Inga spelade matcher ännu.' })]),
    );
  }

  async function load() {
    try {
      const [results, counts] = await Promise.all([api('/api/results'), api('/api/videos/counts')]);
      teamId = results.teamId;
      matches = results.matches;
      clipCounts = counts.counts;
      const seasons = [...new Set(matches.map(seasonOf))];
      fillSelect($('season'), seasons, 'Alla säsonger');
      // Default to the latest season.
      if (!$('season').dataset.touched && seasons.length) $('season').value = seasons[0];
      fillSelect($('competition'), [...new Set(matches.map((m) => m.competition).filter(Boolean))].sort(), 'Alla serier');
      render();
    } catch (err) {
      $('results').replaceChildren(el('div', { class: 'empty', text: `Kunde inte hämta resultaten (${err.message}).` }));
    }
  }

  for (const id of ['season', 'competition']) {
    $(id).addEventListener('change', () => {
      $(id).dataset.touched = '1';
      render();
    });
  }

  FF.renderTopbar();
  load();
})();

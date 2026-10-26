'use strict';

(() => {
  const { api, el } = FF;
  let data = null;
  let clipCounts = {};

  function row(m) {
    const ours = (t) => data.teamId && (t.id === data.teamId || t.matchTeamId === data.teamId);
    const score = FF.scoreText(m);
    const clips = clipCounts[m.id];
    return el('a', { class: `match-row${m.live ? ' is-live' : ''}`, href: `/match.html?id=${m.id}`, 'data-id': m.id },
      el('div', { class: 'when' }, el('strong', { text: FF.fmtDate(m.dateTime) }), FF.fmtTime(m.dateTime)),
      el('div', { class: `team home${ours(m.home) ? ' us' : ''}` }, FF.teamLogo(m.home, 28), el('span', { text: m.home.name })),
      el('div', { class: `score${score ? '' : ' pending'}`, text: score || '–' }),
      el('div', { class: `team away${ours(m.away) ? ' us' : ''}` }, FF.teamLogo(m.away, 28), el('span', { text: m.away.name })),
      el('div', { class: 'meta' },
        FF.statusBadge(m),
        m.hasStream && !m.finished ? el('span', { class: 'badge stream', text: '📹 Video' }) : null,
        clips ? el('span', { class: 'badge clips', text: `🎬 ${clips}` }) : null),
    );
  }

  function render() {
    const upcoming = data.matches.filter((m) => !m.finished && !m.live);
    const live = data.matches.filter((m) => m.live);
    const played = data.matches.filter((m) => m.finished).reverse();

    const liveBox = document.getElementById('live-now');
    liveBox.replaceChildren(
      live.length ? el('div', { class: 'section-head' }, el('h2', {}, el('span', { class: 'badge live', text: 'Live' }), ' Pågår nu')) : '',
      live.length ? el('div', { class: 'matches' }, live.map(row)) : '',
    );

    const fill = (id, list, emptyText) =>
      document.getElementById(id).replaceChildren(...(list.length ? list.map(row) : [el('div', { class: 'empty', text: emptyText })]));
    fill('upcoming', upcoming, data.error ? `Kunde inte hämta spelprogrammet: ${data.error}` : 'Inga kommande matcher.');
    fill('played', played, 'Inga spelade matcher ännu.');
    document.getElementById('updated').textContent = data.updatedAt ? `Uppdaterad ${FF.fmtStamp(data.updatedAt)}` : '';
  }

  async function loadSchedule() {
    try {
      const [schedule, counts] = await Promise.all([api('/api/schedule'), api('/api/videos/counts')]);
      data = schedule;
      clipCounts = counts.counts;
      render();
    } catch (err) {
      document.getElementById('upcoming').replaceChildren(el('div', { class: 'empty', text: `Kunde inte hämta spelprogrammet (${err.message}).` }));
    }
  }

  async function loadVideos() {
    const box = document.getElementById('latest-videos');
    const { videos } = await api('/api/videos?limit=9');
    box.replaceChildren(
      ...(videos.length
        ? videos.map((v) => FF.videoCard(v, loadVideos, true))
        : [el('div', { class: 'empty', text: 'Inga klipp uppladdade ännu. Logga in och ladda upp från en matchsida!' })]),
    );
  }

  function connectLive() {
    const es = new EventSource('/api/live');
    es.addEventListener('stream', onStream);
    es.addEventListener('score', (e) => {
      if (!data) return;
      const update = JSON.parse(e.data);
      const m = data.matches.find((x) => x.id === update.id);
      if (!m) return;
      const scoreChanged = m.goalsHome !== update.goalsHome || m.goalsAway !== update.goalsAway;
      Object.assign(m, update);
      render();
      if (scoreChanged) document.querySelectorAll(`[data-id="${m.id}"] .score`).forEach((n) => n.classList.add('flash'));
    });
  }

  function onStream(e) {
    if (!data) return;
    const { id, hasStream } = JSON.parse(e.data);
    const m = data.matches.find((x) => x.id === id);
    if (m) {
      m.hasStream = hasStream;
      render();
    }
  }

  FF.renderTopbar();
  loadSchedule();
  loadVideos().catch(() => {});
  connectLive();
  // Refresh the full schedule now and then (new fixtures, changed times).
  setInterval(loadSchedule, 5 * 60000);
})();

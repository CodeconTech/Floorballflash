'use strict';

(() => {
  const { api, el } = FF;
  const matchId = parseInt(new URLSearchParams(location.search).get('id'), 10);
  let match = null;

  function renderScoreboard(prev) {
    const m = match;
    document.title = `${m.home.name} – ${m.away.name} · Floorballflash`;
    const score = FF.scoreText(m);
    const periods = m.periods.length ? `(${m.periods.map((p) => `${p.home}–${p.away}`).join(', ')})` : '';
    const changed = prev && (prev.goalsHome !== m.goalsHome || prev.goalsAway !== m.goalsAway);
    document.getElementById('scoreboard').replaceChildren(
      el('div', { class: 'comp', text: [m.competition, m.round].filter(Boolean).join(' · ') }),
      el('div', { class: 'sb-grid' },
        el('div', { class: 'sb-team' }, FF.teamLogo(m.home, 64), el('span', { text: m.home.name })),
        el('div', { class: `sb-score${changed ? ' flash' : ''}`, text: score || FF.fmtTime(m.dateTime) || '–' }),
        el('div', { class: 'sb-team' }, FF.teamLogo(m.away, 64), el('span', { text: m.away.name })),
      ),
      periods ? el('div', { class: 'periods', text: periods }) : '',
      el('div', { class: 'sb-status' },
        FF.statusBadge(m),
        el('span', { class: 'muted', text: FF.fmtLong(m.dateTime) }),
        m.venue ? el('span', { class: 'muted', text: m.venue }) : '',
        m.spectators ? el('span', { class: 'muted', text: `${m.spectators} åskådare` }) : ''),
      el('div', { class: 'links' },
        m.broadcastUrl ? el('a', { href: m.broadcastUrl, target: '_blank', rel: 'noopener' }, '📺 Sändning') : '',
        m.ticketUrl ? el('a', { href: m.ticketUrl, target: '_blank', rel: 'noopener' }, '🎟 Biljetter') : '',
        m.statsUrl ? el('a', { href: m.statsUrl, target: '_blank', rel: 'noopener' }, 'Matchen på stats.innebandy.se') : ''),
    );
  }

  function renderEvents() {
    const box = document.getElementById('events');
    if (!match.events.length) {
      box.replaceChildren(el('p', { class: 'muted', text: match.finished || match.live ? 'Inga händelser registrerade.' : 'Matchen har inte börjat.' }));
      return;
    }
    const list = el('ul', { class: 'events' });
    let lastPeriod = null;
    // Newest first while live, chronological afterwards.
    const events = match.live ? [...match.events].reverse() : match.events;
    for (const e of events) {
      if (e.period !== lastPeriod) {
        lastPeriod = e.period;
        list.append(el('li', { class: 'period-head', text: e.periodName || `Period ${e.period}` }));
      }
      const isGoal = /mål/i.test(e.type);
      const isPen = /utvisning|straff/i.test(e.type) || Boolean(e.penalty);
      const time = `${String(e.minute).padStart(2, '0')}:${String(e.second).padStart(2, '0')}`;
      const who = [e.playerNo != null ? `#${e.playerNo}` : '', e.player].filter(Boolean).join(' ');
      const what = isGoal && e.goalsHome != null ? `${e.goalsHome}–${e.goalsAway} ${who}` : `${e.type}${who ? `: ${who}` : ''}`;
      const sub = [e.team, e.assist ? `assist ${e.assist}` : '', e.penalty].filter(Boolean).join(' · ');
      list.append(
        el('li', { class: `${isGoal ? 'goal' : isPen ? 'pen' : ''}${e.side === 'away' ? ' away-ev' : ''}` },
          el('span', { class: 't', text: time }),
          el('div', {}, el('div', { class: 'what', text: what }), sub ? el('div', { class: 'sub', text: sub }) : '')),
      );
    }
    box.replaceChildren(list);
  }

  async function loadVideos() {
    const { videos } = await api(`/api/videos?match=${matchId}`);
    document.getElementById('videos').replaceChildren(
      ...(videos.length
        ? videos.map((v) => FF.videoCard(v, loadVideos))
        : [el('div', { class: 'empty', text: 'Inga klipp från den här matchen ännu.' })]),
    );
  }

  function renderUpload(user) {
    const area = document.getElementById('upload-area');
    if (!user) {
      area.replaceChildren(
        el('p', { class: 'muted', text: 'Alla kan titta på klippen. För att ladda upp behöver du ett godkänt konto.' }),
        el('div', { class: 'row' },
          el('a', { class: 'btn', href: `/login.html?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Logga in'),
          el('a', { class: 'btn secondary', href: '/login.html#registrera' }, 'Skapa konto')),
      );
      return;
    }
    const msg = el('div');
    const progress = el('progress', { max: 1, value: 0, class: 'hidden' });
    const submit = el('button', { class: 'btn', type: 'submit' }, 'Ladda upp');
    const form = el('form', {},
      el('div', { class: 'field' },
        el('label', { for: 'title' }, 'Titel'),
        el('input', { id: 'title', name: 'title', type: 'text', maxlength: 120, required: true, placeholder: 'T.ex. 2–1 av Erik, snyggt friläge' })),
      el('div', { class: 'field' },
        el('label', { for: 'video' }, 'Videofil'),
        el('input', { id: 'video', name: 'video', type: 'file', accept: 'video/mp4,video/quicktime,video/webm,video/ogg,.mp4,.mov,.m4v,.webm,.ogv', required: true }),
        el('div', { class: 'hint', text: 'MP4 (H.264) spelas upp i alla webbläsare. MOV från iPhone fungerar i de flesta.' })),
      progress, msg, submit,
    );
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      fd.append('matchId', String(matchId));
      submit.disabled = true;
      progress.classList.remove('hidden');
      FF.message(msg, '');
      try {
        await FF.upload('/api/videos', fd, (p) => { progress.value = p; });
        form.reset();
        FF.message(msg, 'Klippet är uppladdat!', 'ok');
        loadVideos();
      } catch (err) {
        FF.message(msg, err.message);
      } finally {
        submit.disabled = false;
        progress.classList.add('hidden');
        progress.value = 0;
      }
    });
    area.replaceChildren(form);
  }

  function connectLive() {
    const es = new EventSource(`/api/live?match=${matchId}`);
    es.addEventListener('match', (e) => {
      const prev = match;
      match = JSON.parse(e.data);
      renderScoreboard(prev);
      renderEvents();
    });
  }

  async function init() {
    if (!(matchId > 0)) {
      document.getElementById('scoreboard').replaceChildren(el('p', { text: 'Ingen match vald.' }));
      return;
    }
    FF.renderTopbar().then(renderUpload);
    loadVideos().catch(() => {});
    try {
      match = (await api(`/api/matches/${matchId}`)).match;
      renderScoreboard();
      renderEvents();
    } catch (err) {
      document.getElementById('scoreboard').replaceChildren(el('p', { text: err.message }));
      document.getElementById('events').replaceChildren();
    }
    connectLive();
  }

  init();
})();

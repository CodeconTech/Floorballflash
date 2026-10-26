'use strict';

(() => {
  const { api, el } = FF;
  const $ = (id) => document.getElementById(id);
  const STATUS = { pending: 'Väntar', approved: 'Godkänd', denied: 'Nekad', blocked: 'Spärrad' };

  // ---- login / password ----------------------------------------------------------

  function strength(pw) {
    let score = Math.min(pw.length, 24) / 24;
    const classes = [/[a-zåäö]/, /[A-ZÅÄÖ]/, /\d/, /[^A-Za-zÅÄÖåäö0-9]/].filter((re) => re.test(pw)).length;
    score = score * 0.6 + (classes / 4) * 0.4;
    return Math.round(score * 100);
  }

  function suggestPassword() {
    const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!#%&*+-=?@_'];
    const all = sets.join('');
    const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const chars = sets.map((s) => s[rnd(s.length)]);
    while (chars.length < 20) chars.push(all[rnd(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  let checkTimer = null;
  function onPasswordInput() {
    const pw = $('pw1').value;
    const s = strength(pw);
    const bar = $('strength-bar');
    bar.style.width = `${s}%`;
    bar.style.background = s >= 75 ? 'var(--ok)' : s >= 50 ? 'var(--warn)' : 'var(--danger)';
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const { problems } = await api('/api/admin/password-check', { method: 'POST', body: { password: pw } });
      $('pw-hint').textContent = problems.length ? `Saknas: ${problems.join(', ')}.` : '✓ Lösenordet uppfyller kraven.';
    }, 250);
  }

  async function requestLink(target) {
    try {
      const res = await api('/api/admin/request-password-link', { method: 'POST' });
      FF.message(target, res.message, 'ok');
    } catch (err) {
      FF.message(target, err.message);
    }
  }

  function setupAuthView(status) {
    $('auth-view').classList.remove('hidden');
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (token) {
      $('login-card').classList.add('hidden');
      $('setpw-card').classList.remove('hidden');
      $('pw1').addEventListener('input', onPasswordInput);
      $('suggest').addEventListener('click', () => {
        const pw = suggestPassword();
        $('pw1').type = 'text';
        $('pw1').value = pw;
        $('pw2').value = pw;
        onPasswordInput();
      });
      $('setpw-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if ($('pw1').value !== $('pw2').value) return FF.message($('setpw-msg'), 'Lösenorden matchar inte.');
        try {
          await api('/api/admin/set-password', { method: 'POST', body: { token, password: $('pw1').value } });
          history.replaceState(null, '', '/admin.html');
          location.reload();
        } catch (err) {
          FF.message($('setpw-msg'), err.message);
        }
      });
      return;
    }
    if (!status.hasPassword) {
      FF.message($('link-msg'), 'Inget adminlösenord är skapat ännu. Klicka på "Skapa / glömt lösenord" så skickas en länk till administratörens e-post.', 'info');
    }
    $('request-link').addEventListener('click', () => requestLink($('link-msg')));
    $('admin-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/login', { method: 'POST', body: { email: $('a-email').value, password: $('a-pass').value } });
        location.reload();
      } catch (err) {
        FF.message($('login-msg'), err.message);
      }
    });
  }

  // ---- admin panel ------------------------------------------------------------------

  async function act(fn, msgTarget) {
    try {
      await fn();
      await loadUsers();
    } catch (err) {
      FF.message(msgTarget || $('users-msg'), err.message);
    }
  }

  function userActions(u) {
    const setStatus = (status) => () => act(() => api(`/api/admin/users/${u.id}/status`, { method: 'POST', body: { status } }));
    const b = (label, cls, onclick) => el('button', { class: `btn small ${cls}`, onclick }, label);
    const list = [];
    if (u.status !== 'approved') list.push(b('Godkänn', 'ok', setStatus('approved')));
    if (u.status === 'pending') {
      list.push(b('Neka', 'danger', setStatus('denied')));
      list.push(b('Skicka mejl igen', 'secondary', () => act(() => api(`/api/admin/users/${u.id}/resend`, { method: 'POST' }))));
    }
    if (u.status === 'approved') {
      list.push(b('Spärra', 'danger', setStatus('blocked')));
      list.push(b('Ny pinkod', 'secondary', () => act(async () => {
        if (!confirm(`Skapa ny pinkod för ${u.email}? Den skickas till användaren.`)) return;
        const { pin } = await api(`/api/admin/users/${u.id}/reset-pin`, { method: 'POST' });
        FF.message($('users-msg'), `Ny pinkod för ${u.email}: ${pin} (skickad via e-post)`, 'ok');
      })));
    }
    list.push(b('Ta bort', 'secondary', () => act(async () => {
      if (!confirm(`Ta bort ${u.email}? Användarens klipp ligger kvar.`)) return;
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    })));
    return el('div', { class: 'row' }, list);
  }

  async function loadUsers() {
    const { users } = await api('/api/admin/users');
    const pending = users.filter((u) => u.status === 'pending').length;
    $('user-summary').textContent = `${users.length} användare${pending ? `, ${pending} väntar på godkännande` : ''}`;
    $('users').replaceChildren(
      ...(users.length
        ? users.map((u) =>
            el('tr', {},
              el('td', { text: u.email }),
              el('td', {}, el('span', { class: `status ${u.status}`, text: STATUS[u.status] }),
                u.locked_until && u.locked_until > Date.now() ? el('div', { class: 'hint', text: 'Tillfälligt låst' }) : ''),
              el('td', { text: FF.fmtStamp(u.created_at) }),
              el('td', { text: FF.fmtStamp(u.last_login_at) }),
              el('td', { text: String(u.videos) }),
              el('td', {}, userActions(u))))
        : [el('tr', {}, el('td', { colspan: 6, class: 'muted', text: 'Inga användare ännu.' }))]),
    );
  }

  async function loadSettings() {
    const { settings, mock } = await api('/api/admin/settings');
    const f = $('settings-form');
    f.teamId.value = settings.teamId;
    f.seasonId.value = settings.seasonId;
    f.competitionIds.value = settings.competitionIds.join(', ');
    f.extraMatchIds.value = settings.extraMatchIds.join(', ');
    f.teamMatchesPath.value = settings.teamMatchesPath;
    if (mock) FF.message($('settings-msg'), 'Servern kör med demodata (IBIS_MOCK=1).', 'info');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          body: {
            teamId: f.teamId.value,
            seasonId: f.seasonId.value,
            competitionIds: f.competitionIds.value,
            extraMatchIds: f.extraMatchIds.value,
            teamMatchesPath: f.teamMatchesPath.value,
          },
        });
        FF.message(
          $('settings-msg'),
          res.matches
            ? `Sparat. ${res.matches} matcher hittades (källa: ${res.source || '–'}).`
            : `Sparat, men inga matcher hittades.${res.error ? ` Fel: ${res.error}` : ' Ange serie-ID:n.'}`,
          res.matches ? 'ok' : 'error',
        );
      } catch (err) {
        FF.message($('settings-msg'), err.message);
      }
    });
  }

  async function loadVideos() {
    const { videos } = await api('/api/admin/videos');
    $('videos').replaceChildren(
      ...(videos.length
        ? videos.map((v) =>
            el('tr', {},
              el('td', {}, el('a', { href: `/media/${v.filename}`, target: '_blank' }, v.title)),
              el('td', {}, el('a', { href: `/match.html?id=${v.match_id}` }, String(v.match_id))),
              el('td', { text: v.uploader }),
              el('td', { text: FF.fmtSize(v.size) }),
              el('td', { text: FF.fmtStamp(v.created_at) }),
              el('td', {}, el('button', {
                class: 'btn small danger',
                onclick: async () => {
                  if (!confirm(`Ta bort "${v.title}"?`)) return;
                  await api(`/api/admin/videos/${v.id}`, { method: 'DELETE' }).catch((err) => alert(err.message));
                  loadVideos();
                },
              }, 'Ta bort'))))
        : [el('tr', {}, el('td', { colspan: 6, class: 'muted', text: 'Inga klipp ännu.' }))]),
    );
  }

  async function loadMail() {
    const { mails, smtpConfigured } = await api('/api/admin/mail');
    $('smtp-info').textContent = smtpConfigured
      ? 'E-post skickas via SMTP. De senaste 50 utskicken visas här.'
      : 'SMTP är inte konfigurerat – e-post skickas inte på riktigt. Länkarna finns här nedan och i serverloggen.';
    $('mails').replaceChildren(
      ...(mails.length
        ? mails.map((m) =>
            el('details', { class: 'mail' },
              el('summary', {}, `${FF.fmtStamp(m.created_at)} · ${m.recipient} · ${m.subject} `, el('span', { class: 'muted', text: `(${m.status})` })),
              el('pre', { text: m.body + (m.error ? `\n\nFel: ${m.error}` : '') })))
        : [el('p', { class: 'muted', text: 'Inga mejl skickade.' })]),
    );
  }

  async function init() {
    await FF.renderTopbar();
    const status = await api('/api/admin/status');
    if (!status.loggedIn || location.hash.includes('token=')) return setupAuthView(status);
    $('admin-view').classList.remove('hidden');
    $('change-pw').addEventListener('click', () => requestLink($('change-msg')));
    await Promise.all([loadUsers(), loadSettings(), loadVideos(), loadMail()]);
  }

  init().catch((err) => alert(err.message));
})();

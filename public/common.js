'use strict';

const FF = (() => {
  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = { 'X-Requested-With': 'floorballflash' };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Fel ${res.status}`), { status: res.status, data });
    return data;
  }

  /** Multipart upload with progress (fetch has no upload progress). */
  function upload(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      xhr.setRequestHeader('X-Requested-With', 'floorballflash');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Fel ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Nätverksfel vid uppladdning.'));
      xhr.send(formData);
    });
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  const dateFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const longFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // IBIS times are Swedish local time without zone; parse them as local time.
  const parseDate = (s) => (s ? new Date(s) : null);
  const fmtDate = (s) => (s ? dateFmt.format(parseDate(s)) : '');
  const fmtTime = (s) => (s ? timeFmt.format(parseDate(s)) : '');
  const fmtLong = (s) => (s ? longFmt.format(parseDate(s)) : '');
  const fmtStamp = (ms) => (ms ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms)) : '–');
  const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

  function scoreText(m) {
    if (m.goalsHome === null || m.goalsHome === undefined || (!m.live && !m.finished)) return null;
    return `${m.goalsHome}–${m.goalsAway}`;
  }

  function statusBadge(m) {
    if (m.live) return el('span', { class: 'badge live', text: m.status === 3 ? 'Paus' : 'Live' });
    if (m.finished) return el('span', { class: 'badge final', text: 'Slut' });
    return el('span', { class: 'badge', text: m.statusText || '' });
  }

  function teamLogo(t, size) {
    return t.logo ? el('img', { src: t.logo, alt: '', width: size, height: size, loading: 'lazy', referrerpolicy: 'no-referrer' }) : null;
  }

  let me = null;
  async function loadMe() {
    try { me = (await api('/api/me')).user; } catch { me = null; }
    return me;
  }

  async function renderTopbar() {
    const nav = document.getElementById('nav');
    if (!nav) return null;
    await loadMe();
    nav.replaceChildren(
      el('a', { href: '/' }, 'Spelprogram'),
      el('a', { href: '/#klipp' }, 'Klipp'),
      me
        ? el('span', { class: 'row' },
            el('span', { class: 'who', text: me.email }),
            me.kind === 'admin' ? el('a', { href: '/admin.html' }, 'Admin') : null,
            el('button', { class: 'btn small secondary', onclick: logout }, 'Logga ut'))
        : el('a', { href: `/login.html?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Logga in'),
    );
    return me;
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  }

  function message(target, text, kind = 'error') {
    target.replaceChildren(text ? el('div', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status', text }) : '');
  }

  function videoCard(v, onDeleted, matchLink) {
    const del = v.canDelete
      ? el('button', {
          class: 'btn small secondary',
          title: 'Ta bort klippet',
          onclick: async () => {
            if (!confirm(`Ta bort "${v.title}"?`)) return;
            try {
              await api(`/api/videos/${v.id}`, { method: 'DELETE' });
              onDeleted && onDeleted(v);
            } catch (err) { alert(err.message); }
          },
        }, 'Ta bort')
      : null;
    return el('article', { class: 'video' },
      el('video', { src: v.url, controls: true, preload: 'metadata', playsinline: true }),
      el('div', { class: 'info' },
        el('div', {},
          el('div', { class: 'title', text: v.title }),
          el('div', { class: 'by' },
            `${v.uploader} · ${fmtStamp(v.createdAt)}`,
            matchLink ? ' · ' : '',
            matchLink ? el('a', { href: `/match.html?id=${v.matchId}` }, 'Till matchen') : ''),
        ),
        del),
    );
  }

  return { api, upload, el, fmtDate, fmtTime, fmtLong, fmtStamp, fmtSize, scoreText, statusBadge, teamLogo, renderTopbar, message, videoCard, get me() { return me; } };
})();

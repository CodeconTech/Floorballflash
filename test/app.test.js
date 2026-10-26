'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-test-'));
process.env.DATA_DIR = dataDir;
process.env.IBIS_MOCK = '1';

const app = require('../src/server');
const { db } = require('../src/db');

let base;
let server;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function call(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  return fetch(base + pathname, {
    method,
    headers: {
      'X-Requested-With': 'floorballflash',
      ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
}

const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
const lastMailBody = (to) => db.prepare('SELECT body FROM mail_log WHERE recipient = ? ORDER BY id DESC LIMIT 1').get(to).body;

test('schedule and match come from the IBIS client', async () => {
  const { matches } = await (await call('/api/schedule')).json();
  assert.ok(matches.length > 0);
  const live = matches.find((m) => m.live);
  assert.ok(live, 'mock has a live match');
  const { match } = await (await call(`/api/matches/${live.id}`)).json();
  assert.ok(Array.isArray(match.events));
});

test('register, approve by mail link, log in and upload a clip everyone can see', async () => {
  let res = await call('/api/auth/register', { method: 'POST', body: { email: 'Spelare@Exempel.se', pin: 'kort' } });
  assert.equal(res.status, 400);

  res = await call('/api/auth/register', { method: 'POST', body: { email: 'Spelare@Exempel.se', pin: 'Ab12Cd34' } });
  assert.equal(res.status, 201);

  res = await call('/api/auth/login', { method: 'POST', body: { email: 'spelare@exempel.se', pin: 'Ab12Cd34' } });
  assert.equal(res.status, 403, 'pending users cannot log in');

  const link = lastMailBody('andreas.wallin@gmail.com').match(/\/godkann\/[\w-]+/)[0];
  res = await fetch(base + link);
  assert.match(await res.text(), /spelare@exempel\.se/);
  assert.equal(db.prepare("SELECT status FROM users WHERE email = 'spelare@exempel.se'").get().status, 'pending', 'GET does not decide');

  res = await fetch(base + link, { method: 'POST', body: new URLSearchParams({ action: 'approve' }) });
  assert.match(await res.text(), /godkänd/);
  res = await fetch(base + link, { method: 'POST', body: new URLSearchParams({ action: 'deny' }) });
  assert.equal(res.status, 410, 'link is single use');

  res = await call('/api/auth/login', { method: 'POST', body: { email: 'spelare@exempel.se', pin: 'Ab12Cd34' } });
  assert.equal(res.status, 200);
  const cookie = cookieOf(res);

  const fd = new FormData();
  fd.append('title', 'Mål i första');
  fd.append('matchId', '7000105');
  fd.append('video', new Blob([Buffer.alloc(1024)], { type: 'video/mp4' }), 'klipp.mp4');
  res = await call('/api/videos', { method: 'POST', body: fd, cookie });
  assert.equal(res.status, 201);
  const { video } = await res.json();

  const anon = await (await call('/api/videos?match=7000105')).json();
  assert.equal(anon.videos.length, 1);
  assert.equal(anon.videos[0].canDelete, false);
  res = await fetch(base + video.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
});

test('uploads require login and a video file', async () => {
  const fd = new FormData();
  fd.append('title', 'x');
  fd.append('matchId', '1');
  fd.append('video', new Blob(['hej'], { type: 'text/html' }), 'x.html');
  assert.equal((await call('/api/videos', { method: 'POST', body: fd })).status, 401);
});

test('state-changing API calls need the CSRF header', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.se', pin: '12345678' }),
  });
  assert.equal(res.status, 403);
});

test('wrong PIN locks the account after five attempts', async () => {
  await call('/api/auth/register', { method: 'POST', body: { email: 'las@exempel.se', pin: '11112222' } });
  db.prepare("UPDATE users SET status = 'approved' WHERE email = 'las@exempel.se'").run();
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'las@exempel.se', pin: '99999999' } })).status, 401);
  }
  const res = await call('/api/auth/login', { method: 'POST', body: { email: 'las@exempel.se', pin: '11112222' } });
  assert.equal(res.status, 429);
});

test('admin password is created via mailed link and must be strong', async () => {
  assert.equal((await call('/api/admin/users')).status, 401);
  let res = await call('/api/admin/request-password-link', { method: 'POST' });
  assert.equal(res.status, 200);
  const token = lastMailBody('andreas.wallin@gmail.com').match(/#token=([\w-]+)/)[1];

  res = await call('/api/admin/set-password', { method: 'POST', body: { token, password: 'lösenord123' } });
  assert.equal(res.status, 400);
  res = await call('/api/admin/set-password', { method: 'POST', body: { token, password: 'Blå-Klubba#2026!' } });
  assert.equal(res.status, 200);

  res = await call('/api/admin/login', { method: 'POST', body: { email: 'andreas.wallin@gmail.com', password: 'fel' } });
  assert.equal(res.status, 401);
  res = await call('/api/admin/login', { method: 'POST', body: { email: 'andreas.wallin@gmail.com', password: 'Blå-Klubba#2026!' } });
  assert.equal(res.status, 200);
  const cookie = cookieOf(res);

  const { users } = await (await call('/api/admin/users', { cookie })).json();
  const user = users.find((u) => u.email === 'spelare@exempel.se');
  res = await call(`/api/admin/users/${user.id}/status`, { method: 'POST', body: { status: 'blocked' }, cookie });
  assert.equal(res.status, 200);
  res = await call('/api/auth/login', { method: 'POST', body: { email: 'spelare@exempel.se', pin: 'Ab12Cd34' } });
  assert.equal(res.status, 403);
});

test('VDO.Ninja links are reduced to a view link', () => {
  const { parseLink } = require('../src/streams');
  assert.deepEqual(parseLink('https://vdo.ninja/?view=abc_123'), { streamId: 'abc_123', password: null });
  assert.deepEqual(parseLink('https://vdo.ninja/alpha/?push=Cam1&password=hemlig'), { streamId: 'Cam1', password: 'hemlig' });
  assert.throws(() => parseLink('http://vdo.ninja/?view=abc'));
  assert.throws(() => parseLink('https://evil.example/?view=abc'));
  assert.throws(() => parseLink('https://vdo.ninja/?view=<script>'));
  assert.throws(() => parseLink('https://vdo.ninja/'));
});

test('approved users attach a live stream that everyone sees', async () => {
  const pin = 'Str34mPn';
  await call('/api/auth/register', { method: 'POST', body: { email: 'kamera@exempel.se', pin } });
  await call('/api/auth/register', { method: 'POST', body: { email: 'annan@exempel.se', pin } });
  db.prepare("UPDATE users SET status = 'approved' WHERE email IN ('kamera@exempel.se', 'annan@exempel.se')").run();
  const login = async (email) => cookieOf(await call('/api/auth/login', { method: 'POST', body: { email, pin } }));
  const cookie = await login('kamera@exempel.se');
  const other = await login('annan@exempel.se');

  let res = await call('/api/matches/7000106/stream', { method: 'PUT', body: { url: 'https://vdo.ninja/?view=x' } });
  assert.equal(res.status, 401);

  res = await call('/api/matches/7000106/stream', { method: 'PUT', body: { url: 'https://vdo.ninja/?push=matchcam' }, cookie });
  assert.equal(res.status, 200);
  const { stream } = await res.json();
  assert.equal(stream.embedUrl, 'https://vdo.ninja/?view=matchcam');
  assert.equal(stream.pushUrl, 'https://vdo.ninja/?push=matchcam');

  const anon = (await (await call('/api/matches/7000106/stream')).json()).stream;
  assert.equal(anon.embedUrl, 'https://vdo.ninja/?view=matchcam');
  assert.equal(anon.pushUrl, undefined, 'push link is not public');

  const { matches } = await (await call('/api/schedule')).json();
  assert.equal(matches.find((m) => m.id === 7000106).hasStream, true);

  res = await call('/api/matches/7000106/stream', { method: 'PUT', body: { generate: true }, cookie: other });
  assert.equal(res.status, 403, 'others cannot replace it');
  res = await call('/api/matches/7000106/stream', { method: 'DELETE', cookie: other });
  assert.equal(res.status, 403);

  res = await call('/api/matches/7000106/stream', { method: 'DELETE', cookie });
  assert.equal(res.status, 200);
  assert.equal((await (await call('/api/matches/7000106/stream')).json()).stream, null);
});

'use strict';

const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const live = require('./live');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src https://vdo.ninja; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  });
  next();
});

app.use(express.json({ limit: '20kb' }));
app.use(auth.loadSession);
app.use(auth.csrfGuard);

app.use(require('./routes/matches').router);
app.use(require('./routes/users').router);
app.use(require('./routes/admin').router);
app.use(require('./routes/videos').router);
app.use(require('./routes/streams').router);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Finns inte.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Något gick fel på servern.' : err.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Floorballflash kör på ${config.publicUrl} (port ${config.port})${config.ibis.mock ? ' – demodata (IBIS_MOCK=1)' : ''}`);
    console.log(`Administratör: ${config.adminEmail}`);
  });
  live.start();
}

module.exports = app;

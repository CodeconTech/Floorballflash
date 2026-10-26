'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { db } = require('../db');
const auth = require('../auth');

const router = express.Router();

const TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (TYPES[ext] && /^video\//.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Endast videofiler (mp4, mov, m4v, webm, ogv) är tillåtna.'), { status: 400 }));
  },
});

function publicVideo(v, user) {
  return {
    id: v.id,
    matchId: v.match_id,
    title: v.title,
    uploader: v.uploader.replace(/@.*/, ''),
    size: v.size,
    createdAt: v.created_at,
    url: `/media/${v.filename}`,
    mime: v.mime,
    canDelete: Boolean(user && (user.kind === 'admin' || user.id === v.user_id)),
  };
}

router.get('/api/videos', (req, res) => {
  const matchId = req.query.match ? parseInt(req.query.match, 10) : null;
  const rows = matchId
    ? db.prepare('SELECT * FROM videos WHERE match_id = ? ORDER BY created_at DESC').all(matchId)
    : db.prepare('SELECT * FROM videos ORDER BY created_at DESC LIMIT ?').all(Math.min(100, parseInt(req.query.limit, 10) || 12));
  res.json({ videos: rows.map((v) => publicVideo(v, req.user)) });
});

router.get('/api/videos/counts', (req, res) => {
  const rows = db.prepare('SELECT match_id, COUNT(*) AS n FROM videos GROUP BY match_id').all();
  res.json({ counts: Object.fromEntries(rows.map((r) => [r.match_id, r.n])) });
});

router.post('/api/videos', auth.requireUser, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (req.file) fs.rm(req.file.path, { force: true }, () => {});
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Filen är för stor (max ${config.maxUploadMb} MB).` : err.message;
      return res.status(err.status || 400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Välj en videofil.' });
    const matchId = parseInt(req.body.matchId, 10);
    const title = String(req.body.title || '').trim().slice(0, 120);
    if (!(matchId > 0) || !title) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res.status(400).json({ error: 'Ange match och titel.' });
    }
    const ext = path.extname(req.file.filename);
    const info = db
      .prepare(
        `INSERT INTO videos (user_id, uploader, match_id, title, filename, original_name, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(req.user.id, req.user.email, matchId, title, req.file.filename, req.file.originalname.slice(0, 200), TYPES[ext], req.file.size, Date.now());
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ video: publicVideo(v, req.user) });
  });
});

router.delete('/api/videos/:id', auth.requireUser, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Klippet finns inte.' });
  if (req.user.kind !== 'admin' && req.user.id !== v.user_id) return res.status(403).json({ error: 'Du kan bara ta bort dina egna klipp.' });
  db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
  fs.rm(path.join(config.uploadDir, v.filename), { force: true }, () => {});
  res.json({ ok: true });
});

// Videos are public. express.static handles Range requests so seeking works.
router.use(
  '/media',
  (req, res, next) => (/^\/[a-f0-9]{32}\.[a-z0-9]{2,4}$/.test(req.path) ? next() : res.status(404).end()),
  express.static(config.uploadDir, {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    immutable: true,
    setHeaders: (res, file) => {
      res.set('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.set('Content-Disposition', 'inline');
    },
  }),
);

module.exports = { router };

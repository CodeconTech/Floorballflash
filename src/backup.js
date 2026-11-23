'use strict';

/**
 * Takes a consistent copy of the database while the app is running (VACUUM INTO), into
 * <DATA_DIR>/backups, and keeps the newest copies. Uploaded clips are plain files that are
 * never changed after upload, so they don't need a snapshot.
 *
 * Run on the server: docker compose exec app npm run backup
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db } = require('./db');

const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 20);
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = path.join(dir, `floorballflash-${stamp}.db`);
db.prepare('VACUUM INTO ?').run(file);

const counts = db.prepare('SELECT (SELECT COUNT(*) FROM videos) AS videos, (SELECT COUNT(*) FROM users) AS users').get();
console.log(`Säkerhetskopia: ${file} (${counts.videos} klipp, ${counts.users} användare)`);

const old = fs.readdirSync(dir).filter((f) => /^floorballflash-\d{8}-\d{6}\.db$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(dir, f));

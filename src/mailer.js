'use strict';

const nodemailer = require('nodemailer');
const config = require('./config');
const { db } = require('./db');

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

if (!transport) {
  console.warn('[mail] SMTP_HOST saknas – e-post skrivs bara till loggen och tabellen mail_log.');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Sends a mail. `links` is an optional list of { label, url, color } rendered as buttons
 * in the HTML part and as plain URLs in the text part.
 */
async function sendMail({ to, subject, text, links = [] }) {
  const textBody = [text, ...links.map((l) => `${l.label}: ${l.url}`)].join('\n\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
    ${text.split('\n').map((line) => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`).join('')}
    <p style="margin:20px 0">${links
      .map(
        (l) => `<a href="${escapeHtml(l.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:6px;color:#fff;text-decoration:none;font-weight:600;background:${l.color || '#1d4ed8'}">${escapeHtml(l.label)}</a>`,
      )
      .join('')}</p>
  </div>`;

  let status = 'logged';
  let error = null;
  if (transport) {
    try {
      await transport.sendMail({ from: config.smtp.from, to, subject, text: textBody, html });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = String(err && err.message ? err.message : err);
      console.error('[mail] kunde inte skicka till %s: %s', to, error);
    }
  } else {
    console.log('[mail] Till: %s\n[mail] Ämne: %s\n%s\n', to, subject, textBody);
  }
  db.prepare(
    'INSERT INTO mail_log (recipient, subject, body, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(to, subject, textBody, status, error, Date.now());
  return status;
}

module.exports = { sendMail };

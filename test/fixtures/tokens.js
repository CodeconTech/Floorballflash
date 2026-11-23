'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Turns spelprogram.md (a schedule as copied from stats.innebandy.se, with links written as
 * [text](href)) into the tokens the admin page sends: with links like a rich-text paste, or
 * as plain-text lines.
 */
function tokensFromFixture({ links }) {
  const md = fs.readFileSync(path.join(__dirname, 'spelprogram.md'), 'utf8');
  const tokens = [];
  for (const line of md.split('\n')) {
    if (!links) {
      const text = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      if (text) tokens.push({ text });
      continue;
    }
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    let m;
    while ((m = re.exec(line))) {
      const before = line.slice(last, m.index).trim();
      if (before) tokens.push({ text: before });
      tokens.push({ text: m[1], href: m[2] });
      last = re.lastIndex;
    }
    const rest = line.slice(last).trim();
    if (rest) tokens.push({ text: rest });
  }
  return tokens;
}

module.exports = { tokensFromFixture };

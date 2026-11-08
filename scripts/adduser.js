// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Creates a user or resets the password: npm run adduser -- <username> "<Display Name>" [--admin]
// The first account always becomes admin.
import { createInterface } from 'node:readline/promises';
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const args = process.argv.slice(2);
const makeAdmin = args.includes('--admin');
const [username, ...nameParts] = args.filter((a) => a !== '--admin');
if (!username || !/^[a-z0-9._-]+$/i.test(username)) {
  console.error('Usage: npm run adduser -- <username> "<Display Name>" [--admin]');
  process.exit(1);
}
const name = nameParts.join(' ') || username;

/** Asks for the password without echoing what is typed. */
function askHidden(prompt) {
  if (!process.stdin.isTTY) {
    // Piped input: read the first line.
    const rl = createInterface({ input: process.stdin });
    return rl.question(prompt).finally(() => rl.close());
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve) => {
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

const password = process.env.GDK_PASSWORD || (await askHidden('Password (min. 10 characters, hidden): '));
if (password.length < 10) {
  console.error('Password too short.');
  process.exit(1);
}

const isFirst = !db.prepare('SELECT 1 FROM users').get();
db.prepare(`INSERT INTO users (username, name, pw_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET name = excluded.name, pw_hash = excluded.pw_hash,
    is_admin = MAX(is_admin, excluded.is_admin)`)
  .run(username.toLowerCase(), name, hashPassword(password), Date.now(), makeAdmin || isFirst ? 1 : 0);
console.log(`User "${username.toLowerCase()}" saved${makeAdmin || isFirst ? ' (admin)' : ''}.`);

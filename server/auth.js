// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Password hashing, sessions and a small login rate limit.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

export const SESSION_COOKIE = 'gdk_session';
const SESSION_DAYS = 30;

/** Hashes a password with scrypt and a random salt. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Checks a password against a stored scrypt hash in constant time. */
export function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Checked when the username does not exist, so the response time does not reveal valid usernames.
export const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** Creates a session for the user and returns its token. Also removes expired sessions. */
export function createSession(userId) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

/** Ends all sessions of a user, e.g. after a password reset. */
export function deleteUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export const MIN_PASSWORD_LENGTH = 10;
export const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Extracts the session token from a raw Cookie header. */
export function sessionToken(header) {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

/** Returns the user for a raw Cookie header, or null. */
export function userFromCookieHeader(header) {
  const token = sessionToken(header);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
  return row ? { id: row.id, username: row.username, name: row.name, isAdmin: row.is_admin === 1 } : null;
}

// At most 10 failed logins per IP within 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

export function isRateLimited(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) return false;
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(ip, { first: Date.now(), count: 1 });
  else entry.count += 1;
}

export function clearFailures(ip) {
  failures.delete(ip);
}

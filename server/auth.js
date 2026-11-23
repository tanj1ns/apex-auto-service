'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'apex_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 дней

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derivedBuf = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derivedBuf.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, keyBuf);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  });
  return cookies;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  return { token, expiresAt };
}

function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getSessionUser(db, req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.car, u.role, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(db, token);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    car: row.car || '',
    role: row.role,
    created_at: row.created_at,
    token
  };
}

function buildSessionCookie(token, clear = false) {
  if (clear) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionUser,
  buildSessionCookie
};

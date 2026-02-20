import jwt from 'jsonwebtoken';
import { getDB } from './db.js';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Signs a JWT. Pass `extra` for impersonation payloads:
 *   signToken(targetUserId, { impersonatedBy: adminUserId })
 */
export function signToken(userId, extra = {}) {
  return jwt.sign({ sub: userId, ...extra }, SECRET(), { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET());
}

export function setAuthCookie(res, token) {
  res.cookie('token', token, COOKIE_OPTIONS);
}

export function clearAuthCookie(res) {
  res.clearCookie('token', { path: '/' });
}

/**
 * requireAuth — verifies JWT then fetches the live user row from DB.
 *
 * Sets on req:
 *   req.userId          — UUID string
 *   req.userRole        — 'user' | 'admin'
 *   req.impersonatedBy  — admin UUID if this is an impersonated session, else undefined
 *
 * Rejects if:
 *   - No/invalid/expired token
 *   - User row not found
 *   - User is suspended
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated', code: 'NO_TOKEN' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'BAD_TOKEN' });
  }

  try {
    const sql = getDB();
    const rows = await sql`
      SELECT id, role, is_suspended
      FROM users
      WHERE id = ${payload.sub}
    `;

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const user = rows[0];

    if (user.is_suspended) {
      return res.status(401).json({ error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });
    }

    req.userId         = user.id;
    req.userRole       = user.role;
    req.impersonatedBy = payload.impersonatedBy ?? undefined;

    next();
  } catch (err) {
    console.error('requireAuth DB error:', err);
    return res.status(500).json({ error: 'Auth check failed', code: 'SERVER_ERROR' });
  }
}

/**
 * requireAdmin — must be used AFTER requireAuth in the middleware chain.
 *
 * Checks:
 *   1. req.userRole === 'admin'  (already fetched from DB by requireAuth)
 *   2. Not an impersonated session (impersonated tokens cannot reach admin endpoints)
 *
 * Usage:
 *   app.get('/api/admin/stats', requireAuth, requireAdmin, handler)
 */
export function requireAdmin(req, res, next) {
  if (req.impersonatedBy) {
    return res.status(403).json({
      error: 'Admin access not available in impersonated session',
      code: 'IMPERSONATED_SESSION',
    });
  }

  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
  }

  next();
}

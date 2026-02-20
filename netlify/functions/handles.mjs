import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import { getDB } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { validateHandle } from '../../lib/validate.js';
import { isReserved } from '../../lib/reserved-handles.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

// ── Simple in-memory rate limiter (20 req/min per IP) ────────────────────────
// Per-instance only — acceptable for a low-traffic public endpoint.
const rateLimitStore = new Map(); // ip -> { count, resetAt }

function allowRequest(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

// Clean up stale entries periodically so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 5 * 60_000);

// ── GET /api/handles/mine  (auth required) ────────────────────────────────────
// Used by onboarding.html on load to redirect away if user already has a profile.
app.get('/api/handles/mine', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const rows = await sql`SELECT slug FROM profiles WHERE owner_id = ${req.userId} LIMIT 1`;
    return res.json({ data: { slug: rows[0]?.slug ?? null } });
  } catch (err) {
    console.error('Handles mine error:', err);
    return res.status(500).json({ error: 'Check failed', code: 'SERVER_ERROR' });
  }
});

// ── GET /api/handles/check?handle=xxx  (public) ───────────────────────────────
app.get('/api/handles/check', async (req, res) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (!allowRequest(ip)) {
    return res
      .status(429)
      .json({ error: 'Too many requests', code: 'RATE_LIMITED' });
  }

  const handle = (req.query.handle || '').toLowerCase();

  // 1. Format validation
  const { valid } = validateHandle(handle);
  if (!valid) {
    return res.json({ data: { available: false, reason: 'invalid' } });
  }

  // 2. Reserved list
  if (isReserved(handle)) {
    return res.json({ data: { available: false, reason: 'reserved' } });
  }

  // 3. Database check
  try {
    const sql = getDB();
    const rows = await sql`SELECT id FROM profiles WHERE slug = ${handle}`;
    if (rows.length > 0) {
      return res.json({ data: { available: false, reason: 'taken' } });
    }
    return res.json({ data: { available: true } });
  } catch (err) {
    console.error('Handle check error:', err);
    return res
      .status(500)
      .json({ error: 'Check failed', code: 'SERVER_ERROR' });
  }
});

// ── POST /api/handles/claim  (auth required) ──────────────────────────────────
app.post('/api/handles/claim', requireAuth, async (req, res) => {
  const handle = (req.body.handle || '').toLowerCase().trim();

  // 1. Format validation
  const { valid } = validateHandle(handle);
  if (!valid) {
    return res
      .status(400)
      .json({ error: 'Invalid handle format', code: 'INVALID_HANDLE' });
  }

  // 2. Reserved list
  if (isReserved(handle)) {
    return res
      .status(400)
      .json({ error: 'Handle is reserved', code: 'HANDLE_RESERVED' });
  }

  const sql = getDB();

  try {
    // 3. One profile per user — reject if they already own one
    const existing = await sql`
      SELECT id FROM profiles WHERE owner_id = ${req.userId}
    `;
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ error: 'You already have a profile', code: 'PROFILE_EXISTS' });
    }

    // 4. Uniqueness check (race-safe: the UNIQUE constraint will also catch it)
    const taken = await sql`
      SELECT id FROM profiles WHERE slug = ${handle}
    `;
    if (taken.length > 0) {
      return res
        .status(409)
        .json({ error: 'Handle already taken', code: 'HANDLE_TAKEN' });
    }

    // 5. Create the profile row with sensible defaults.
    //    business_name seeds to the handle — the user fills it in via the editor.
    const rows = await sql`
      INSERT INTO profiles (slug, owner_id, business_name)
      VALUES (${handle}, ${req.userId}, ${handle})
      RETURNING id, slug
    `;

    const profile = rows[0];
    return res
      .status(201)
      .json({ data: { slug: profile.slug, profileId: profile.id } });
  } catch (err) {
    console.error('Handle claim error:', err);
    // Unique constraint violation — someone else claimed it in the same instant
    if (err.message?.includes('slug') || err.code === '23505') {
      return res
        .status(409)
        .json({ error: 'Handle already taken', code: 'HANDLE_TAKEN' });
    }
    return res
      .status(500)
      .json({ error: 'Claim failed', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

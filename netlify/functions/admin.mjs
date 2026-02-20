import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import { getDB } from '../../lib/db.js';
import { requireAuth, requireAdmin, signToken, setAuthCookie } from '../../lib/auth.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeAudit(sql, adminId, action, targetId, metadata = {}) {
  try {
    await sql`
      INSERT INTO audit_log (admin_id, action, target_id, metadata)
      VALUES (${adminId}, ${action}, ${targetId ?? null}, ${JSON.stringify(metadata)})
    `;
  } catch (err) {
    // Audit failures must not break the request — log and continue.
    console.error('Audit log write failed:', err);
  }
}

function parsePagination(query) {
  const page   = Math.max(1, parseInt(query.page  || '1',  10));
  const limit  = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/admin/stats
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sql = getDB();

    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM users)                                     AS total_users,
        (SELECT COUNT(*)::int FROM profiles)                                  AS total_profiles,
        (SELECT COUNT(*)::int FROM users    WHERE created_at >= CURRENT_DATE) AS new_users_today,
        (SELECT COUNT(*)::int FROM profiles WHERE created_at >= CURRENT_DATE) AS new_profiles_today
    `;

    const signups = await sql`
      SELECT DATE(created_at) AS day, COUNT(*)::int AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `;

    const recentProfiles = await sql`
      SELECT p.slug, p.created_at, u.email AS owner_email
      FROM profiles p
      JOIN users u ON u.id = p.owner_id
      ORDER BY p.created_at DESC
      LIMIT 10
    `;

    res.json({ data: { ...stats, signups, recentProfiles } });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats', code: 'SERVER_ERROR' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// USERS
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/admin/users?page=1&limit=20&search=email
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const sql = getDB();

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM users WHERE email ILIKE ${search}
    `;

    const users = await sql`
      SELECT u.id, u.email, u.role, u.is_suspended, u.created_at,
             COUNT(p.id)::int AS profile_count
      FROM users u
      LEFT JOIN profiles p ON p.owner_id = u.id
      WHERE u.email ILIKE ${search}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    res.json({ data: { users, total, page, limit } });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: 'Failed to fetch users', code: 'SERVER_ERROR' });
  }
});

// GET /api/admin/users/:userId
app.get('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sql = getDB();

    const users = await sql`
      SELECT id, email, role, is_suspended, suspended_at, suspended_reason, created_at
      FROM users
      WHERE id = ${req.params.userId}
    `;
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const profiles = await sql`
      SELECT id, slug, business_name, theme, card_limit,
             jsonb_array_length(cards)::int AS card_count,
             created_at
      FROM profiles
      WHERE owner_id = ${req.params.userId}
      ORDER BY created_at DESC
    `;

    res.json({ data: { user: users[0], profiles } });
  } catch (err) {
    console.error('Admin get user error:', err);
    res.status(500).json({ error: 'Failed to fetch user', code: 'SERVER_ERROR' });
  }
});

// PUT /api/admin/users/:userId — update role and/or suspension
app.put('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  const targetId = req.params.userId;

  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Cannot modify your own account', code: 'SELF_MODIFY' });
  }

  try {
    const sql = getDB();

    const targets = await sql`
      SELECT id, role FROM users WHERE id = ${targetId}
    `;
    if (targets.length === 0) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    if (targets[0].role === 'admin' && process.env.ALLOW_ADMIN_DELETE !== 'true') {
      return res.status(403).json({
        error: 'Cannot modify another admin account',
        code: 'FORBIDDEN',
      });
    }

    const { role, is_suspended, suspended_reason } = req.body;
    let updated = false;

    // Role update
    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'role must be "user" or "admin"', code: 'BAD_ROLE' });
      }
      await sql`UPDATE users SET role = ${role} WHERE id = ${targetId}`;
      await writeAudit(sql, req.userId, 'update_role', targetId, { new_role: role });
      updated = true;
    }

    // Suspension update — two separate queries to correctly handle NULL resets
    if (is_suspended !== undefined) {
      if (Boolean(is_suspended)) {
        await sql`
          UPDATE users
          SET is_suspended = true, suspended_at = NOW(), suspended_reason = ${suspended_reason ?? null}
          WHERE id = ${targetId}
        `;
        await writeAudit(sql, req.userId, 'suspend', targetId, { reason: suspended_reason ?? null });
      } else {
        await sql`
          UPDATE users
          SET is_suspended = false, suspended_at = NULL, suspended_reason = NULL
          WHERE id = ${targetId}
        `;
        await writeAudit(sql, req.userId, 'unsuspend', targetId, {});
      }
      updated = true;
    }

    if (!updated) {
      return res.status(400).json({ error: 'No valid fields to update', code: 'NO_FIELDS' });
    }

    const rows = await sql`
      SELECT id, email, role, is_suspended, suspended_at, suspended_reason
      FROM users WHERE id = ${targetId}
    `;

    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Failed to update user', code: 'SERVER_ERROR' });
  }
});

// DELETE /api/admin/users/:userId
app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  const targetId = req.params.userId;

  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account', code: 'SELF_DELETE' });
  }

  try {
    const sql = getDB();

    const targets = await sql`SELECT id, email, role FROM users WHERE id = ${targetId}`;
    if (targets.length === 0) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    if (targets[0].role === 'admin' && process.env.ALLOW_ADMIN_DELETE !== 'true') {
      return res.status(403).json({
        error: 'Cannot delete another admin account',
        code: 'FORBIDDEN',
      });
    }

    // Audit before delete — after delete the email is gone
    await writeAudit(sql, req.userId, 'delete_user', targetId, { email: targets[0].email });
    await sql`DELETE FROM users WHERE id = ${targetId}`;

    res.json({ data: { deleted: true } });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user', code: 'SERVER_ERROR' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PROFILES
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/admin/profiles?page=1&limit=20&search=slug
app.get('/api/admin/profiles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const sql = getDB();

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total
      FROM profiles p
      JOIN users u ON u.id = p.owner_id
      WHERE p.slug ILIKE ${search} OR p.business_name ILIKE ${search}
    `;

    const profiles = await sql`
      SELECT p.id, p.slug, p.business_name, p.theme, p.card_limit,
             jsonb_array_length(p.cards)::int AS card_count,
             p.created_at, u.email AS owner_email
      FROM profiles p
      JOIN users u ON u.id = p.owner_id
      WHERE p.slug ILIKE ${search} OR p.business_name ILIKE ${search}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    res.json({ data: { profiles, total, page, limit } });
  } catch (err) {
    console.error('Admin list profiles error:', err);
    res.status(500).json({ error: 'Failed to fetch profiles', code: 'SERVER_ERROR' });
  }
});

// DELETE /api/admin/profiles/:slug
app.delete('/api/admin/profiles/:slug', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sql = getDB();

    const rows = await sql`SELECT id, slug, owner_id FROM profiles WHERE slug = ${req.params.slug}`;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }

    await writeAudit(sql, req.userId, 'delete_profile', rows[0].id, {
      slug:     rows[0].slug,
      owner_id: rows[0].owner_id,
    });
    await sql`DELETE FROM profiles WHERE id = ${rows[0].id}`;

    res.json({ data: { deleted: true } });
  } catch (err) {
    console.error('Admin delete profile error:', err);
    res.status(500).json({ error: 'Failed to delete profile', code: 'SERVER_ERROR' });
  }
});

// PUT /api/admin/profiles/:slug/limit
app.put('/api/admin/profiles/:slug/limit', requireAuth, requireAdmin, async (req, res) => {
  const cardLimit = parseInt(req.body.card_limit, 10);
  if (!Number.isInteger(cardLimit) || cardLimit < 1 || cardLimit > 100) {
    return res.status(400).json({
      error: 'card_limit must be an integer between 1 and 100',
      code: 'INVALID_LIMIT',
    });
  }

  try {
    const sql = getDB();

    const rows = await sql`
      UPDATE profiles SET card_limit = ${cardLimit}
      WHERE slug = ${req.params.slug}
      RETURNING id, slug, card_limit
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }

    await writeAudit(sql, req.userId, 'override_limit', rows[0].id, {
      slug:      rows[0].slug,
      new_limit: cardLimit,
    });

    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Admin set limit error:', err);
    res.status(500).json({ error: 'Failed to update card limit', code: 'SERVER_ERROR' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// IMPERSONATION
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/admin/users/:userId/impersonate
app.post('/api/admin/users/:userId/impersonate', requireAuth, requireAdmin, async (req, res) => {
  const targetId = req.params.userId;

  if (targetId === req.userId) {
    return res.status(400).json({ error: 'Cannot impersonate yourself', code: 'SELF_IMPERSONATE' });
  }

  try {
    const sql = getDB();

    const targets = await sql`SELECT id, email, role FROM users WHERE id = ${targetId}`;
    if (targets.length === 0) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    if (targets[0].role === 'admin') {
      return res.status(403).json({
        error: 'Cannot impersonate another admin account',
        code: 'FORBIDDEN',
      });
    }

    // JWT carries impersonatedBy so requireAuth can expose it on req
    const token = signToken(targets[0].id, { impersonatedBy: req.userId });
    setAuthCookie(res, token);

    const profiles = await sql`
      SELECT slug FROM profiles WHERE owner_id = ${targets[0].id} LIMIT 1
    `;

    await writeAudit(sql, req.userId, 'impersonate', targets[0].id, {
      target_email: targets[0].email,
    });

    res.json({
      data: {
        slug:        profiles[0]?.slug ?? null,
        targetEmail: targets[0].email,
      },
    });
  } catch (err) {
    console.error('Impersonate error:', err);
    res.status(500).json({ error: 'Impersonation failed', code: 'SERVER_ERROR' });
  }
});

// POST /api/admin/impersonate/exit
// requireAuth only — this is called FROM an impersonated session which cannot pass requireAdmin.
app.post('/api/admin/impersonate/exit', requireAuth, async (req, res) => {
  if (!req.impersonatedBy) {
    return res.status(400).json({
      error: 'Not currently in an impersonated session',
      code: 'NOT_IMPERSONATING',
    });
  }

  try {
    const sql = getDB();

    const admins = await sql`
      SELECT id, role, is_suspended FROM users WHERE id = ${req.impersonatedBy}
    `;

    if (admins.length === 0 || admins[0].role !== 'admin' || admins[0].is_suspended) {
      return res.status(403).json({
        error: 'Original admin account is no longer valid',
        code: 'ADMIN_UNAVAILABLE',
      });
    }

    // Re-sign a clean JWT for the admin — no impersonatedBy field
    const token = signToken(admins[0].id);
    setAuthCookie(res, token);

    const profiles = await sql`
      SELECT slug FROM profiles WHERE owner_id = ${admins[0].id} LIMIT 1
    `;

    res.json({ data: { slug: profiles[0]?.slug ?? null } });
  } catch (err) {
    console.error('Exit impersonation error:', err);
    res.status(500).json({ error: 'Failed to exit impersonation', code: 'SERVER_ERROR' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/admin/audit?page=1&limit=20
app.get('/api/admin/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const sql = getDB();

    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM audit_log`;

    const logs = await sql`
      SELECT a.id, a.action, a.target_id, a.metadata, a.created_at,
             u.email AS admin_email
      FROM audit_log a
      JOIN users u ON u.id = a.admin_id
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    res.json({ data: { logs, total, page, limit } });
  } catch (err) {
    console.error('Admin audit log error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

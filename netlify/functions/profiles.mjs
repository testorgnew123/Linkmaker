import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import slugify from 'slugify';
import { getDB } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { isValidSlug, sanitizeString } from '../../lib/validate.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

function generateSlug(name) {
  return slugify(name, { lower: true, strict: true }).slice(0, 45);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}

// GET /api/profiles — list current user's profiles
app.get('/api/profiles', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const rows = await sql`SELECT * FROM profiles WHERE owner_id = ${req.userId} ORDER BY created_at DESC`;
    res.json({ data: rows });
  } catch (err) {
    console.error('List profiles error:', err);
    res.status(500).json({ error: 'Failed to list profiles', code: 'SERVER_ERROR' });
  }
});

// POST /api/profiles — create a new profile
app.post('/api/profiles', requireAuth, async (req, res) => {
  try {
    const businessName = sanitizeString(req.body.business_name, 200);
    if (!businessName) {
      return res.status(400).json({ error: 'Business name is required', code: 'MISSING_NAME' });
    }

    const sql = getDB();
    let slug = generateSlug(businessName);

    if (!isValidSlug(slug)) {
      slug = 'profile-' + randomSuffix();
    }

    // Check uniqueness, append suffix if taken
    const existing = await sql`SELECT id FROM profiles WHERE slug = ${slug}`;
    if (existing.length > 0) {
      slug = slug.slice(0, 45) + '-' + randomSuffix();
    }

    const tagline = sanitizeString(req.body.tagline, 300);
    const bio = sanitizeString(req.body.bio, 1000);
    const initials = sanitizeString(req.body.initials, 3);
    const emoji = sanitizeString(req.body.emoji, 10);
    const avatarStyle = req.body.avatar_style === 'emoji' ? 'emoji' : 'initials';
    const theme = sanitizeString(req.body.theme, 30) || 'midnight';
    const socials = JSON.stringify(req.body.socials || []);
    const cards = JSON.stringify(req.body.cards || []);

    const rows = await sql`
      INSERT INTO profiles (slug, owner_id, business_name, tagline, bio, initials, emoji, avatar_style, theme, socials, cards)
      VALUES (${slug}, ${req.userId}, ${businessName}, ${tagline}, ${bio}, ${initials}, ${emoji}, ${avatarStyle}, ${theme}, ${socials}::jsonb, ${cards}::jsonb)
      RETURNING id, slug, business_name, created_at
    `;

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error('Create profile error:', err);
    if (err.message?.includes('slug')) {
      return res.status(409).json({ error: 'Slug already taken', code: 'SLUG_TAKEN' });
    }
    res.status(500).json({ error: 'Failed to create profile', code: 'SERVER_ERROR' });
  }
});

// GET /api/profiles/:slug — public, no auth
app.get('/api/profiles/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug', code: 'BAD_SLUG' });
    }

    const sql = getDB();
    const rows = await sql`
      SELECT id, slug, business_name, tagline, bio, initials, emoji,
             avatar_style, logo_url, theme, socials, cards, card_limit, created_at, updated_at
      FROM profiles WHERE slug = ${slug}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }

    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile', code: 'SERVER_ERROR' });
  }
});

// PUT /api/profiles/:slug — auth required, owner only
app.put('/api/profiles/:slug', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug', code: 'BAD_SLUG' });
    }

    const sql = getDB();

    // Verify ownership and fetch card_limit in one query
    const existing = await sql`SELECT id, owner_id, card_limit FROM profiles WHERE slug = ${slug}`;
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }
    if (existing[0].owner_id !== req.userId) {
      return res.status(403).json({ error: 'Not your profile', code: 'FORBIDDEN' });
    }

    // Enforce card limit
    const incomingCards = Array.isArray(req.body.cards) ? req.body.cards : [];
    if (incomingCards.length > existing[0].card_limit) {
      return res.status(400).json({
        error: `Card limit reached (max ${existing[0].card_limit})`,
        code: 'CARD_LIMIT_EXCEEDED',
      });
    }

    const businessName = sanitizeString(req.body.business_name, 200);
    if (!businessName) {
      return res.status(400).json({ error: 'Business name is required', code: 'MISSING_NAME' });
    }

    const tagline = sanitizeString(req.body.tagline, 300);
    const bio = sanitizeString(req.body.bio, 1000);
    const initials = sanitizeString(req.body.initials, 3);
    const emoji = sanitizeString(req.body.emoji, 10);
    const avatarStyle = ['emoji', 'logo', 'initials'].includes(req.body.avatar_style)
      ? req.body.avatar_style
      : 'initials';
    const theme = sanitizeString(req.body.theme, 30) || 'midnight';
    const socials = JSON.stringify(req.body.socials || []);
    const cards = JSON.stringify(req.body.cards || []);

    const rows = await sql`
      UPDATE profiles SET
        business_name = ${businessName},
        tagline = ${tagline},
        bio = ${bio},
        initials = ${initials},
        emoji = ${emoji},
        avatar_style = ${avatarStyle},
        theme = ${theme},
        socials = ${socials}::jsonb,
        cards = ${cards}::jsonb
      WHERE slug = ${slug}
      RETURNING id, slug, business_name, updated_at
    `;

    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile', code: 'SERVER_ERROR' });
  }
});

// DELETE /api/profiles/:slug — auth required, owner only
app.delete('/api/profiles/:slug', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug', code: 'BAD_SLUG' });
    }

    const sql = getDB();

    const existing = await sql`SELECT id, owner_id FROM profiles WHERE slug = ${slug}`;
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }
    if (existing[0].owner_id !== req.userId) {
      return res.status(403).json({ error: 'Not your profile', code: 'FORBIDDEN' });
    }

    await sql`DELETE FROM profiles WHERE slug = ${slug}`;
    res.json({ data: { message: 'Profile deleted' } });
  } catch (err) {
    console.error('Delete profile error:', err);
    res.status(500).json({ error: 'Failed to delete profile', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

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

export const handler = serverless(app);

/**
 * Local dev server — merges all Netlify Functions into one Express app
 * and serves static files from public/.
 *
 * Usage: node --env-file=.env scripts/dev.mjs
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();

// ── Import each function's app and mount its routes ──────────────

// auth.mjs — POST /api/auth/register, /login, /logout, GET /api/auth/me
const authMod = await import('../netlify/functions/auth.mjs');
// profiles.mjs — POST /api/profiles
const profilesMod = await import('../netlify/functions/profiles.mjs');
// profile.mjs — GET/PUT/DELETE /api/profiles/:slug
const profileMod = await import('../netlify/functions/profile.mjs');
// profile-qr.mjs — GET /api/profiles/:slug/qr
const qrMod = await import('../netlify/functions/profile-qr.mjs');
// profile-logo.mjs — POST /api/profiles/:slug/logo
const logoMod = await import('../netlify/functions/profile-logo.mjs');

// Each module exports an Express app via `serverless(app)`.
// We need the raw Express app. Since they all register routes on
// full paths (/api/...), we can mount each app's _router directly.

// Extract the Express app from each module.
// The modules define `const app = express()` then `export const handler = serverless(app)`.
// We can't get `app` directly, so we re-use the route registrations
// by importing the route handlers. Let's just build a fresh unified app instead.

import cookieParser from 'cookie-parser';
import { getDB } from '../lib/db.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth } from '../lib/auth.js';
import { isValidSlug, isValidEmail, isValidUrl, sanitizeString, validateHandle } from '../lib/validate.js';
import { isReserved } from '../lib/reserved-handles.js';
import { uploadBuffer } from '../lib/cloudinary.js';
import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import QRCode from 'qrcode';
import multer from 'multer';

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ── Static files ─────────────────────────────────────────────────
app.use(express.static(publicDir));

// ── Auth routes ──────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const sql = getDB();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required', code: 'MISSING_FIELDS' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email', code: 'INVALID_EMAIL' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters', code: 'WEAK_PASSWORD' });

    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
    if (existing.length) return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });

    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`INSERT INTO users (email, password_hash) VALUES (${email.toLowerCase()}, ${hash}) RETURNING id, email, created_at`;
    const user = rows[0];
    const token = signToken(user.id);
    setAuthCookie(res, token);
    res.status(201).json({ data: { id: user.id, email: user.email, created_at: user.created_at } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const sql = getDB();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required', code: 'MISSING_FIELDS' });

    const rows = await sql`SELECT id, email, password_hash, created_at FROM users WHERE email = ${email.toLowerCase()}`;
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });

    const token = signToken(user.id);
    setAuthCookie(res, token);
    res.json({ data: { id: user.id, email: user.email, created_at: user.created_at } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ data: { message: 'Logged out' } });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const rows = await sql`SELECT id, email, created_at FROM users WHERE id = ${req.userId}`;
    if (!rows.length) return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// ── Profile list (current user) ──────────────────────────────────
app.get('/api/profiles', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const rows = await sql`SELECT * FROM profiles WHERE owner_id = ${req.userId} ORDER BY created_at DESC`;
    res.json({ data: rows });
  } catch (err) {
    console.error('List profiles error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// ── Handle routes ────────────────────────────────────────────────
app.get('/api/handles/mine', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const rows = await sql`SELECT slug FROM profiles WHERE owner_id = ${req.userId} LIMIT 1`;
    res.json({ data: { slug: rows[0]?.slug ?? null } });
  } catch (err) {
    console.error('Handles mine error:', err);
    res.status(500).json({ error: 'Check failed', code: 'SERVER_ERROR' });
  }
});

app.get('/api/handles/check', async (req, res) => {
  const handle = (req.query.handle || '').toLowerCase();
  const { valid } = validateHandle(handle);
  if (!valid) return res.json({ data: { available: false, reason: 'invalid' } });
  if (isReserved(handle)) return res.json({ data: { available: false, reason: 'reserved' } });
  try {
    const sql = getDB();
    const rows = await sql`SELECT id FROM profiles WHERE slug = ${handle}`;
    if (rows.length > 0) return res.json({ data: { available: false, reason: 'taken' } });
    res.json({ data: { available: true } });
  } catch (err) {
    console.error('Handle check error:', err);
    res.status(500).json({ error: 'Check failed', code: 'SERVER_ERROR' });
  }
});

app.post('/api/handles/claim', requireAuth, async (req, res) => {
  const handle = (req.body.handle || '').toLowerCase().trim();
  const { valid } = validateHandle(handle);
  if (!valid) return res.status(400).json({ error: 'Invalid handle format', code: 'INVALID_HANDLE' });
  if (isReserved(handle)) return res.status(400).json({ error: 'Handle is reserved', code: 'HANDLE_RESERVED' });
  try {
    const sql = getDB();
    const existing = await sql`SELECT id FROM profiles WHERE owner_id = ${req.userId}`;
    if (existing.length > 0) return res.status(409).json({ error: 'You already have a profile', code: 'PROFILE_EXISTS' });
    const taken = await sql`SELECT id FROM profiles WHERE slug = ${handle}`;
    if (taken.length > 0) return res.status(409).json({ error: 'Handle already taken', code: 'HANDLE_TAKEN' });
    const rows = await sql`INSERT INTO profiles (slug, owner_id, business_name) VALUES (${handle}, ${req.userId}, ${handle}) RETURNING id, slug`;
    res.status(201).json({ data: { slug: rows[0].slug, profileId: rows[0].id } });
  } catch (err) {
    console.error('Handle claim error:', err);
    if (err.message?.includes('slug') || err.code === '23505') {
      return res.status(409).json({ error: 'Handle already taken', code: 'HANDLE_TAKEN' });
    }
    res.status(500).json({ error: 'Claim failed', code: 'SERVER_ERROR' });
  }
});

// ── Profile create ───────────────────────────────────────────────
app.post('/api/profiles', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const { business_name, tagline, bio, initials, emoji, avatar_style, theme, socials, cards } = req.body;
    if (!business_name) return res.status(400).json({ error: 'business_name is required', code: 'MISSING_FIELDS' });

    let slug = slugify(business_name, { lower: true, strict: true });
    if (!isValidSlug(slug)) slug = slug.slice(0, 45);
    if (!isValidSlug(slug)) return res.status(400).json({ error: 'Cannot generate valid slug from business name', code: 'INVALID_SLUG' });

    const existing = await sql`SELECT id FROM profiles WHERE slug = ${slug}`;
    if (existing.length) {
      const suffix = Math.random().toString(36).slice(2, 6);
      slug = `${slug}-${suffix}`.slice(0, 50);
    }

    const rows = await sql`
      INSERT INTO profiles (slug, owner_id, business_name, tagline, bio, initials, emoji, avatar_style, theme, socials, cards)
      VALUES (${slug}, ${req.userId}, ${sanitizeString(business_name)}, ${sanitizeString(tagline || '')}, ${sanitizeString(bio || '')}, ${sanitizeString(initials || '')}, ${emoji || ''}, ${avatar_style || 'initials'}, ${theme || 'midnight'}, ${JSON.stringify(socials || [])}, ${JSON.stringify(cards || [])})
      RETURNING *`;
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error('Create profile error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// ── Profile QR (before :slug catch-all) ──────────────────────────
app.get('/api/profiles/:slug/qr', async (req, res) => {
  try {
    const sql = getDB();
    const { slug } = req.params;
    const rows = await sql`SELECT id FROM profiles WHERE slug = ${slug}`;
    if (!rows.length) return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });

    const baseUrl = process.env.URL || 'http://localhost:3000';
    const profileUrl = `${baseUrl}/p/${slug}`;
    const png = await QRCode.toBuffer(profileUrl, { type: 'png', width: 400, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    console.error('QR error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// ── Profile logo upload ──────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

app.post('/api/profiles/:slug/logo', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const sql = getDB();
    const { slug } = req.params;
    const existing = await sql`SELECT id, owner_id FROM profiles WHERE slug = ${slug}`;
    if (!existing.length) return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    if (existing[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not your profile', code: 'FORBIDDEN' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'MISSING_FILE' });

    const logoUrl = await uploadBuffer(req.file.buffer, `qr-profiles/${slug}`);
    await sql`UPDATE profiles SET logo_url = ${logoUrl} WHERE slug = ${slug}`;
    res.json({ data: { logo_url: logoUrl } });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// ── Profile CRUD ─────────────────────────────────────────────────
app.get('/api/profiles/:slug', async (req, res) => {
  try {
    const sql = getDB();
    const { slug } = req.params;
    const rows = await sql`SELECT * FROM profiles WHERE slug = ${slug}`;
    if (!rows.length) return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

app.put('/api/profiles/:slug', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const { slug } = req.params;
    const existing = await sql`SELECT id, owner_id FROM profiles WHERE slug = ${slug}`;
    if (!existing.length) return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    if (existing[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not your profile', code: 'FORBIDDEN' });

    const { business_name, tagline, bio, initials, emoji, avatar_style, theme, socials, cards } = req.body;
    const validAvatarStyle = ['emoji', 'logo', 'initials'].includes(avatar_style) ? avatar_style : 'initials';
    const rows = await sql`
      UPDATE profiles SET
        business_name = ${sanitizeString(business_name || '')},
        tagline = ${sanitizeString(tagline || '')},
        bio = ${sanitizeString(bio || '')},
        initials = ${sanitizeString(initials || '')},
        emoji = ${emoji || ''},
        avatar_style = ${validAvatarStyle},
        theme = ${theme || 'midnight'},
        socials = ${JSON.stringify(socials || [])},
        cards = ${JSON.stringify(cards || [])}
      WHERE slug = ${slug}
      RETURNING *`;
    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

app.delete('/api/profiles/:slug', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const { slug } = req.params;
    const existing = await sql`SELECT id, owner_id FROM profiles WHERE slug = ${slug}`;
    if (!existing.length) return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    if (existing[0].owner_id !== req.userId) return res.status(403).json({ error: 'Not your profile', code: 'FORBIDDEN' });

    await sql`DELETE FROM profiles WHERE slug = ${slug}`;
    res.json({ data: { message: 'Deleted' } });
  } catch (err) {
    console.error('Delete profile error:', err);
    res.status(500).json({ error: 'Server error', code: 'SERVER_ERROR' });
  }
});

// ── Google Place routes ──────────────────────────────────────────
app.get('/api/google-place', requireAuth, async (req, res) => {
  try {
    const { placeId } = req.query;
    if (!placeId || typeof placeId !== 'string' || placeId.length > 200) {
      return res.status(400).json({ error: 'Valid placeId query param required', code: 'BAD_INPUT' });
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured', code: 'NO_API_KEY' });

    const fields = 'displayName,rating,userRatingCount,googleMapsUri';
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=${fields}&key=${apiKey}`;
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) {
      console.error('Google Places API error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch from Google Places API', code: 'GOOGLE_API_ERROR' });
    }
    const place = await response.json();
    res.json({ data: { name: place.displayName?.text || '', rating: place.rating ?? null, reviewCount: place.userRatingCount ?? 0, mapsUrl: place.googleMapsUri || '' } });
  } catch (err) {
    console.error('google-place error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

app.post('/api/google-place/search', requireAuth, async (req, res) => {
  try {
    let { query } = req.body;
    if (!query || typeof query !== 'string' || query.length > 2000) {
      return res.status(400).json({ error: 'Valid query required', code: 'BAD_INPUT' });
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured', code: 'NO_API_KEY' });

    // Parse Google Maps embed URL if provided
    let locationBias;
    if (query.includes('google.com/maps') && query.includes('pb=')) {
      try {
        const parsedUrl = new URL(query);
        const pb = parsedUrl.searchParams.get('pb') || '';
        const nameMatches = pb.match(/!2s([^!]+)/g);
        let name = '';
        if (nameMatches) {
          for (const m of nameMatches) {
            const val = decodeURIComponent(m.replace('!2s', ''));
            if (val.length > 2 && !val.match(/^[a-z]{2}$/)) name = val;
          }
        }
        const latMatch = pb.match(/!3d(-?[\d.]+)/);
        const lngMatch = pb.match(/!2d(-?[\d.]+)/);
        if (name) query = name;
        if (latMatch && lngMatch) {
          locationBias = { circle: { center: { latitude: parseFloat(latMatch[1]), longitude: parseFloat(lngMatch[1]) }, radius: 500.0 } };
        }
      } catch {}
    }

    const body = { textQuery: query, maxResultCount: 5 };
    if (locationBias) body.locationBias = locationBias;

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.formattedAddress' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      console.error('Google Places Search error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to search Google Places', code: 'GOOGLE_API_ERROR' });
    }
    const result = await response.json();
    const places = (result.places || []).map(p => ({
      placeId: p.id, name: p.displayName?.text || '', address: p.formattedAddress || '',
      rating: p.rating ?? null, reviewCount: p.userRatingCount ?? 0, mapsUrl: p.googleMapsUri || ''
    }));
    res.json({ data: places });
  } catch (err) {
    console.error('google-place search error:', err);
    res.status(500).json({ error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// ── SPA fallback for /p/* ────────────────────────────────────────
app.get('/p/*', (_req, res) => {
  res.sendFile(join(publicDir, 'p', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Local dev server ready: http://localhost:${PORT}\n`);
  console.log(`  Editor:  http://localhost:${PORT}/editor.html?slug=desire-realty`);
  console.log(`  Profile: http://localhost:${PORT}/p/desire-realty`);
  console.log(`  API:     http://localhost:${PORT}/api/profiles/desire-realty\n`);
});

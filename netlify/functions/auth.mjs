import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { getDB } from '../../lib/db.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth } from '../../lib/auth.js';
import { isValidEmail, sanitizeString } from '../../lib/validate.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const email = sanitizeString(req.body.email, 254).toLowerCase();
    const password = req.body.password;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email', code: 'BAD_EMAIL' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters', code: 'BAD_PASSWORD' });
    }

    const sql = getDB();
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_TAKEN' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${passwordHash})
      RETURNING id, email, created_at
    `;

    const user = rows[0];
    const token = signToken(user.id);
    setAuthCookie(res, token);

    res.status(201).json({ data: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', code: 'SERVER_ERROR' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = sanitizeString(req.body.email, 254).toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required', code: 'MISSING_FIELDS' });
    }

    const sql = getDB();
    const rows = await sql`SELECT id, email, password_hash FROM users WHERE email = ${email}`;
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'BAD_CREDENTIALS' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'BAD_CREDENTIALS' });
    }

    const token = signToken(user.id);
    setAuthCookie(res, token);

    res.json({ data: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', code: 'SERVER_ERROR' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ data: { message: 'Logged out' } });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const sql = getDB();
    const rows = await sql`SELECT id, email, created_at FROM users WHERE id = ${req.userId}`;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

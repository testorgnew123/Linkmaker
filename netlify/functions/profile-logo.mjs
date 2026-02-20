import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { getDB } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { isValidSlug } from '../../lib/validate.js';
import { uploadBuffer } from '../../lib/cloudinary.js';

const app = express();
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// POST /api/profiles/:slug/logo — auth required, owner only
app.post('/api/profiles/:slug/logo', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug', code: 'BAD_SLUG' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
    }

    const sql = getDB();

    // Verify ownership
    const existing = await sql`SELECT id, owner_id FROM profiles WHERE slug = ${slug}`;
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }
    if (existing[0].owner_id !== req.userId) {
      return res.status(403).json({ error: 'Not your profile', code: 'FORBIDDEN' });
    }

    const logoUrl = await uploadBuffer(req.file.buffer, `qr-profiles/${slug}`);

    await sql`UPDATE profiles SET logo_url = ${logoUrl} WHERE slug = ${slug}`;

    res.json({ data: { logo_url: logoUrl } });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: 'Failed to upload logo', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

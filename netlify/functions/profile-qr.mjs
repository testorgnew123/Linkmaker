import express from 'express';
import serverless from 'serverless-http';
import QRCode from 'qrcode';
import { isValidSlug } from '../../lib/validate.js';

const app = express();

// GET /api/profiles/:slug/qr — public, returns QR code as PNG
app.get('/api/profiles/:slug/qr', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug', code: 'BAD_SLUG' });
    }

    const baseUrl = process.env.URL || 'https://localhost:8888';
    const profileUrl = `${baseUrl}/p/${slug}`;

    const pngBuffer = await QRCode.toBuffer(profileUrl, {
      type: 'png',
      width: 512,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(pngBuffer);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

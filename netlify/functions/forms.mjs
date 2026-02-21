import express from 'express';
import serverless from 'serverless-http';
import nodemailer from 'nodemailer';
import { getDB } from '../../lib/db.js';
import { isValidEmail, sanitizeString } from '../../lib/validate.js';

const app = express();
app.use(express.json());

// POST /api/forms/contact — send contact form email
app.post('/api/forms/contact', async (req, res) => {
  try {
    const { profileSlug, recipientEmail, formData } = req.body;

    if (!profileSlug || !recipientEmail || !formData) {
      return res.status(400).json({ error: 'Missing required fields', code: 'BAD_REQUEST' });
    }

    if (!isValidEmail(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid recipient email', code: 'BAD_REQUEST' });
    }

    // Validate recipientEmail belongs to the profile owner
    const sql = getDB();
    const rows = await sql`
      SELECT u.email
      FROM profiles p
      JOIN users u ON u.id = p.owner_id
      WHERE p.slug = ${profileSlug}
    `;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }

    if (rows[0].email !== recipientEmail) {
      return res.status(403).json({ error: 'Recipient email does not match profile owner', code: 'FORBIDDEN' });
    }

    // Send email via SMTP
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS,
      },
    });

    const name = sanitizeString(formData.name || '', 100);
    const email = sanitizeString(formData.email || '', 200);
    const phone = sanitizeString(formData.phone || '', 30);
    const message = sanitizeString(formData.message || '', 2000);

    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      message ? `Message:\n${message}` : null,
    ].filter(Boolean).join('\n\n');

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: recipientEmail,
      subject: `Contact form submission from ${name || 'visitor'} — ${profileSlug}`,
      text: body,
    });

    res.json({ data: { sent: true } });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Failed to send message', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

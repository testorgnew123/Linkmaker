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
    const port = parseInt(process.env.SMTP_PORT || '587');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
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

// POST /api/forms/subscribe — save email capture subscriber
app.post('/api/forms/subscribe', async (req, res) => {
  try {
    const { profileSlug, cardId, email } = req.body;

    if (!profileSlug || !cardId || !email) {
      return res.status(400).json({ error: 'Missing required fields', code: 'BAD_REQUEST' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address', code: 'BAD_REQUEST' });
    }

    const sql = getDB();

    // Verify the profile exists
    const profiles = await sql`SELECT slug FROM profiles WHERE slug = ${profileSlug}`;
    if (profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found', code: 'NOT_FOUND' });
    }

    // Insert subscriber (ignore duplicate)
    const result = await sql`
      INSERT INTO email_subscribers (profile_slug, card_id, email)
      VALUES (${profileSlug}, ${String(cardId)}, ${email})
      ON CONFLICT (profile_slug, card_id, email) DO NOTHING
      RETURNING id
    `;

    // Send notification email to profile owner (only for new subscribers)
    if (result.length > 0) {
      if (!process.env.SMTP_HOST) {
        console.warn('SMTP_HOST not configured - skipping subscriber notification email');
      } else {
        try {
          const ownerRows = await sql`
            SELECT u.email FROM profiles p JOIN users u ON u.id = p.owner_id
            WHERE p.slug = ${profileSlug}
          `;
          if (ownerRows.length > 0) {
            const port = parseInt(process.env.SMTP_PORT || '587');
            console.log(`Sending subscriber notification to ${ownerRows[0].email} via ${process.env.SMTP_HOST}:${port}`);
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST,
              port,
              secure: port === 465,
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS
              }
            });
            await transporter.sendMail({
              from: process.env.SMTP_USER,
              to: ownerRows[0].email,
              subject: `New subscriber on ${profileSlug}`,
              text: `You have a new email subscriber!\n\nEmail: ${email}\nProfile: ${profileSlug}\nTime: ${new Date().toISOString()}`
            });
            console.log('Subscriber notification email sent successfully');
          } else {
            console.warn(`No owner found for profile ${profileSlug}`);
          }
        } catch (emailErr) {
          console.error('Subscriber notification email error:', emailErr.message, emailErr.stack);
          // Don't fail the request if email fails — subscriber is already saved
        }
      }
    }

    res.json({ data: { subscribed: true } });
  } catch (err) {
    console.error('Email subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

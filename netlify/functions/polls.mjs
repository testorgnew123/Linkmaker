import express from 'express';
import serverless from 'serverless-http';
import { getDB } from '../../lib/db.js';

const app = express();
app.use(express.json());

// GET /api/polls/:slug/:cardId — returns vote counts
app.get('/api/polls/:slug/:cardId', async (req, res) => {
  try {
    const { slug, cardId } = req.params;
    const sql = getDB();

    const rows = await sql`
      SELECT option_index, COUNT(*)::int as votes
      FROM poll_votes
      WHERE profile_slug = ${slug} AND card_id = ${cardId}
      GROUP BY option_index
      ORDER BY option_index
    `;

    const counts = {};
    for (const r of rows) counts[r.option_index] = r.votes;
    res.json({ data: { counts } });
  } catch (err) {
    console.error('Poll results error:', err);
    res.status(500).json({ error: 'Failed to fetch poll results', code: 'SERVER_ERROR' });
  }
});

// POST /api/polls/vote — cast a vote
app.post('/api/polls/vote', async (req, res) => {
  try {
    const { slug, cardId, optionIndex } = req.body;

    if (!slug || !cardId || optionIndex == null) {
      return res.status(400).json({ error: 'Missing required fields', code: 'BAD_REQUEST' });
    }

    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 9) {
      return res.status(400).json({ error: 'Invalid option index', code: 'BAD_REQUEST' });
    }

    const voterIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';

    const sql = getDB();
    await sql`
      INSERT INTO poll_votes (profile_slug, card_id, option_index, voter_ip)
      VALUES (${slug}, ${String(cardId)}, ${optionIndex}, ${voterIp})
    `;

    // Return updated counts
    const rows = await sql`
      SELECT option_index, COUNT(*)::int as votes
      FROM poll_votes
      WHERE profile_slug = ${slug} AND card_id = ${String(cardId)}
      GROUP BY option_index
      ORDER BY option_index
    `;

    const counts = {};
    for (const r of rows) counts[r.option_index] = r.votes;
    res.json({ data: { counts } });
  } catch (err) {
    console.error('Poll vote error:', err);
    res.status(500).json({ error: 'Failed to record vote', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

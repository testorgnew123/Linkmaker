import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import { requireAuth } from '../../lib/auth.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

/**
 * Parse a Google Maps embed URL to extract business name and coordinates.
 * Example URL:
 * https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3561.19!2d75.819!3d26.801!...!2sDesire%20Realty!...
 *
 * The pb parameter encodes:
 *   !2d<lng> = longitude
 *   !3d<lat> = latitude
 *   !2s<name> = place name (URL-encoded)
 */
function parseEmbedUrl(embedUrl) {
  try {
    const url = new URL(embedUrl);
    const pb = url.searchParams.get('pb') || '';
    // Extract business name: look for !2s<name>! pattern after the place marker !1s
    const nameMatch = pb.match(/!2s([^!]+)/g);
    // The business name is usually the last !2s token (after the place CID)
    let name = '';
    if (nameMatch) {
      // Pick the one that looks like a name (not a language code like "en")
      for (const m of nameMatch) {
        const val = decodeURIComponent(m.replace('!2s', ''));
        if (val.length > 2 && !val.match(/^[a-z]{2}$/)) {
          name = val;
        }
      }
    }
    // Extract coordinates
    const latMatch = pb.match(/!3d(-?[\d.]+)/);
    const lngMatch = pb.match(/!2d(-?[\d.]+)/);
    const lat = latMatch ? parseFloat(latMatch[1]) : null;
    const lng = lngMatch ? parseFloat(lngMatch[1]) : null;
    return { name, lat, lng };
  } catch {
    return { name: '', lat: null, lng: null };
  }
}

// GET /api/google-place?placeId=XXXX  — fetch details by Place ID
app.get('/api/google-place', requireAuth, async (req, res) => {
  try {
    const { placeId } = req.query;
    if (!placeId || typeof placeId !== 'string' || placeId.length > 200) {
      return res.status(400).json({ error: 'Valid placeId query param required', code: 'BAD_INPUT' });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Places API key not configured', code: 'NO_API_KEY' });
    }

    const fields = 'displayName,rating,userRatingCount,googleMapsUri';
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=${fields}&key=${apiKey}`;

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Google Places API error:', response.status, text);
      return res.status(502).json({ error: 'Failed to fetch from Google Places API', code: 'GOOGLE_API_ERROR' });
    }

    const place = await response.json();

    return res.json({
      data: {
        name: place.displayName?.text || '',
        rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? 0,
        mapsUrl: place.googleMapsUri || ''
      }
    });
  } catch (err) {
    console.error('google-place error:', err);
    return res.status(500).json({ error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

// POST /api/google-place/search  — search by name OR parse embed URL
app.post('/api/google-place/search', requireAuth, async (req, res) => {
  try {
    let { query } = req.body;
    if (!query || typeof query !== 'string' || query.length > 2000) {
      return res.status(400).json({ error: 'Valid query required', code: 'BAD_INPUT' });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Places API key not configured', code: 'NO_API_KEY' });
    }

    // If the query looks like a Google Maps embed URL, parse it
    let locationBias = undefined;
    if (query.includes('google.com/maps') && query.includes('pb=')) {
      const parsed = parseEmbedUrl(query);
      if (parsed.name) {
        query = parsed.name;
      }
      if (parsed.lat != null && parsed.lng != null) {
        locationBias = {
          circle: {
            center: { latitude: parsed.lat, longitude: parsed.lng },
            radius: 500.0
          }
        };
      }
    }

    const url = `https://places.googleapis.com/v1/places:searchText`;
    const body = { textQuery: query, maxResultCount: 5 };
    if (locationBias) body.locationBias = locationBias;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.formattedAddress'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Google Places Search error:', response.status, text);
      return res.status(502).json({ error: 'Failed to search Google Places', code: 'GOOGLE_API_ERROR' });
    }

    const result = await response.json();
    const places = (result.places || []).map(p => ({
      placeId: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? 0,
      mapsUrl: p.googleMapsUri || ''
    }));

    return res.json({ data: places });
  } catch (err) {
    console.error('google-place search error:', err);
    return res.status(500).json({ error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

export const handler = serverless(app);

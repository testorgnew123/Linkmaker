const SLUG_RE = /^[a-z0-9-]{3,50}$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

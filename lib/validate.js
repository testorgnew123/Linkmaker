const SLUG_RE = /^[a-z0-9-]{3,50}$/;

// Handle rules (stricter than slug):
//   ^[a-z0-9]          — must start with alphanumeric
//   [a-z0-9-]{1,28}    — middle: alphanumeric or hyphen
//   [a-z0-9]$          — must end with alphanumeric
//   no consecutive hyphens
//   total length 3–30
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

/**
 * Validates a user-chosen handle.
 * @param {string} str
 * @returns {{ valid: boolean, reason?: 'invalid'|'reserved' }}
 */
export function validateHandle(str) {
  if (
    typeof str !== 'string' ||
    !HANDLE_RE.test(str) ||
    str.includes('--')
  ) {
    return { valid: false, reason: 'invalid' };
  }
  // Reserved check is done at the API layer (imports reserved-handles.js)
  // so callers can pass the reserved list check separately if needed.
  return { valid: true };
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

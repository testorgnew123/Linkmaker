import jwt from 'jsonwebtoken';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export function signToken(userId) {
  return jwt.sign({ sub: userId }, SECRET(), { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET());
}

export function setAuthCookie(res, token) {
  res.cookie('token', token, COOKIE_OPTIONS);
}

export function clearAuthCookie(res) {
  res.clearCookie('token', { path: '/' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated', code: 'NO_TOKEN' });
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'BAD_TOKEN' });
  }
}

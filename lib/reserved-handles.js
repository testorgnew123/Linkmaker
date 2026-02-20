// Handles that cannot be claimed by any user.
// Keep sorted alphabetically for easy auditing.
export const RESERVED_HANDLES = [
  'about',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'dashboard',
  'favicon',
  'help',
  'images',
  'login',
  'logout',
  'mail',
  'me',
  'p',
  'privacy',
  'public',
  'register',
  'settings',
  'signup',
  'static',
  'support',
  'terms',
  'www',
];

export function isReserved(handle) {
  return RESERVED_HANDLES.includes(handle);
}

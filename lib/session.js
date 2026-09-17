// Sign-in through Crystal Core.
//
// Pulse has no accounts of its own. Crystal Core (the Crystal Group SSO hub) decides who may open it:
//
//   1. The user clicks the Crystal Pulse tile in Core. Core checks their grant for the system code
//      "pulse", mints a 60-second launch token and redirects to  <pulse>/sso?token=...&return=<path>
//   2. app/sso/route.js hands that token to Core's  POST /api/auth/verify  { token, system: "pulse" }.
//      Core answers with the user and `allowed`.
//   3. Pulse mints ITS OWN session cookie (an HS256 JWT signed with PULSE_SESSION_SECRET) and the
//      middleware lets every page and API through while that cookie verifies.
//
// This module runs in three places - the Edge middleware, Node route handlers and the self-hosted
// WebSocket hub in lib/live.js - so it uses only `jose` and Web APIs: no fs, no Node crypto.
// Configuration is read at call time, never at import, so `next build` needs no secrets.

const { SignJWT, jwtVerify } = require('jose');

const COOKIE_NAME = 'pulse_session';
const SYSTEM_CODE = 'pulse';
const DEFAULT_SESSION_HOURS = 168; // a week: a wall display must not be signed out every night
const DEV_FALLBACK_SECRET = 'pulse-dev-only-insecure-secret-change-me-please-32+';

function env(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

// Sign-in is on unless PULSE_AUTH=off is set explicitly (a display on a closed plant network that has no
// route to Crystal Core). Anything else, including an unset variable, means on: a gate that quietly opens
// when a variable is missing is not a gate.
function authEnabled() {
  return env('PULSE_AUTH').toLowerCase() !== 'off';
}

// Origin of the Crystal Core deployment, e.g. https://crystal-core-official-version.vercel.app
function coreUrl() {
  const raw = env('CRYSTAL_CORE_URL');
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

function sessionHours() {
  const n = Number(env('PULSE_SESSION_HOURS'));
  return Number.isFinite(n) && n >= 1 && n <= 24 * 90 ? n : DEFAULT_SESSION_HOURS;
}

function secretBytes() {
  const raw = env('PULSE_SESSION_SECRET');
  if (raw.length >= 32) return new TextEncoder().encode(raw);
  if (process.env.NODE_ENV === 'production') return null; // fail closed: no secret, no sessions
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

// null when sign-in can work, otherwise the reason it cannot (shown on /signin, logged once).
function configProblem() {
  if (!authEnabled()) return null;
  if (!coreUrl()) return 'CRYSTAL_CORE_URL is not set';
  if (!secretBytes()) return 'PULSE_SESSION_SECRET is not set (32+ characters)';
  return null;
}

async function signSession(user) {
  const key = secretBytes();
  if (!key) throw new Error('PULSE_SESSION_SECRET is not set');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, name: user.name, role: user.role, purpose: 'pulse-session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setSubject(String(user.userId))
    .setExpirationTime(now + sessionHours() * 3600)
    .sign(key);
}

// -> { userId, email, name, role, expiresAt } or null. Never throws.
async function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const key = secretBytes();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (payload.purpose !== 'pulse-session' || !payload.sub) return null;
    return {
      userId: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
      role: typeof payload.role === 'string' ? payload.role : '',
      expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null,
    };
  } catch {
    return null;
  }
}

// `secure` is decided per request from the protocol the browser used: Vercel is https (the cookie must be
// Secure there), the plant PC serves http://<lan-ip>:3000 to its kiosk, where a Secure cookie would never
// be sent back at all.
function cookieOptions(secure) {
  return { httpOnly: true, sameSite: 'lax', secure: Boolean(secure), path: '/', maxAge: sessionHours() * 3600 };
}

function requestIsHttps(req) {
  const fwd = req.headers && typeof req.headers.get === 'function' ? req.headers.get('x-forwarded-proto') : null;
  if (fwd) return fwd.split(',')[0].trim() === 'https';
  return Boolean(req.nextUrl && req.nextUrl.protocol === 'https:');
}

// The origin the BROWSER used, from the Host header (Vercel: x-forwarded-host). `req.nextUrl.origin` is
// not that: under the self-hosted server it reflects the bind address (0.0.0.0), which no browser can follow.
function requestOrigin(req) {
  const h = req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const host = h ? String(h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim() : '';
  if (host && /^[A-Za-z0-9.\-[\]:]+$/.test(host)) return `${requestIsHttps(req) ? 'https' : 'http'}://${host}`;
  return req.nextUrl ? req.nextUrl.origin : '';
}

// Paths that must stay reachable without a session: the sign-in flow itself, static assets, and
// /api/health (no readings in it - it exists for uptime monitors).
const PUBLIC_EXACT = new Set(['/sso', '/signin', '/signout', '/api/health', '/favicon.ico', '/robots.txt']);
function isPublicPath(pathname) {
  if (typeof pathname !== 'string') return false;
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/api/')) return false;
  return /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|css|js|map|txt)$/i.test(pathname);
}

// Only a same-origin path may be the post-sign-in destination (no open redirect through /sso?return=).
function safeReturnPath(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\r\n\0]/.test(raw)) return '/';
  if (/^\/(sso|signin|signout)(\/|\?|$)/.test(raw)) return '/';
  return raw;
}

// Where an unauthenticated browser is sent: Core's launcher for this system, which comes back to /sso.
function launchUrl(returnPath) {
  const base = coreUrl();
  if (!base) return null;
  const u = new URL('/api/sso/launch', base);
  u.searchParams.set('system', SYSTEM_CODE);
  const r = safeReturnPath(returnPath);
  if (r !== '/') u.searchParams.set('return', r);
  return u.toString();
}

// Read one cookie from a raw Cookie header (the WebSocket upgrade path has no framework helpers).
function parseCookie(header, name) {
  if (!header || typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
    }
  }
  return null;
}

module.exports = {
  COOKIE_NAME,
  SYSTEM_CODE,
  authEnabled,
  coreUrl,
  sessionHours,
  configProblem,
  signSession,
  verifySession,
  cookieOptions,
  requestIsHttps,
  requestOrigin,
  isPublicPath,
  safeReturnPath,
  launchUrl,
  parseCookie,
};

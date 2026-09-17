// GET /sso?token=<Crystal Core launch token>&return=<path>
//
// Crystal Core's launcher lands here. The token is only ever handed straight back to Core
// (POST /api/auth/verify) - Pulse never decodes it itself and ignores any identity in the query string.
// A confirmed, allowed user gets Pulse's own session cookie and goes to `return` (same-origin paths only).
// Every failure lands on /signin with a reason the person can act on.
//
// Redirects are RELATIVE (a bare path in Location): the browser resolves them against the address it
// used, which is right on Vercel and on the plant PC alike, whereas an absolute URL built from the server's
// own view of itself is 0.0.0.0 under the self-hosted server.

import { NextResponse } from 'next/server';
import {
  COOKIE_NAME,
  SYSTEM_CODE,
  authEnabled,
  configProblem,
  cookieOptions,
  coreUrl,
  requestIsHttps,
  safeReturnPath,
  signSession,
} from '../../lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

const VERIFY_TIMEOUT_MS = 10000;

function redirect(path) {
  return new NextResponse(null, { status: 307, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

function toSignin(error, next) {
  const q = new URLSearchParams();
  if (error) q.set('error', error);
  if (next && next !== '/') q.set('next', next);
  const s = q.toString();
  return redirect(s ? `/signin?${s}` : '/signin');
}

export async function GET(req) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const next = safeReturnPath(req.nextUrl.searchParams.get('return') || '/');

  if (!authEnabled()) return redirect(next);
  if (configProblem()) return toSignin('not_configured');
  if (!token) return toSignin('invalid', next);

  let status = 0;
  let body = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(`${coreUrl()}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, system: SYSTEM_CODE }),
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (err) {
    console.error(`[sso] Crystal Core unreachable: ${err && err.message}`);
    return toSignin('core_unreachable', next);
  }

  if (!body || body.ok !== true) {
    const code = body && body.code;
    console.warn(`[sso] Crystal Core refused the launch token: HTTP ${status} ${code || ''}`);
    return toSignin(code === 'INVALID_TOKEN' || code === 'MISSING_TOKEN' ? 'invalid' : 'denied', next);
  }
  const data = body.data || {};
  const user = data.user || {};
  if (data.allowed !== true || !user.userId || !user.email) {
    console.warn(`[sso] ${user.email || 'unknown user'} is not granted "${SYSTEM_CODE}" in Crystal Core`);
    return toSignin('denied', next);
  }

  const session = await signSession({
    userId: user.userId,
    email: user.email,
    name: user.name || user.email,
    role: typeof data.role === 'string' ? data.role : '',
  });
  const res = redirect(next);
  res.cookies.set(COOKIE_NAME, session, cookieOptions(requestIsHttps(req)));
  console.log(`[sso] signed in ${user.email}${data.role ? ` (${data.role})` : ''}`);
  return res;
}

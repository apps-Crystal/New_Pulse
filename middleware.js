// The gate. Every page and API needs a Pulse session (issued by app/sso/route.js after Crystal Core
// vouched for the user) except the sign-in flow, static assets and /api/health - see isPublicPath.
//
// Pages without a session go to /signin, which forwards to Crystal Core's launcher; APIs answer 401 JSON
// so the dashboard's fetches can send the screen to /signin themselves. With sign-in unconfigured the
// gate stays shut (the /signin page says what is missing) rather than quietly opening.

import { NextResponse } from 'next/server';
import { COOKIE_NAME, authEnabled, configProblem, isPublicPath, verifySession } from './lib/session';

export async function middleware(req) {
  const { pathname, search } = req.nextUrl;
  if (!authEnabled() || isPublicPath(pathname)) return NextResponse.next();

  const problem = configProblem();
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = problem ? null : await verifySession(token);
  if (user) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        ok: false,
        error: problem ? `sign-in is not configured: ${problem}` : 'unauthenticated',
        code: problem ? 'NOT_CONFIGURED' : 'UNAUTHENTICATED',
        signin: '/signin',
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = '/signin';
  url.search = '';
  if (problem) url.searchParams.set('error', 'not_configured');
  else url.searchParams.set('next', `${pathname}${search}`);
  const res = NextResponse.redirect(url);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};

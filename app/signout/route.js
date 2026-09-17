// GET /signout - drop Pulse's session, then complete a global sign-out at Crystal Core, which sends the
// browser back to /signin here (Core only honours return URLs of systems it has registered).

import { NextResponse } from 'next/server';
import { COOKIE_NAME, authEnabled, coreUrl, requestOrigin } from '../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const base = authEnabled() ? coreUrl() : null;
  // Core needs an absolute URL to come back to; it is built from the address the browser used.
  const back = `${requestOrigin(req)}/signin?error=signed_out`;
  const dest = base ? `${base}/api/auth/logout?next=${encodeURIComponent(back)}` : '/signin?error=signed_out';
  const res = new NextResponse(null, { status: 307, headers: { Location: dest, 'Cache-Control': 'no-store' } });
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}

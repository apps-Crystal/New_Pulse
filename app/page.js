import { cookies } from 'next/headers';
import Dashboard from '../components/Dashboard';
import { COOKIE_NAME, authEnabled, coreUrl, verifySession } from '../lib/session';

// The middleware has already let this request through; the session is read again here only to show
// who is signed in, and the Crystal Core address is passed down for the "back to Core" button.
export const dynamic = 'force-dynamic';

export default async function Page() {
  let user = null;
  let coreHome = null;
  if (authEnabled()) {
    const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
    if (session) user = { name: session.name, email: session.email, role: session.role };
    const core = coreUrl();
    if (core) coreHome = `${core}/dashboard`;
  }
  return <Dashboard user={user} coreUrl={coreHome} />;
}

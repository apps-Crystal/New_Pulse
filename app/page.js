import { cookies } from 'next/headers';
import Dashboard from '../components/Dashboard';
import { COOKIE_NAME, authEnabled, verifySession } from '../lib/session';

// The middleware has already let this request through; the session is read again here only to show
// who is signed in (and a sign-out link) in the header.
export const dynamic = 'force-dynamic';

export default async function Page() {
  let user = null;
  if (authEnabled()) {
    const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
    if (session) user = { name: session.name, email: session.email, role: session.role };
  }
  return <Dashboard user={user} />;
}

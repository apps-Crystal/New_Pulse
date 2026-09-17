// /signin - the only page reachable without a session.
//
// With nothing to report it forwards straight to Crystal Core's launcher (which comes back to /sso with a
// token), so a kiosk that is already signed in to Core never sees this page for more than a moment.
// With an error it stops and explains; the button restarts the flow.

import { authEnabled, configProblem, launchUrl, safeReturnPath } from '../../lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in | Crystal Pulse' };

const ERRORS = {
  denied: {
    title: 'No access to Crystal Pulse',
    text: 'You are signed in to Crystal Core, but Crystal Pulse has not been granted to your account. Ask a developer to add it from your privileges screen in Crystal Core, then try again.',
  },
  invalid: {
    title: 'Sign-in link expired',
    text: 'The link from Crystal Core is valid for 60 seconds and this one has expired or was already used. Start again from the button below.',
  },
  core_unreachable: {
    title: 'Crystal Core did not answer',
    text: 'Pulse could not reach Crystal Core to confirm your sign-in. Check the internet connection and try again.',
  },
  not_configured: {
    title: 'Sign-in is not configured',
    text: 'This deployment has no CRYSTAL_CORE_URL or PULSE_SESSION_SECRET, so nobody can sign in. Set both (see .env.example) and redeploy, or set PULSE_AUTH=off for a display on a closed plant network.',
  },
  signed_out: {
    title: 'Signed out',
    text: 'You have been signed out of Crystal Pulse and Crystal Core.',
  },
};

export default function SignInPage({ searchParams }) {
  const error = typeof searchParams?.error === 'string' && ERRORS[searchParams.error] ? searchParams.error : '';
  const next = safeReturnPath(typeof searchParams?.next === 'string' ? searchParams.next : '/');
  const enabled = authEnabled();
  const problem = enabled ? configProblem() : null;
  const target = enabled && !problem ? launchUrl(next) : null;
  const message = error ? ERRORS[error] : problem ? ERRORS.not_configured : null;
  const forward = Boolean(target) && !error;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      {forward && (
        <script
          // Forward at once; the button below is the fallback when scripts are off.
          dangerouslySetInnerHTML={{ __html: `window.location.replace(${JSON.stringify(target)});` }}
        />
      )}
      <div className="w-full max-w-md rounded-2xl border border-white/[0.07] bg-white/[0.03] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
          <img src="/crystal-logo.jpeg" alt="Crystal" className="h-full w-full object-contain" />
        </div>
        <div className="mt-4 text-xl font-semibold text-white">Crystal Pulse</div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">Cold Storage · Dankuni Site</div>

        {message ? (
          <>
            <h1 className="mt-8 text-lg font-semibold text-white">{message.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{message.text}</p>
          </>
        ) : (
          <>
            <h1 className="mt-8 text-lg font-semibold text-white">{enabled ? 'Signing you in' : 'Sign-in is off'}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {enabled ? 'Taking you to Crystal Core to confirm who you are.' : 'This deployment runs without Crystal Core sign-in.'}
            </p>
          </>
        )}

        {target && (
          <a
            href={target}
            className="mt-8 inline-flex h-11 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-500/20 px-6 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-500/35"
          >
            {error ? 'Sign in through Crystal Core' : 'Continue'}
          </a>
        )}
        {!enabled && (
          <a
            href="/"
            className="mt-8 inline-flex h-11 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-500/20 px-6 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-500/35"
          >
            Open the dashboard
          </a>
        )}
        <p className="mt-6 text-[11px] text-slate-500">Access is managed in Crystal Core.</p>
      </div>
    </main>
  );
}

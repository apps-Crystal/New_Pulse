// Unit tests for lib/session.js - the Crystal Core sign-in glue. Pure: no network, no server.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SignJWT } = require('jose');

const SECRET = 'unit-test-session-secret-0123456789abcdef-xyz';

function fresh(env = {}) {
  for (const k of ['PULSE_AUTH', 'CRYSTAL_CORE_URL', 'PULSE_SESSION_SECRET', 'PULSE_SESSION_HOURS']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../lib/session')];
  return require('../lib/session');
}

beforeEach(() => { delete process.env.NODE_ENV; });

test('sign / verify round-trips the user and applies the session length', async () => {
  const s = fresh({ PULSE_SESSION_SECRET: SECRET, PULSE_SESSION_HOURS: '48' });
  const tok = await s.signSession({ userId: 'u-42', email: 'ops@crystalgroup.in', name: 'Ops', role: 'supervisor' });
  const u = await s.verifySession(tok);
  assert.equal(u.userId, 'u-42');
  assert.equal(u.email, 'ops@crystalgroup.in');
  assert.equal(u.name, 'Ops');
  assert.equal(u.role, 'supervisor');
  const hours = (u.expiresAt - Date.now()) / 3600000;
  assert.ok(hours > 47.9 && hours <= 48, `expires in ~48 h, got ${hours}`);
});

test('a tampered, foreign-purpose, wrong-secret or expired token is rejected', async () => {
  const s = fresh({ PULSE_SESSION_SECRET: SECRET });
  const good = await s.signSession({ userId: '1', email: 'a@b', name: 'A', role: 'x' });
  assert.equal(await s.verifySession(good.slice(0, -3) + 'abc'), null, 'tampered signature');
  assert.equal(await s.verifySession(''), null);
  assert.equal(await s.verifySession(null), null);

  const key = new TextEncoder().encode(SECRET);
  const foreign = await new SignJWT({ purpose: 'launch', email: 'a@b' }).setProtectedHeader({ alg: 'HS256' }).setSubject('1').setExpirationTime('1h').sign(key);
  assert.equal(await s.verifySession(foreign), null, 'a Core launch token is not a Pulse session');

  const expired = await new SignJWT({ purpose: 'pulse-session' }).setProtectedHeader({ alg: 'HS256' }).setSubject('1').setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(key);
  assert.equal(await s.verifySession(expired), null, 'expired');

  const other = await new SignJWT({ purpose: 'pulse-session' }).setProtectedHeader({ alg: 'HS256' }).setSubject('1').setExpirationTime('1h').sign(new TextEncoder().encode('another-secret-another-secret-another-secret'));
  assert.equal(await s.verifySession(other), null, 'signed with a different secret');
});

test('in production a missing or short secret fails closed', async () => {
  process.env.NODE_ENV = 'production';
  const s = fresh({ CRYSTAL_CORE_URL: 'https://core.example', PULSE_SESSION_SECRET: 'short' });
  assert.match(s.configProblem(), /PULSE_SESSION_SECRET/);
  await assert.rejects(() => s.signSession({ userId: '1', email: 'a@b', name: 'A', role: '' }));
  assert.equal(await s.verifySession('anything'), null);
});

test('configProblem: off => never a problem; on => needs CRYSTAL_CORE_URL', () => {
  assert.equal(fresh({ PULSE_AUTH: 'off' }).configProblem(), null);
  assert.equal(fresh({ PULSE_AUTH: 'OFF' }).authEnabled(), false);
  assert.equal(fresh({}).authEnabled(), true, 'unset means on');
  assert.match(fresh({ PULSE_SESSION_SECRET: SECRET }).configProblem(), /CRYSTAL_CORE_URL/);
  assert.equal(fresh({ PULSE_SESSION_SECRET: SECRET, CRYSTAL_CORE_URL: 'core.example/' }).configProblem(), null);
});

test('coreUrl tolerates a missing scheme and trailing slashes; launchUrl targets Core for "pulse"', () => {
  const s = fresh({ CRYSTAL_CORE_URL: 'crystal-core-official-version.vercel.app//', PULSE_SESSION_SECRET: SECRET });
  assert.equal(s.coreUrl(), 'https://crystal-core-official-version.vercel.app');
  const u = new URL(s.launchUrl('/reports?day=2026-09-16'));
  assert.equal(u.origin, 'https://crystal-core-official-version.vercel.app');
  assert.equal(u.pathname, '/api/sso/launch');
  assert.equal(u.searchParams.get('system'), 'pulse');
  assert.equal(u.searchParams.get('return'), '/reports?day=2026-09-16');
  assert.equal(new URL(s.launchUrl('/')).searchParams.get('return'), null, 'no return param for the home page');
  assert.equal(fresh({}).launchUrl('/'), null, 'no Core URL, no launch URL');
});

test('safeReturnPath only accepts same-origin paths outside the sign-in flow', () => {
  const s = fresh({});
  assert.equal(s.safeReturnPath('/reports'), '/reports');
  assert.equal(s.safeReturnPath('/reports?day=1#x'), '/reports?day=1#x');
  for (const bad of ['', null, 'https://evil.example', '//evil.example/x', '/\\evil.example', 'reports', '/x\r\nSet-Cookie: a=b', '/sso?token=x', '/signin', '/signout', '/signin?x=1']) {
    assert.equal(s.safeReturnPath(bad), '/', `rejects ${JSON.stringify(bad)}`);
  }
});

test('isPublicPath: sign-in flow, assets and /api/health are open; everything else is gated', () => {
  const s = fresh({});
  for (const open of ['/sso', '/signin', '/signout', '/api/health', '/favicon.ico', '/crystal-logo.jpeg', '/_next/static/chunks/x.js', '/robots.txt']) assert.equal(s.isPublicPath(open), true, open);
  for (const gated of ['/', '/reports', '/api/plc', '/api/reports/pdf', '/api/rooms', '/api/live', '/api/health/x', '/api/x.json', '/ssoevil', undefined]) assert.equal(s.isPublicPath(gated), false, String(gated));
});

test('parseCookie reads one cookie from a raw header', () => {
  const s = fresh({});
  assert.equal(s.parseCookie('a=1; pulse_session=abc.def; b=2', 'pulse_session'), 'abc.def');
  assert.equal(s.parseCookie('a=1', 'pulse_session'), null);
  assert.equal(s.parseCookie(undefined, 'pulse_session'), null);
  assert.equal(s.parseCookie('pulse_session=%7Bx%7D', 'pulse_session'), '{x}');
});

test('requestOrigin comes from the Host the browser used, never the bind address', () => {
  const s = fresh({});
  const req = (headers, protocol = 'http:') => ({ headers: new Map(Object.entries(headers)), nextUrl: { origin: `${protocol}//0.0.0.0:3000`, protocol } });
  assert.equal(s.requestOrigin(req({ host: '192.168.0.10:3000' })), 'http://192.168.0.10:3000');
  assert.equal(s.requestOrigin(req({ host: 'crystal-pulse.vercel.app', 'x-forwarded-proto': 'https' })), 'https://crystal-pulse.vercel.app');
  assert.equal(s.requestOrigin(req({ 'x-forwarded-host': 'crystal-pulse.vercel.app', host: 'internal', 'x-forwarded-proto': 'https' })), 'https://crystal-pulse.vercel.app');
  assert.equal(s.requestOrigin(req({ host: 'evil host/../x' })), 'http://0.0.0.0:3000', 'a malformed Host falls back');
  assert.equal(s.requestOrigin(req({})), 'http://0.0.0.0:3000');
});

test('cookieOptions: Secure follows the request protocol, week-long by default', () => {
  const s = fresh({});
  assert.deepEqual(s.cookieOptions(true), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 168 * 3600 });
  assert.equal(s.cookieOptions(false).secure, false);
  assert.equal(s.requestIsHttps({ headers: new Map([['x-forwarded-proto', 'https']]), nextUrl: { protocol: 'http:' } }), true);
  assert.equal(s.requestIsHttps({ headers: new Map(), nextUrl: { protocol: 'http:' } }), false);
});

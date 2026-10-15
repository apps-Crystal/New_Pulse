const test = require('node:test');
const assert = require('node:assert/strict');
const { kindOf, fmtDur, alarmStatus } = require('../lib/alarm-status');

const when = (iso) => `@${iso.slice(11, 19)}`;

test('alarm-status: a door alarm shows how long the door was open, or has been open so far', () => {
  const closed = { id: 1, message: 'Chiller Room 1 Door 2 Open', at: '2026-10-15T04:00:00.000Z', resetAt: '2026-10-15T04:04:12.000Z', active: false, state: 'reset' };
  assert.deepEqual(alarmStatus(closed, Date.parse('2026-10-15T05:00:00Z'), when), { text: 'Was open 4 min 12 s', tone: 'ok' });
  const open = { ...closed, resetAt: null, active: true };
  assert.deepEqual(alarmStatus(open, Date.parse('2026-10-15T04:12:00Z'), when), { text: 'Open for 12 min \u00b7 still open', tone: 'bad' });
  assert.deepEqual(alarmStatus(open, null, when), { text: 'Still open', tone: 'bad' }, 'before the client clock is known');
  assert.deepEqual(alarmStatus({ ...closed, resetAt: null, state: '' }, 0, when), { text: 'cleared', tone: 'muted' });
});

test('alarm-status: a temperature alarm says whether it is resolved; other alarms keep Active / Reset', () => {
  const low = { id: 2, message: 'Chiller Room 2 Temp Low', at: '2026-10-15T04:00:00.000Z', resetAt: null, active: true, state: 'On' };
  assert.deepEqual(alarmStatus(low, 1, when), { text: 'Not resolved', tone: 'bad' });
  assert.deepEqual(alarmStatus({ ...low, active: false, resetAt: '2026-10-15T04:30:00.000Z' }, 1, when), { text: 'Resolved @04:30:00', tone: 'ok' });
  const panic = { id: 3, message: 'Panic Button 1', at: '2026-10-15T04:00:00.000Z', resetAt: '2026-10-15T04:01:00.000Z', active: false, state: 'reset' };
  assert.deepEqual(alarmStatus(panic, 1, when), { text: 'Reset @04:01:00', tone: 'muted' });
  assert.deepEqual(alarmStatus({ ...panic, active: true }, 1, when), { text: 'Active', tone: 'bad' });
  assert.equal(kindOf('Phase Preventer Fault'), 'other');
});

test('alarm-status: durations read naturally', () => {
  assert.equal(fmtDur(45 * 1000), '45 s');
  assert.equal(fmtDur(4 * 60000 + 12 * 1000), '4 min 12 s');
  assert.equal(fmtDur(7 * 60000), '7 min');
  assert.equal(fmtDur(65 * 60000), '1 h 05 min');
  assert.equal(fmtDur(2 * 3600000), '2 h');
  assert.equal(fmtDur(-5), '\u2014');
  assert.equal(fmtDur(NaN), '\u2014');
});

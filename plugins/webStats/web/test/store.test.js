import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '../lib/store.js';

const MIN = 60 * 1000;

function feed() {
  let seq = 0;
  const base = { server: 'bz.example:5154', run: '1' };
  return (type, t, fields = {}) => ({ ...base, seq: ++seq, t, type, ...fields });
}

test('stats, sessions and notification decisions', () => {
  const store = new Store(':memory:');
  const ev = feed();
  const alice = { callsign: 'Alice', bzid: '42', team: 'red' };
  const bob = { callsign: 'Bob', bzid: '', team: 'blue' };
  const t0 = Date.UTC(2026, 8, 1, 18, 0);

  const first = store.ingest([
    ev('server-start', t0, { description: 'Test', players: [] }),
    ev('join', t0 + MIN, { pid: 0, ...alice, players: 1 }),
    ev('game-open', t0 + MIN, { pid: 0, ...alice }),
    ev('join', t0 + 2 * MIN, { pid: 1, ...bob, players: 2 }),
    ev('join', t0 + 2 * MIN, { pid: 2, callsign: 'Watcher', bzid: '', team: 'observer', players: 2 }),
    ev('kill', t0 + 3 * MIN, { victimPid: 1, victimCallsign: 'Bob', victimBzid: '', victimTeam: 'blue',
      killerPid: 0, killerCallsign: 'Alice', killerBzid: '42', killerTeam: 'red', flag: 'GM', teamKill: false }),
    ev('kill', t0 + 4 * MIN, { victimPid: 1, victimCallsign: 'Bob', victimBzid: '', victimTeam: 'blue',
      killerPid: 1, killerCallsign: 'Bob', killerBzid: '', killerTeam: 'blue', flag: '', teamKill: false }),
    ev('flag', t0 + 4 * MIN, { playerPid: 0, playerCallsign: 'Alice', playerBzid: '42', flag: 'GM' }),
    ev('capture', t0 + 5 * MIN, { playerPid: 0, playerCallsign: 'Alice', playerBzid: '42', teamCapped: 'blue' }),
    ev('chat', t0 + 5 * MIN, { kind: 'public', fromPid: 1, fromCallsign: 'Bob', fromBzid: '', message: 'gg' }),
    ev('part', t0 + 11 * MIN, { pid: 0, ...alice, players: 1 }),
    ev('part', t0 + 12 * MIN, { pid: 1, ...bob, players: 0 }),
    ev('game-empty', t0 + 12 * MIN),
  ]);
  assert.equal(first.length, 13);
  assert.equal(first.find((a) => a.event.type === 'game-open').notify, true);

  // re-sending the same batch (plugin retry, file import) changes nothing
  assert.equal(store.ingest(first.map((a) => a.event)).length, 0);

  const a = store.player('bz:42');
  assert.equal(a.player.kills, 1);
  assert.equal(a.player.captures, 1);
  assert.equal(a.player.playtime_ms, 10 * MIN);
  assert.equal(a.player.sessions_opened, 1);
  assert.deepEqual(a.victims.map((v) => [v.callsign, v.count]), [['Bob', 1]]);
  assert.deepEqual(a.flags.map((f) => [f.flag, f.count]), [['GM', 1]]);

  const b = store.player('cs:bob');
  assert.equal(b.player.deaths, 2);
  assert.equal(b.player.suicides, 1);
  assert.equal(b.player.kills, 0);
  assert.equal(b.player.messages, 1);
  assert.equal(b.player.playtime_ms, 10 * MIN);
  assert.deepEqual(b.killers.map((k) => k.callsign), ['Alice']);

  // observers are online but earn no play time and do not join sessions
  assert.equal(store.player('cs:watcher').player.playtime_ms, 0);
  assert.deepEqual(store.online().map((o) => o.callsign), ['Watcher']);

  const [session] = store.sessions();
  assert.equal(session.opener, 'Alice');
  assert.equal(session.peak, 2);
  assert.equal(session.closed_at, t0 + 12 * MIN);
  assert.deepEqual(session.players.map((p) => p.callsign).sort(), ['Alice', 'Bob']);

  // a reopen within the cooldown does not notify again, later it does
  const again = store.ingest([
    ev('join', t0 + 15 * MIN, { pid: 0, ...alice, players: 1 }),
    ev('game-open', t0 + 15 * MIN, { pid: 0, ...alice }),
    ev('part', t0 + 16 * MIN, { pid: 0, ...alice, players: 0 }),
    ev('game-empty', t0 + 16 * MIN),
  ], { notifyCooldownMs: 10 * MIN });
  assert.equal(again.find((x) => x.event.type === 'game-open').notify, false);
  const later = store.ingest([ev('game-open', t0 + 60 * MIN, { pid: 0, ...alice })], { notifyCooldownMs: 10 * MIN });
  assert.equal(later[0].notify, true);

  // history filters
  assert.equal(store.events({ player: 'cs:bob', types: ['kill'] }).length, 2);
  assert.equal(store.events({ q: 'gg' }).length, 1);
  assert.deepEqual(store.players({ sort: 'kills' }).map((p) => p.callsign)[0], 'Alice');
  store.close();
});

test('a server restart closes what the old run left open', () => {
  const store = new Store(':memory:');
  const ev = feed();
  const t0 = Date.UTC(2026, 8, 1, 18, 0);
  store.ingest([
    ev('server-start', t0, { players: [] }),
    ev('join', t0, { pid: 0, callsign: 'Alice', bzid: '', team: 'red', ip: '10.0.0.1', players: 1 }),
    ev('game-open', t0, { pid: 0, callsign: 'Alice', bzid: '', team: 'red' }),
    ev('log', t0 + 5 * MIN, { level: 0, message: 'still alive' }),
  ]);
  // bzfs crashed: no part, no server-stop. The next run starts over.
  store.ingest([{ server: 'bz.example:5154', run: '2', seq: 1, t: t0 + 30 * MIN, type: 'server-start', players: [] }]);
  assert.equal(store.online().length, 0);
  assert.equal(store.player('cs:alice').player.playtime_ms, 5 * MIN);
  assert.equal(store.sessions()[0].closed_at, t0 + 5 * MIN);
  // private fields never leave through the API
  assert.equal(store.events({ types: ['join'] })[0].ip, undefined);
  store.close();
});

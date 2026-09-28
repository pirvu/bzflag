import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encryptPayload, loadOrCreateVapidKeys, vapidAuthorization } from '../lib/webpush.js';

// Decrypts like a browser would (RFC 8291), to check the sender side
function decrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  assert.equal(rs, 4096);

  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last record delimiter');
  return plain.subarray(0, -1).toString();
}

test('payload round trips through aes128gcm', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const payload = JSON.stringify({ title: 'BZFlag', body: 'Ăla a intrat pe server' });
  const body = encryptPayload(payload, ua.getPublicKey('base64url'), auth.toString('base64url'));
  assert.equal(decrypt(body, ua, auth), payload);
});

test('matches the RFC 8291 section 5 example', () => {
  const b = (s) => Buffer.from(s, 'base64url');
  const ua = crypto.createECDH('prime256v1');
  ua.setPrivateKey(b('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'));
  const as = crypto.createECDH('prime256v1');
  as.setPrivateKey(b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
  const body = encryptPayload('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg', { salt: b('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys: as });
  assert.equal(body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('VAPID header is a valid ES256 JWT for the push service origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webstats-'));
  const vapid = loadOrCreateVapidKeys(dir);
  assert.deepEqual(loadOrCreateVapidKeys(dir).publicKey, vapid.publicKey, 'keys persist');

  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 'mailto:a@b.c');
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [h, c, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:a@b.c');
  assert.ok(claims.exp > Date.now() / 1000);

  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') },
    format: 'jwk',
  });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  fs.rmSync(dir, { recursive: true });
});

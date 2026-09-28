// Minimal Web Push sender (RFC 8030 / 8291 / 8292) on top of node:crypto,
// so the web service needs no npm dependencies.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (str) => Buffer.from(str, 'base64url');

export function loadOrCreateVapidKeys(dataDir) {
  const file = path.join(dataDir, 'vapid.json');
  let jwk;
  if (fs.existsSync(file)) {
    jwk = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    jwk = privateKey.export({ format: 'jwk' });
    fs.writeFileSync(file, JSON.stringify(jwk, null, 2), { mode: 0o600 });
  }
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  return { privateKey, publicKey: b64u(publicKey) };
}

export function vapidAuthorization(endpoint, vapid, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapid.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${vapid.publicKey}`;
}

// aes128gcm content encoding, a single record (RFC 8291 section 3.4)
export function encryptPayload(payload, p256dh, auth, { salt, serverKeys } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  salt = salt || crypto.randomBytes(16);

  const ecdh = serverKeys || crypto.createECDH('prime256v1');
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

// Returns { ok, status, gone } where gone means the subscription must be dropped
export async function sendPush(subscription, payload, vapid, subject, { ttl = 3600, urgency = 'high' } = {}) {
  const body = encryptPayload(JSON.stringify(payload), subscription.p256dh, subscription.auth);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

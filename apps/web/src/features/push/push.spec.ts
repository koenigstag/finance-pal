import { describe, expect, it } from 'vitest';
import { matchesServerKey, toRegistration, urlBase64ToUint8Array } from './push';

// A VAPID public key as the API sends it: base64url, unpadded, 65 bytes once decoded.
const PUBLIC_KEY = 'BNbxGYNzrbT5m7e5Hm0-HyoFmgjRe8KUEOkgxNAqLb5m3RUcVqBRpRLrbMLLBzUEZZ5wUuZdU0dFfK5gJvvnKnQ';

describe('urlBase64ToUint8Array', () => {
  it('decodes a key the browser can subscribe with', () => {
    const bytes = urlBase64ToUint8Array(PUBLIC_KEY);

    // An uncompressed P-256 point: 65 bytes starting with 0x04.
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('reads the url-safe alphabet, which plain base64 decoding would not', () => {
    // "-" and "_" stand in for "+" and "/".
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });

  it('pads what the API leaves unpadded, and leaves a whole group alone', () => {
    expect(Array.from(urlBase64ToUint8Array('AQI'))).toEqual([1, 2]);
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  });
});

describe('matchesServerKey', () => {
  const subscriptionWith = (key: ArrayBuffer | null) =>
    ({ options: { applicationServerKey: key } }) as unknown as PushSubscription;

  it('recognises a subscription made against the key in use', () => {
    const key = urlBase64ToUint8Array(PUBLIC_KEY);

    expect(matchesServerKey(subscriptionWith(key.buffer), PUBLIC_KEY)).toBe(true);
  });

  it('spots one made against a key the API has moved on from', () => {
    const other = urlBase64ToUint8Array(PUBLIC_KEY.replace('BNbx', 'BOcy'));

    expect(matchesServerKey(subscriptionWith(other.buffer), PUBLIC_KEY)).toBe(false);
  });

  it('leaves a subscription alone where the browser does not say which key it used', () => {
    expect(matchesServerKey(subscriptionWith(null), PUBLIC_KEY)).toBe(true);
  });
});

describe('toRegistration', () => {
  const subscriptionOf = (json: unknown) => ({ toJSON: () => json }) as unknown as PushSubscription;

  it('takes the endpoint and both keys', () => {
    const registration = toRegistration(
      subscriptionOf({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key', auth: 'secret' } }),
    );

    expect(registration).toEqual({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key', auth: 'secret' } });
  });

  it('refuses one without the keys a payload would be encrypted to', () => {
    expect(toRegistration(subscriptionOf({ endpoint: 'https://push.example/abc' }))).toBeNull();
    expect(toRegistration(subscriptionOf({ endpoint: 'https://push.example/abc', keys: { p256dh: 'key' } }))).toBeNull();
  });
});

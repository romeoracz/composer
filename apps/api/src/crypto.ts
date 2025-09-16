import crypto from 'crypto';

function getKey(): Buffer {
  const b64 = process.env.SECRET_ENC_KEY || '';
  if (!b64) throw new Error('SECRET_ENC_KEY not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('SECRET_ENC_KEY must be 32 bytes (base64 of 32 bytes)');
  return key;
}

export function encryptJson(value: unknown) {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };
}

export function decryptJson(payload: { alg: string; iv: string; tag: string; ct: string }) {
  if (!payload || payload.alg !== 'AES-256-GCM') throw new Error('unsupported_alg');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ct = Buffer.from(payload.ct, 'base64');
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

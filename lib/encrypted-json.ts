import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ENCRYPTION_VERSION = 'v1';

function encryptionKey() {
  const raw = process.env.CRM_CREDENTIAL_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error('crm_encryption_key_missing');
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  try {
    const decoded = Buffer.from(raw, 'base64');

    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to hashing the configured secret.
  }

  return createHash('sha256').update(raw).digest();
}

export function encryptJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [ENCRYPTION_VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptJson<T = unknown>(encryptedValue?: string | null): T | null {
  if (!encryptedValue) {
    return null;
  }

  const [version, ivValue, tagValue, encrypted] = encryptedValue.split(':');

  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !encrypted) {
    throw new Error('crm_credentials_invalid_ciphertext');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));

  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

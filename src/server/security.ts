import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
const scrypt = (password:string,salt:string) => new Promise<Buffer>((resolve,reject) => scryptCallback(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,key) => error ? reject(error) : resolve(key)));
export const token = () => randomBytes(32).toString('base64url');
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt);
  return `scrypt:131072:8:1:${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = encoded.split(':');
  if (kind !== 'scrypt' || n!=='131072' || r!=='8' || p!=='1' || !salt || !key || !/^[a-f0-9]{128}$/.test(key)) return false;
  const derived = await scrypt(password, salt);
  return timingSafeEqual(derived, Buffer.from(key, 'hex'));
}
function encryptionKey() {
  const key = Buffer.from(process.env.ACCESS_ENCRYPTION_KEY ?? '', 'hex');
  if (key.length !== 32) throw new Error('ACCESS_ENCRYPTION_KEY muss lokal eingerichtet werden (64 Hex-Zeichen).');
  return key;
}
export function encrypt(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${payload.toString('hex')}`;
}
export function decrypt(value: string): string {
  const [iv, tag, payload] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(payload, 'hex')), cipher.final()]).toString('utf8');
}
export function rateKey(value: string): string {
  const key = process.env.RATE_LIMIT_HMAC_KEY;
  if (!key || key.length < 32) throw new Error('RATE_LIMIT_HMAC_KEY muss lokal eingerichtet werden.');
  return createHmac('sha256', key).update(value).digest('hex');
}

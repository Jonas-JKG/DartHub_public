import { scryptSync, randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
let hiding = false;
terminal._writeToOutput = function (value) { if (!hiding) process.stdout.write(value); };
process.stdout.write('Neues Owner-Passwort (mindestens 12 Zeichen, Eingabe verborgen): ');
hiding = true;
const password = await new Promise(resolve => terminal.question('', resolve));
hiding = false; terminal.close(); process.stdout.write('\n');
if (password.length < 12 || password.length > 200) { console.error('Bitte 12–200 Zeichen verwenden.'); process.exit(1); }
const salt = randomBytes(16).toString('hex');
const hash = `scrypt:131072:8:1:${salt}:${scryptSync(password, salt, 64, {N:131072,r:8,p:1,maxmem:256*1024*1024}).toString('hex')}`;
let env = await readFile('.env.local', 'utf8').catch(() => '');
const values = { OWNER_PASSWORD_HASH: hash };
for (const name of ['ACCESS_ENCRYPTION_KEY', 'RATE_LIMIT_HMAC_KEY']) if (!new RegExp(`^${name}=.{32,}$`, 'm').test(env)) values[name] = randomBytes(32).toString('hex');
for (const [name, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, `${name}=${value}`) : `${env}\n${name}=${value}\n`;
}
await writeFile('.env.local', env);
console.log('Owner-Hash und erforderliche Server-Schlüssel sind lokal gespeichert. Keine Geheimnisse wurden ausgegeben.');

// Dev-only: create a stable extension identity for a locally loaded extension.
// Writes the private key under native/dev/ (git-ignored) and patches the
// manifest's `key` field with the base64 DER (SPKI) public key. The extension
// ID is sha256(DER)[0..15] with each hex nibble mapped 0-f -> a-p.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const keyDir = path.join(here, 'dev');
const keyFile = path.join(keyDir, 'extension-key.pem');
const manifestFile = path.join(repo, 'manifest.json');

function extensionId(der) {
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
}

fs.mkdirSync(keyDir, { recursive: true });
let der;
if (fs.existsSync(keyFile)) {
  const pem = fs.readFileSync(keyFile, 'utf8');
  der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
} else {
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.writeFileSync(keyFile, pair.privateKey, { mode: 0o600 });
  der = pair.publicKey;
}

const base64 = Buffer.from(der).toString('base64');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.key = base64;
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ keyFile: path.relative(repo, keyFile), derSha256:
  crypto.createHash('sha256').update(der).digest('hex'), extensionId: extensionId(der) }));

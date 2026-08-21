import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';

// Minimal .env loader so the server has no dotenv dependency.
export function loadEnv() {
  const path = join(process.cwd(), '.env');
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let value = m[2];
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
  ensureJwtSecret(path);
}

// A guessable JWT secret would let anyone on the LAN forge admin tokens.
// Generate a strong one on first boot and persist it so sessions survive restarts.
function ensureJwtSecret(envPath: string) {
  // Placeholders — including the one shipped in .env.example — count as unset.
  const PLACEHOLDERS = ['dev-secret', 'change-me'];
  const current = process.env.JWT_SECRET;
  if (current && !PLACEHOLDERS.includes(current)) return;
  const secret = randomBytes(32).toString('hex');
  try {
    const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    // Rewrite an existing placeholder line rather than appending: the loader
    // keeps the FIRST occurrence, so a second JWT_SECRET would be ignored.
    const next = /^\s*JWT_SECRET\s*=/m.test(text)
      ? text.replace(/^\s*JWT_SECRET\s*=.*$/m, `JWT_SECRET=${secret}`)
      : (text && !text.endsWith('\n') ? text + '\n' : text) + `JWT_SECRET=${secret}\n`;
    writeFileSync(envPath, next);
    process.env.JWT_SECRET = secret;
    console.log('[env] Generated and persisted a new JWT_SECRET in .env');
  } catch (e) {
    // Can't persist (read-only fs?) — still use the strong secret for this run.
    process.env.JWT_SECRET = secret;
    console.warn(`[env] Could not persist JWT_SECRET (${e}); sessions will reset on restart`);
  }
}

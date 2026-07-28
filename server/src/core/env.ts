import { readFileSync, existsSync, appendFileSync } from 'fs';
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
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'dev-secret') return;
  const secret = randomBytes(32).toString('hex');
  try {
    appendFileSync(envPath, `${existsSync(envPath) ? '\n' : ''}JWT_SECRET=${secret}\n`);
    process.env.JWT_SECRET = secret;
    console.log('[env] Generated and persisted a new JWT_SECRET in .env');
  } catch (e) {
    // Can't persist (read-only fs?) — still use the strong secret for this run.
    process.env.JWT_SECRET = secret;
    console.warn(`[env] Could not persist JWT_SECRET (${e}); sessions will reset on restart`);
  }
}

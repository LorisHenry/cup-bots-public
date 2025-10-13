// utils/load_env.mjs
// Minimal .env loader for ESM without external deps.
// On import, reads ../.env (project root) and populates process.env keys that are not already set.
import fs from 'fs';
import path from 'path';
import url from 'url';

function parseLine(line) {
  // Ignore comments and empty lines
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return null;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  // Remove surrounding quotes if present
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return { key, val };
}

(function loadEnv() {
  try {
    // Resolve project root from this file location
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(__dirname, '..');
    const envPath = path.join(projectRoot, '.env');
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const kv = parseLine(rawLine);
      if (!kv) continue;
      if (process.env[kv.key] === undefined) {
        process.env[kv.key] = kv.val;
      }
    }
    // Optional: indicate loaded
    // console.log('Loaded .env');
  } catch (e) {
    // Silently ignore to avoid crashing if .env missing
    // console.warn('Could not load .env:', e.message);
  }
})();

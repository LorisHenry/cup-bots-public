// launcher/v1/watch_top_message.mjs
/**
 * Watches a forum/topic page and reacts only when the TOP message changes.
 *
 * How it works
 * - Periodically scrapes TARGET_URL using the v2 scraper (handles login/cookies automatically).
 * - Extracts the top message (div.search.postbg1/2) and its timestamp via analyzeHtml.
 * - Compares the new top with the previously seen one using a content hash and timestamp check
 *   (must be different AND newer to avoid false positives due to deletions/edits).
 * - When a new top message is detected, scans it for a Google Forms link; if found, attempts a
 *   best‑effort auto‑submission (see FORM_PAYLOAD_JSON for entry mappings).
 *
 * Env variables
 * - TARGET_URL: The page to scrape.
 * - SCRAPE_INTERVAL_MS: Optional; how often to check (default 15000 ms).
 * - HTML_PAGE_DEBUG: When set to a non-'false' value, treated as a local file path to mock the HTML page.
 * - See main/scraper.mjs for auth/login/env details.
 */
import '../utils/load_env.mjs';
import fs from 'fs';
import { scrapePage, analyzeHtml, detectTicketSale, autoSubmitGoogleForm } from '../main/scraper.mjs';
import { sendNotification } from '../main/v1/notification_sender.mjs';

const TARGET_URL = process.env.TARGET_URL;
const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS || 150000);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const NTFY_URL = process.env.NTFY_URL || process.env.NFTY_URL || '';

if (!TARGET_URL) {
  console.error('Missing TARGET_URL env. Exiting.');
  process.exit(1);
}

console.log(`🚀 Watching top message on: ${TARGET_URL}`);
console.log(`⏱️ Interval: ${SCRAPE_INTERVAL_MS} ms`);

let lastTop = null; // { textHash, timestamp, timestampMs }
let progress=0;

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

// Parse forum timestamp text into epoch milliseconds.
// Supports ISO-like strings and French phpBB pattern like:
// "jeu. oct. 09, 2025 4:44 pm"
function parseForumTimestampToMs(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  // 1) Try native parser first (handles ISO and many locales)
  const native = Date.parse(trimmed);
  if (!Number.isNaN(native)) return native;

  // 2) Custom French format parser
  // Normalize: lowercase, collapse spaces, drop commas
  let lower = trimmed.toLowerCase().replace(/\s+/g, ' ').replace(/,/g, '').trim();

  // Remove leading weekday token if present (e.g., "lun.", "mar.", ...)
  const weekdays = new Set(['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim']);
  let parts = lower.split(' ');
  if (parts.length && weekdays.has(parts[0])) {
    parts = parts.slice(1);
  }

  // Expect: <month> <day> <year> <hh:mm> [am|pm]
  if (parts.length < 3) return null;

  const monthMap = {
    'janv.': 0, 'jan.': 0, 'janvier': 0,
    'févr.': 1, 'fevr.': 1, 'fev.': 1, 'février': 1, 'fevrier': 1, 'fév.': 1,
    'mars': 2,
    'avr.': 3, 'avril': 3,
    'mai': 4,
    'juin': 5,
    'juil.': 6, 'juillet': 6,
    'août': 7, 'aout': 7,
    'sept.': 8, 'septembre': 8,
    'oct.': 9, 'octobre': 9,
    'nov.': 10, 'novembre': 10,
    'déc.': 11, 'dec.': 11, 'décembre': 11, 'decembre': 11,
  };

  const monthToken = parts[0];
  const monthIdx = monthMap[monthToken];
  if (monthIdx === undefined) return null;

  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;

  let hour = 0, minute = 0;
  let ampm = '';
  if (parts[3]) {
    const hm = parts[3].split(':');
    hour = parseInt(hm[0], 10);
    minute = parseInt((hm[1] || '0'), 10);
  }
  if (parts[4]) ampm = parts[4];

  if (ampm.includes('pm') && hour < 12) hour += 12;
  if (ampm.includes('am') && hour === 12) hour = 0;

  const d = new Date(year, monthIdx, day, hour, minute, 0, 0);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Normalize a string for case/diacritic-insensitive comparisons.
 */
function norm(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Parse WHITEWORDS env: a JSON dictionary { subforumName: [terms...] }
 */
function loadWhitelist() {
  try {
    const raw = process.env.WHITEWORDS;
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn('⚠️ Could not parse WHITEWORDS env JSON. Using empty whitelist.', e.message);
    return {};
  }
}

/**
 * Check if title contains any whitelisted term for the given forum/subforum name.
 */
function titleMatchesWhitelist(forumName, title, wl) {
  const list = wl[forumName] || [];
  if (!Array.isArray(list) || list.length === 0) return false;
  const nt = norm(title);
  return list.some(term => nt.includes(norm(term)));
}

/**
 * Handle newly detected top message.
 * Encapsulates side effects so we can extend this pipeline later (logging, notifications,
 * persistence, multi-channel actions, etc.).
 *
 * Categories:
 * - No Google Form → ignore (do nothing).
 * - Google Form + title includes whitelisted term for the subforum → log + notify + auto-submit.
 * - Google Form + no whitelist match → log + notify only.
 *
 * @param {{messageHtml:string, messageText:string, timestamp?:string, forumName?:string, title?:string}} top
 * @param {string} textHash
 * @param {string} ts
 * @param {number|null} tsMs
 */
async function handleNewTopMessage(top, textHash, ts, tsMs) {
  console.log('🆕 New top message detected.');
  lastTop = { textHash, timestamp: ts, timestampMs: tsMs };

  const formsUrl = detectTicketSale(top.messageHtml) || detectTicketSale(top.messageText);
  if (!formsUrl) {
    console.log('🚫 No Google Forms link found → skipping.');
    return; // Category 1: pass
  }

  const whitelist = loadWhitelist();
  const forumName = top.forumName || '';
  const title = top.title || '';

  const header = `🎟️ Google Form found\n• Subforum: ${forumName || 'N/A'}\n• Title: ${title || 'N/A'}\n• URL: ${formsUrl}`;
  const bodySnippet = (top.messageText || '').slice(0, 500);
  const fullMessage = `${header}\n\nMessage:\n${bodySnippet}`;

  const isWhitelisted = titleMatchesWhitelist(forumName, title, whitelist);

  // Always log and notify when a Google Form is present
  console.log(fullMessage);
  try {
    await sendNotification(fullMessage, DISCORD_WEBHOOK_URL, NTFY_URL);
  } catch (e) {
    console.warn('⚠️ Notification send failed:', e.message);
  }

  if (isWhitelisted) {
    console.log('✅ Title matches whitelist for this subforum → attempting auto form submission.');
    const res = await autoSubmitGoogleForm(formsUrl);
    console.log(`📤 Auto-submission result: ${res.submitted ? 'OK' : 'FAILED'} (${res.message}${res.status ? `, status ${res.status}` : ''})`);
  } else {
    console.log('ℹ️ Title not in whitelist for this subforum → notification only, no auto-submit.');
  }
}

async function tick() {
  try {
    let html;
    const debugPath = process.env.HTML_PAGE_DEBUG;
    if (debugPath && String(debugPath).toLowerCase() !== 'false' && progress === 1) {
      // Use local HTML file to mock the scraped page
      html = fs.readFileSync(debugPath, 'utf-8');
      console.log(`🧪 Using local HTML mock from: ${debugPath}`);
    } else {
      html = await scrapePage(TARGET_URL, { maxRetries: 5, delayMs: 5000 });
    }
    progress++;

    const top = analyzeHtml(html);
    if (!top) {
      console.log('ℹ️ No messages found (div.search.postbg1/2).');
      return;
    }

    const textHash = hashString(top.messageText || top.messageHtml || '');
    const ts = top.timestamp || '';
    const tsMs = parseForumTimestampToMs(ts);

    // First tick: initialize without triggering
    if (!lastTop) {
      lastTop = { textHash, timestamp: ts, timestampMs: tsMs };
      console.log('✅ Initialized lastTop.');
      return;
    }

    const isDifferent = textHash !== lastTop.textHash;
    const isNewer = (tsMs != null && lastTop.timestampMs != null)
      ? (tsMs > lastTop.timestampMs)
      : isDifferent;

    if (isDifferent && isNewer) {
      await handleNewTopMessage(top, textHash, ts, tsMs);
    } else {
      // not new, ignore
      console.debug('No new top message.');
    }
  } catch (e) {
    console.error('❌ Tick error:', e.message);
  }
}

// initial run + interval
(async () => {
  await tick();
  setInterval(tick, SCRAPE_INTERVAL_MS);
})();

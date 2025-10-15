// main/scraper.mjs
// High-level scraping and analysis utilities (v2)
/**
 * Module: main/scraper.mjs (v2)
 *
 * What this module does
 * - Provides an authenticated page scraper that automatically handles cookies and login.
 * - Exposes helpers to analyze forum HTML to find the top message and its timestamp.
 * - Detects Google Forms links (used as a proxy for “ticket sale open”).
 * - Can attempt a best‑effort auto‑submission of a detected Google Form.
 *
 * How authentication works
 * - Before scraping, previously saved cookies (COOKIE_FILE) are read and sent.
 * - If the request is redirected to the login page or the returned HTML looks like a login page,
 *   we submit the login form using FORUM_USER and FORUM_PASS at BASE_FORUM_URL to obtain fresh cookies.
 * - Fresh cookies are saved into COOKIE_FILE and the original request is retried.
 * - On repeated unexpected errors, the process exits with code 1 so that an external supervisor can restart it.
 *
 * Environment variables
 * - BASE_FORUM_URL: Base URL of the forum (e.g., https://example.com/forum/). Required for login.
 * - FORUM_USER / FORUM_PASS: Credentials used when a login is needed.
 * - COOKIE_FILE: Optional path to a file where session cookies are persisted (default: .session_cookies.txt).
 * - FORM_PAYLOAD_JSON: Optional JSON object mapping Google Forms entry.* names to values for auto‑submit.
 *
 * Key exports
 * - scrapePage(url, {maxRetries, delayMs}) → string HTML
 * - analyzeHtml(html) → { messageHtml, messageText, timestamp, containerClass } | null
 * - detectTicketSale(htmlOrText) → first Google Forms URL | null
 * - autoSubmitGoogleForm(formUrl) → { ok, submitted, status?, message }
 */
import fetch from 'node-fetch';
import { load } from 'cheerio';
import fs from 'fs';

/**
 * Fetch page HTML for a given URL with cookie handling and login fallback.
 * Flow:
 * - Read cookies from file (COOKIE_FILE or .session_cookies.txt) if present and try request.
 * - If redirected to login or login page detected, perform login using FORUM_USER/FORUM_PASS at BASE_FORUM_URL.
 * - Persist cookies to file and retry once.
 * - On unexpected errors, log and exit(1).
 * @param {string} url
 * @param {object} opts
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.delayMs=3000]
 * @returns {Promise<string>} HTML text
 */
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) cup-bots/1.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const COOKIE_FILE = process.env.COOKIE_FILE || '.session_cookies.txt';
const BASE_FORUM_URL = process.env.BASE_FORUM_URL || '';

function readCookieFile() {
  try {
    const s = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
    return s;
  } catch {
    return '';
  }
}

function writeCookieFile(cookies) {
  try {
    fs.writeFileSync(COOKIE_FILE, cookies, 'utf-8');
    console.log(`🔐 Stored cookies to ${COOKIE_FILE}`);
  } catch (e) {
    console.warn(`⚠️ Could not write cookie file ${COOKIE_FILE}: ${e.message}`);
  }
}

function looksLikeLoginPage(html) {
  if (!html) return false;
  const lower = html.toLowerCase();
  const markers = [
    'ucp.php?mode=login',
    'name="username"',
    'name="password"',
    'id="login"',
  ];
  return markers.some(m => lower.includes(m.toLowerCase()));
}

/**
 * Normalize an array of Set-Cookie header values into a Cookie header string.
 * Inspiration from v1: take the last cookies returned and keep only name=value.
 * Additional processing:
 * - Strip attributes (Path, Domain, Expires, Secure, HttpOnly, SameSite...)
 * - Drop cookies with empty values or value "deleted"
 * - Deduplicate by cookie name, keeping the last occurrence
 */
function buildCookieHeaderFromSetCookie(setCookies) {
  const arr = Array.isArray(setCookies) ? setCookies.slice(-3) : [String(setCookies || '')];
  const bag = new Map();
  for (const raw of arr) {
    const firstPart = String(raw || '').split(';')[0].trim();
    if (!firstPart || !firstPart.includes('=')) continue;
    const eqIdx = firstPart.indexOf('=');
    const name = firstPart.slice(0, eqIdx).trim();
    const value = firstPart.slice(eqIdx + 1).trim();
    if (!name || !value || value.toLowerCase() === 'deleted') continue;
    // Keep last occurrence for a given name
    bag.set(name, value);
  }
  return Array.from(bag.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function loginAndGetCookies() {
  if (!BASE_FORUM_URL) throw new Error('BASE_FORUM_URL env is required for login');
  const username = process.env.FORUM_USER;
  const password = process.env.FORUM_PASS;
  if (!username || !password) throw new Error('FORUM_USER and FORUM_PASS envs are required for login');

  const res = await fetch(`${BASE_FORUM_URL}ucp.php?mode=login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...DEFAULT_HEADERS,
    },
    body: new URLSearchParams({
      username,
      password,
      autologin: 'on',
      login: 'Connexion',
      redirect: './index.php?',
    }).toString(),
    redirect: 'manual',
  });

  const setCookies = res.headers.raw()['set-cookie'];
  if (!setCookies || setCookies.length === 0) {
    throw new Error(`Login failed: no Set-Cookie received (status ${res.status})`);
  }
  // Process raw cookies similar to v1: keep only the last few, strip attributes, and dedupe
  const cookieStr = buildCookieHeaderFromSetCookie(setCookies);
  writeCookieFile(cookieStr);
  return cookieStr;
}

export async function scrapePage(url, { maxRetries = 3, delayMs = 3000 } = {}) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      let cookies = readCookieFile();
      let res = await fetch(url, {
        headers: {
          ...DEFAULT_HEADERS,
          ...(cookies ? { 'Cookie': cookies } : {}),
        },
        redirect: 'manual',
      });

      // Detect redirect to login
      if (res.status >= 300 && res.status < 400) {
        const loc = (res.headers.get('location') || '').toLowerCase();
        if (loc.includes('ucp.php') || loc.includes('login')) {
          console.log('🔁 Redirected to login. Performing login...');
          cookies = await loginAndGetCookies();
          res = await fetch(url, {
            headers: { ...DEFAULT_HEADERS, 'Cookie': cookies },
            redirect: 'manual',
          });
        } else {
          throw new Error(`Unexpected redirect to ${loc || '[no location]'} (status ${res.status})`);
        }
      }

      if (!res.ok) {
        // Read body when possible to detect login page delivered as 200
        const body = await res.text().catch(() => '');
        if (looksLikeLoginPage(body)) {
          console.log('🔒 Login page detected (200). Attempting login...');
          const newCookies = await loginAndGetCookies();
          const res2 = await fetch(url, { headers: { ...DEFAULT_HEADERS, 'Cookie': newCookies }, redirect: 'manual' });
          if (!res2.ok) {
            throw new Error(`After login, fetch failed with HTTP ${res2.status}`);
          }
          const html2 = await res2.text();
          if (looksLikeLoginPage(html2)) {
            throw new Error('After login, still on login page. Aborting.');
          }
          return html2;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const html = await res.text();
      if (looksLikeLoginPage(html)) {
        console.log('🔒 Login page detected in HTML. Logging in and retrying...');
        const newCookies = await loginAndGetCookies();
        const res2 = await fetch(url, { headers: { ...DEFAULT_HEADERS, 'Cookie': newCookies }, redirect: 'manual' });
        if (!res2.ok) {
          throw new Error(`After login, fetch failed with HTTP ${res2.status}`);
        }
        const html2 = await res2.text();
        if (looksLikeLoginPage(html2)) {
          throw new Error('After login, still on login page. Aborting.');
        }
        return html2;
      }

      return html;
    } catch (e) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`❌ scrapePage fatal: ${e.message}`);
        process.exit(1);
      }
      console.warn(`⚠️ scrapePage error (attempt ${attempt}): ${e.message}. Retrying in ${Math.round(delayMs/1000)}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

/**
 * Try to extract a timestamp text from a message container.
 * Looks at common forum patterns and generic date-like strings.
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} container
 * @returns {string|undefined}
 */
function extractTimestamp($, container) {
  const el = $(container);
  // Common places for a timestamp on forums (phpBB search result structure included)
  const candidates = [
    el.find('dd.search-result-date').first().text(), // e.g., "jeu. oct. 09, 2025 4:44 pm"
    el.find('.author time').first().attr('datetime'),
    el.find('time').first().attr('datetime'),
    el.find('.author .responsive-hide').first().text(),
    el.find('.author').first().text(),
    el.find('.post-time').first().text(),
    el.find('.date').first().text(),
    el.find('.time').first().text(),
  ].filter(Boolean).map(s => s.trim()).filter(Boolean);

  if (candidates.length) return candidates[0];

  // Fallback: search raw text for a date-like pattern
  const text = el.text();
  const dateRegexes = [
    /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?\b/, // 2025-10-13 19:09
    /\b\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2})?\b/,        // 13/10/2025 19:09
    /\b\d{1,2} \w+ \d{4}( \d{2}:\d{2})?\b/i,         // 13 Oct 2025 19:09
  ];
  for (const re of dateRegexes) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}

/**
 * Analyze forum HTML and return the TOPMOST message.
 * Primary selectors: div.search.postbg1, div.search.postbg2 (phpBB search results)
 * Fallback: div.inner containing dl.postprofile + div.postbody.
 * When extracting message content, strip any nested blockquote elements (quoted prior messages).
 * @param {string} html
 * @returns {{messageHtml: string, messageText: string, timestamp: string|undefined, containerClass: string, forumName?: string, title?: string}|null}
 */
export function analyzeHtml(html) {
  const $ = load(html);
  let top = $('div.search.postbg1, div.search.postbg2').first();
  let containerClass = '';

  if (!top.length) {
    // Fallback to phpBB structure similar to the example
    top = $('div.inner').has('dl.postprofile').has('div.postbody').first();
    if (!top.length) return null;
  }

  containerClass = top.attr('class') || '';

  // Prefer the actual post content
  let contentEl = top.find('.postbody .content').first();
  if (!contentEl.length) contentEl = top.find('.content').first();
  if (!contentEl.length) contentEl = top; // last resort

  // Remove quotes as they are not useful data
  contentEl.find('blockquote').remove();

  const messageHtml = (contentEl.html() || '').trim();
  const messageText = contentEl.text().trim();
  const timestamp = extractTimestamp($, top.get(0));

  // Extract forum name from the dl.postprofile > dd that starts with "Forum"
  let forumName;
  const ddEls = top.find('dl.postprofile dd');
  ddEls.each((_, el) => {
    const t = $(el).text().trim();
    if (/^forum\b/i.test(t.replace(/\u00A0/g, ' ').trim())) {
      const a = $(el).find('a').first();
      forumName = (a.text() || '').trim();
      return false; // break each
    }
  });

  // Extract message title from .postbody h3 a (fallback: h3)
  let title = top.find('.postbody h3 a').first().text().trim();
  if (!title) title = top.find('.postbody h3').first().text().trim();

  return { messageHtml, messageText, timestamp, containerClass, forumName, title };
}

/**
 * Detect whether a message contains a Google Forms link.
 * Returns the first matching forms URL if found, else null.
 * @param {string} htmlOrText
 * @returns {string|null}
 */
export function detectTicketSale(htmlOrText) {
  if (!htmlOrText) return null;
  const re = /(https?:\/\/(?:docs\.google\.com\/forms\/d\/|forms\.gle\/)[^\s"'<>]+)/i;
  const m = htmlOrText.match(re);
  return m ? m[1] : null;
}

/**
 * Attempt to auto-submit a Google Form.
 * Note: Generic submission is not always possible without knowing entry field names (entry.XXXX).
 * Provide FORM_PAYLOAD_JSON env with a JSON object mapping entry names to values.
 * @param {string} formUrl A Google Forms "viewform" or "edit" URL. We will convert to "formResponse".
 * @returns {Promise<{ok:boolean, submitted:boolean, status?:number, message:string}>}
 */
export async function autoSubmitGoogleForm(formUrl) {
  try {
    const url = new URL(formUrl);
    // Normalize to formResponse endpoint
    // Example: https://docs.google.com/forms/d/e/<id>/viewform -> .../formResponse
    const parts = url.pathname.split('/');
    const ix = parts.findIndex(p => p === 'viewform');
    if (ix !== -1) parts[ix] = 'formResponse';
    const submitUrl = new URL(url.origin + parts.join('/') + (url.search || ''));

    // Load form to attempt to extract entry names (best effort)
    const html = await (await fetch(formUrl, { headers: { 'User-Agent': 'cup-bots/1.0' } })).text();
    const $ = load(html);
    const inputs = new Set();
    $('input[name^="entry."], textarea[name^="entry."], select[name^="entry."]').each((_, el) => {
      const name = $(el).attr('name');
      if (name) inputs.add(name);
    });

    // Build payload from env JSON when provided
    let payload = {};
    const envJson = process.env.FORM_PAYLOAD_JSON;
    if (envJson) {
      try { payload = JSON.parse(envJson); } catch {}
    }

    // Fill any missing entry fields with a generic placeholder to attempt submit
    for (const name of inputs) {
      if (!(name in payload)) payload[name] = 'N/A';
    }

    const formData = new URLSearchParams();
    Object.entries(payload).forEach(([k, v]) => formData.append(k, String(v)));

    const res = await fetch(submitUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'cup-bots/1.0',
        'Referer': formUrl,
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    const ok = res.status >= 200 && res.status < 400;
    return { ok, submitted: ok, status: res.status, message: ok ? 'Submitted (best effort)' : `Submit failed: ${res.status}` };
  } catch (e) {
    return { ok: false, submitted: false, message: `Error: ${e.message}` };
  }
}

// Export selected internal helpers for testing
export { buildCookieHeaderFromSetCookie, looksLikeLoginPage };

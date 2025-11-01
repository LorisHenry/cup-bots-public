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
import { sendNotification } from './v1/notification_sender.mjs';

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
  // Submit a Google Form (forms.gle or docs.google.com/forms) filling 4 specific text fields:
  // "Nom", "Prénom", "Mail (identique à billeterie PSG)", "Numéro" from .env values.
  // Env fallbacks supported: FORM_NOM|NOM, FORM_PRENOM|PRENOM, FORM_MAIL|MAIL|EMAIL, FORM_NUMERO|NUMERO|TEL|TELEPHONE.
  // Also merges FORM_PAYLOAD_JSON when provided.
  try {
    if (!formUrl) throw new Error('formUrl is required');

    const discordUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DEBUG_DISCORD_WEBHOOK_URL;
    const ntfyUrl = process.env.NTFY_URL || process.env.DEBUG_NTFY_URL;
    const notify = async (msg) => {
      console.log(msg);
      try { await sendNotification(msg, discordUrl, ntfyUrl); } catch {}
    };

    await notify(`🚀 Début auto-submit Google Form: ${formUrl}`);

    // 1) Fetch the form HTML (node-fetch follows forms.gle redirects by default)
    const viewRes = await fetch(formUrl, { headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] } });
    const html = await viewRes.text();
    const $ = load(html);

    // 2) Determine the submit URL: convert .../viewform to .../formResponse
    // Prefer the real <form> action if present in the HTML
    let effectiveUrl = viewRes.url || formUrl;
    const u = new URL(effectiveUrl);
    let submitUrl;
    const actionAttr = $('form#mG61Hd').attr('action') || $('form[action*="formResponse"]').attr('action');
    if (actionAttr) {
      submitUrl = new URL(actionAttr, u.origin);
    } else {
      // Derive from effective URL
      let path = u.pathname.replace(/\/?viewform\b/, '/formResponse');
      if (!path.startsWith('/')) path = '/' + path;
      submitUrl = new URL(path + (u.search || ''), u.origin);
    }

    // 3) Find all entry.* inputs and try to infer their question labels
    // Heuristic: for each input/textarea/select, climb to a question container and read its text
    const fields = [];
    $('input[name^="entry."], textarea[name^="entry."], select[name^="entry."]').each((_, el) => {
      const name = $(el).attr('name');
      if (!name) return;
      let q = $(el).closest('div[role="listitem"]');
      if (!q.length) q = $(el).parents().slice(0, 5).last(); // fallback few levels up
      // Try to read the question text specifically
      let labelText = (q.find('div.HoXoMd .M7eMe').first().text() || '').trim();
      if (!labelText) labelText = (q.find('[role="heading"]').first().text() || '').trim();
      if (!labelText) {
        // Try aria-labelledby on the input
        const labelledBy = ($(el).attr('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        for (const id of labelledBy) {
          const t = $(`#${id}`).text().trim();
          if (t) { labelText = t; break; }
        }
      }
      if (!labelText) labelText = (q.text() || '').trim();
      fields.push({ name, labelText });
    });

    // Fallback: some Google Forms render visible inputs without name, but provide entry IDs and labels in FB_PUBLIC_LOAD_DATA_
    if (fields.length === 0) {
      try {
        const scriptText = $('script').map((_, s) => $(s).html() || '').get().join('\n');
        const m = scriptText.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);/s);
        if (m) {
          // Parse the array structure and extract entries: [id, label, ...]
          const data = eval(m[1]); // array literal, not trusted JSON; eval in sandboxed context
          // data[1][1] is entries array in observed layouts
          const entries = (data && data[1] && Array.isArray(data[1][1])) ? data[1][1] : [];
          for (const e of entries) {
            // e example: [1784914561, "Nom", null, 0, [[1144946249,null,1]], ...]
            const label = (e && e[1]) || '';
            const idGroup = (e && e[4]) || [];
            if (Array.isArray(idGroup) && idGroup.length > 0 && Array.isArray(idGroup[0]) && idGroup[0].length > 0) {
              const entryId = idGroup[0][0];
              if (entryId != null) {
                const name = `entry.${entryId}`;
                fields.push({ name, labelText: String(label || '').trim() });
              }
            }
          }
        }
      } catch {}
    }

    console.log(`🔎 Champs détectés: ${fields.length}`);
    fields.forEach(f => console.log(` - ${f.name} ⇢ "${(f.labelText || '').slice(0,120)}"`));

    // Helper: normalize french text (remove accents, lowercase)
    const norm = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    // 4) Map labels to target roles
    const roleMap = { nom: null, prenom: null, mail: null, numero: null };
    for (const f of fields) {
      const t = norm(f.labelText);
      if (!t) continue;
      const has = (w) => t.includes(w);
      // Identify mail/email
      if (!roleMap.mail && (has('mail') || has('e-mail') || has('email'))) {
        roleMap.mail = f.name; continue;
      }
      // Identify numero / telephone
      if (!roleMap.numero && (has('numero') || has('numéro') || has('telephone') || has('téléphone') || has('tel') || has('portable'))) {
        roleMap.numero = f.name; continue;
      }
      // Identify prenom
      if (!roleMap.prenom && (has('prenom') || has('prénom'))) {
        roleMap.prenom = f.name; continue;
      }
      // Identify nom (ensure not prenom)
      if (!roleMap.nom && has('nom') && !has('prenom') && !has('prénom')) {
        roleMap.nom = f.name; continue;
      }
    }

    await notify(`🧭 Mapping: ${JSON.stringify(roleMap)}`);

    // 5) Read env values with fallbacks
    const envVal = (keys) => keys.map(k => process.env[k]).find(v => v != null && String(v).trim() !== '');
    const values = {
      nom: envVal(['FORM_NOM', 'NOM', 'nom']),
      prenom: envVal(['FORM_PRENOM', 'PRENOM', 'prenom', 'prénom']),
      mail: envVal(['FORM_MAIL', 'MAIL', 'EMAIL', 'mail', 'email']),
      numero: envVal(['FORM_NUMERO', 'NUMERO', 'TEL', 'TELEPHONE', 'numero', 'numéro']),
    };

    // 6) Merge with FORM_PAYLOAD_JSON if provided
    let payload = {};
    const envJson = process.env.FORM_PAYLOAD_JSON;
    if (envJson) {
      try { payload = JSON.parse(envJson); } catch {}
    }

    // Add our four fields when both mapping and value exist
    const missing = [];
    for (const key of ['nom','prenom','mail','numero']) {
      const entryName = roleMap[key];
      const val = values[key];
      if (entryName && val != null) {
        payload[entryName] = String(val);
      } else {
        missing.push(key);
      }
    }

    // 7) If we have no payload at all, fallback: fill detected entry fields with 'N/A' to attempt submission
    if (Object.keys(payload).length === 0) {
      if (fields.length > 0) {
        for (const f of fields) payload[f.name] = 'N/A';
      } else {
        const msg = `❌ Impossible de construire le payload: champs non appariés ${missing.join(', ') || 'tous'}`;
        await notify(msg);
        return { ok: false, submitted: false, message: msg };
      }
    }

    const previewPairs = [];
    const entryToLabel = Object.fromEntries(fields.map(f => [f.name, f.labelText]));
    for (const [k, v] of Object.entries(payload)) {
      const label = entryToLabel[k] || k;
      previewPairs.push(`${label}: ${String(v)}`);
    }
    console.log(`📝 Payload prêt (${Object.keys(payload).length} champs)`);

    // 8) Submit
    const formData = new URLSearchParams();
    Object.entries(payload).forEach(([k, v]) => formData.append(k, String(v)));

    const res = await fetch(submitUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        'Referer': viewRes.url || formUrl,
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    const ok = res.status >= 200 && res.status < 400;
    const info = {
      ok,
      submitted: ok,
      status: res.status,
      message: ok ? 'Submitted' : `Submit failed: ${res.status}`,
      unmatched: missing,
      mapped: roleMap,
      submittedPreview: previewPairs,
    };

    if (ok) {
      await notify(`✅ Formulaire soumis (${res.status}). Champs soumis:\n- ${previewPairs.join('\n- ')}`);
    } else {
      await notify(`⚠️ Échec soumission (${res.status}). Manquants: ${missing.join(', ')}`);
    }

    return info;
  } catch (e) {
    const discordUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DEBUG_DISCORD_WEBHOOK_URL;
    const ntfyUrl = process.env.NTFY_URL || process.env.DEBUG_NTFY_URL;
    try { await sendNotification(`❌ Erreur auto-submit: ${e.message}`, discordUrl, ntfyUrl); } catch {}
    return { ok: false, submitted: false, message: `Error: ${e.message}` };
  }
}

// Export selected internal helpers for testing
export { buildCookieHeaderFromSetCookie, looksLikeLoginPage };

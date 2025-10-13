// topicWatcher.mjs
/**
 * v1 Topic Watcher
 * - Periodically scrapes a forum section page and tracks discovered topics by link.
 * - On the first successful load, it initializes the seen set without notifying.
 * - On subsequent loads, if a new topic link appears, it sends notifications.
 * - Performs a simple sanity check to ensure the scraped HTML is indeed a forum page (not an error/login).
 *
 * Env
 * - BASE_FORUM_URL: Used to normalize relative links and strip transient "sid" params.
 */
import { scrapePage } from './scraper.mjs';
import { sendNotification } from './notification_sender.mjs';
import fetch from 'node-fetch';
import { load } from 'cheerio';

const BASE_FORUM_URL = process.env.BASE_FORUM_URL || '';

let initialLoadDone = false; // 👈 flag to ignore the first scrape


const seenTopics = new Set();

/**
 * Normalize a topic href against BASE_FORUM_URL and drop volatile query params.
 * This helps deduplicate the same topic link across refreshes.
 */
function normalizeHref(href) {
  try {
    const url = new URL(href, BASE_FORUM_URL);
    url.searchParams.delete("sid"); // remove the sid query parameter
    return url.pathname + url.search; // keep path + other params if needed
  } catch {
    return href; // fallback
  }
}

/**
 * Scrape the target forum section, update the seen set, and notify on new topics.
 * - Detects "General Error" pages and sends a dedicated alert without processing topics.
 * - Ensures we are on a valid forum page by checking the forum title.
 */
async function checkTopics(TARGET_URL, DISCORD_WEBHOOK_URL, NTFY_URL) {
  try {
    const html = await scrapePage(TARGET_URL);
    if (!html) return;

    const $ = load(html);

    if ($('body#errorpage').length > 0 && $('h1').text().includes("General Error")) {
      const errorMsg = $('div#content div').text().trim() || 'Forum overloaded / General Error';
      console.error(`❌ Forum returned General Error: ${errorMsg}`);
      await sendNotification(`Forum Overcrowded !\n${errorMsg}`, DISCORD_WEBHOOK_URL, NTFY_URL);
      return; // skip processing topics this round
    }

    // 🔒 Security check: ensure we’re on the correct forum page
    const forumTitleEl = $('h2.forum-title a');
    if (!forumTitleEl.length) {
      console.error('❌ Forum title not found! Scraped HTML may be invalid (login page, error, etc.).');
      process.exit(1); // kill the process
    }
    const forumTitle = forumTitleEl.text().trim();
    console.log(`📂 Scraping forum section: ${forumTitle}`);

    $('.topiclist.topics .topictitle').each((_, el) => {
      const el$ = $(el);
      const title = el$.text().trim();
      const href = el$.attr('href');
      if (!href) return;
      const normalized = normalizeHref(href);

      const fullUrl = new URL(normalized, BASE_FORUM_URL).href;

      if (!seenTopics.has(normalized)) {
        seenTopics.add(normalized);
        console.log(`🆕 Nouveau topic trouvé: ${title}`);
        console.log(seenTopics.size)

        if (initialLoadDone) {
          // only notify after first scrape is done
          sendNotification(`Nouveau sujet: ${title}\nURL: ${fullUrl}`, DISCORD_WEBHOOK_URL, NTFY_URL);
        }
      }
    });
    if (!initialLoadDone) {
      initialLoadDone = true;
      console.log('✅ Initial load complete, now watching for new topics.');
    }
  } catch (err) {
    console.error('Erreur pendant checkTopics:', err);
  }
  console.log(seenTopics)
}

/**
 * Start the topic watcher loop for a given forum section.
 * @param {string} TARGET_URL - Forum section URL to poll.
 * @param {string} DISCORD_WEBHOOK_URL - Optional Discord webhook to notify.
 * @param {string} NTFY_URL - Optional ntfy topic URL to notify.
 * @param {number} SCRAPE_INTERVAL_MS - Polling interval in ms.
 */
export async function launchTopicWatcher(TARGET_URL, DISCORD_WEBHOOK_URL, NTFY_URL, SCRAPE_INTERVAL_MS) {
  console.log('🚀 Topic watcher démarré sur:', TARGET_URL);
  await checkTopics(TARGET_URL, DISCORD_WEBHOOK_URL, NTFY_URL); // initial fetch

  setInterval(() => {
    checkTopics(TARGET_URL, DISCORD_WEBHOOK_URL, NTFY_URL);
  }, SCRAPE_INTERVAL_MS);
}

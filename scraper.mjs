// scraper.mjs
import fs from 'fs';
import fetch from 'node-fetch';
import { getCookies } from './cookies.mjs';  // make sure cookies.mjs exports getCookies()


/**
 * Scrapes the forum page using session cookies
 * @returns {Promise<string>} HTML content of the page
 */
export async function scrapePage(url, maxRetries = 5, delayMs = 5_000) {
  let attempt = 0;

  while (attempt < maxRetries) {
    console.log(`ℹ️ Scraping page (attempt ${attempt + 1}/${maxRetries}): ${url}`);
    try {
      // 1. Get the session cookies
      const cookies = await getCookies();
      // console.log('ℹ️ Using cookies:', cookies);

      // 2. Fetch the protected page
      const response = await fetch(url, {
        headers: {
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch page: ${response.status}`);
      }

      const html = await response.text();
      // console.log('Page HTML length:', html.length);

      // Optional: save raw HTML for debugging
      // fs.writeFileSync('raw_page.html', html, 'utf-8');
      // console.log('✅ Page saved as raw_page.html');

      return html;
    } catch (err) {
      console.error(`⚠️ Error scraping page (attempt ${attempt + 1}):`, err.message);
      attempt++;
      if (attempt < maxRetries) {
        console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error('❌ Max retries reached. Giving up.');
        throw err; // crash after n attempts
      }
    }
  }
}

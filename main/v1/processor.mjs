import { scrapePage } from './scraper.mjs';
import fetch from 'node-fetch';
import { load } from 'cheerio';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const BASE_FORUM_URL = process.env.BASE_FORUM_URL || '';


const seenMessages = new Set();
const buyKeywords = ["cherche"];

async function sendDiscordNotification(message, score, DISCORD_WEBHOOK_URL, directUrl) {
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 @everyone Nouveau message de revente détecté (${score}% de confiance) :\n${message}\n🔗 [Voir le message](${directUrl})`,
      }),
    });
    console.log('Notification envoyée');
  } catch (err) {
    console.error('Erreur webhook Discord:', err);
  }
}

async function inferWithGPT(message, USE_OPENAI_API) {
  if (!USE_OPENAI_API) return { score: 90, rawAnswer: 'skipped OpenAI API' };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        messages: [
                        {
                            role: "system",
                            content: "Tu es un détecteur de messages de revente de places de foot sur un forum. Le forum contient des messages demandant des places, ainsi que des messages offrant des places, ainsi que des messages non lié à la vente / achat."
                        },
                        {
                            role: "user",
                            content: `Réponds **uniquement par un pourcentage** de 0 à 100 indiquant la probabilité que le message soit une **vraie annonce de vente** de place de la part de l'auteur.
- 0% = pas une vente
- 100% = vente claire
- Si le message parle d’un achat, de quelqu’un d’autre ou est ambigu, renvoie un score faible (<40%).
- Les échanges ne sont pas des reventes
Ne réponds jamais par du texte, uniquement un pourcentage suivi de %.

Message à analyser : "${message}"`
                        }
                    ]
      }),
    });

    const data = await response.json();
    const rawAnswer = data.choices?.[0]?.message?.content || '';
    const scoreMatch = rawAnswer.match(/\d+/);
    return { score: scoreMatch ? parseInt(scoreMatch[0], 10) : 0, rawAnswer };
  } catch (err) {
    console.error('Erreur GPT :', err);
    return { score: 0, rawAnswer: '' };
  }
}

async function processPage(html, CONFIDENCE_THRESHOLD, DISCORD_WEBHOOK_URL, USE_OPENAI_API, TARGET_URL, ignoreMode) {
  const $ = load(html);
  const topicTitleEl = $('h2.topic-title a');
  const topicTitle = topicTitleEl.text().trim();
  console.log(`📂 Scraping forum topic: ${topicTitle}`);
  const posts = $('.post.has-profilebg1, .post.has-profilebg2');

  for (const postEl of posts.toArray()) {
    const post = $(postEl);
    const contentEl = post.find('.postbody .content');
    if (!contentEl.length) continue;

    const clone = contentEl.clone();
    clone.find('blockquote').remove();
    const text = clone.text().trim();
    const id = post.attr('id') || text;

    if (seenMessages.has(id)) continue;

    if (ignoreMode) {
      seenMessages.add(id);
      continue;
    }
    seenMessages.add(id);

    if (buyKeywords.some(kw => text.toLowerCase().includes(kw))) continue;

    const { score, rawAnswer } = await inferWithGPT(text, USE_OPENAI_API);
    if (score >= CONFIDENCE_THRESHOLD) {
      console.log(`✅ Message de revente détecté : ${text} => ${score}% | raw GPT: "${rawAnswer}"`);
      const directUrl = `${TARGET_URL}#${id}`;
      if (DISCORD_WEBHOOK_URL) {
        await sendDiscordNotification(text, score, DISCORD_WEBHOOK_URL, directUrl);
      }
    }
    else {
      // console.log(`ℹ️ Message ignoré : ${text} => ${score}% | raw GPT: "${rawAnswer}"`);
    }
  }

  // Return next page URL if exists
  const nextLink = $('.pagination .next a').attr('href');
  return nextLink ? new URL(nextLink, BASE_FORUM_URL).href : null;
}

export async function launchScraper(TARGET_URL, CONFIDENCE_THRESHOLD, DISCORD_WEBHOOK_URL, SCRAPE_INTERVAL_MS, USE_OPENAI_API, IGNORE_INITIAL_MESSAGES) {
  let currentUrl = TARGET_URL;
  let firstRun = true;

  while (true) {
    let nextUrl;
    do {
      const html = await scrapePage(currentUrl);
      nextUrl = await processPage(html, CONFIDENCE_THRESHOLD, DISCORD_WEBHOOK_URL, USE_OPENAI_API, TARGET_URL, firstRun && IGNORE_INITIAL_MESSAGES);
      if (nextUrl) {
        console.log('➡️ Going to next page:', nextUrl);
        currentUrl = nextUrl;
      }
    } while (nextUrl);

    firstRun = false; // After the first cycle, stop ignoring
    console.log('⏱ Waiting for next scrape...');
    await new Promise(r => setTimeout(r, SCRAPE_INTERVAL_MS));
  }
}
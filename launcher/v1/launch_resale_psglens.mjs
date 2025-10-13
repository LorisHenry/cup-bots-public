// launch_resale_psglens.mjs
import { launchScraper } from '../../main/v1/processor.mjs';
import { startSafetyLogs } from '../../main/v1/safety_heartbeat.mjs';

const BOT_NAME = 'Revente PSG - Lens';
const TARGET_URL = process.env.RESALE_PSGLENS_BASE_FORUM_URL
  ? `${process.env.RESALE_PSGLENS_BASE_FORUM_URL}&start=320`
  : '';
const CONFIDENCE_THRESHOLD = 60;
const DISCORD_WEBHOOK_URL = process.env.RESALE_PSGLENS_WEBHOOK_URL || '';
// const DISCORD_WEBHOOK_URL = process.env.DISCORD_DEBUG_WEBHOOK_URL || '';
const SCRAPE_INTERVAL_MS = 10_000;
const USE_OPENAI_API = true;
const IGNORE_INITIAL_MESSAGES = true;


startSafetyLogs(BOT_NAME); // starts heartbeat every hour
await launchScraper(TARGET_URL, CONFIDENCE_THRESHOLD, DISCORD_WEBHOOK_URL, SCRAPE_INTERVAL_MS, USE_OPENAI_API, IGNORE_INITIAL_MESSAGES);

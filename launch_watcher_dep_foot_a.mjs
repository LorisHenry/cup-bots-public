// launch_watcher_dep_foot_a.mjs
import { launchScraper } from './processor.mjs';
import { startSafetyLogs } from './safety_heartbeat.mjs';
import {launchTopicWatcher} from "./topic_watcher.mjs";

const BOT_NAME = 'Watcher Foot A';
const TARGET_URL = process.env.FORUM_URL_DEP_FOOT_A
  ? `${process.env.FORUM_URL_DEP_FOOT_A}`
  : '';
// const DISCORD_WEBHOOK_URL = process.env. || '';
const DISCORD_WEBHOOK_URL = process.env.DEP_FOOT_A_WEBHOOK_URL || '';
const NTFY_URL = process.env.DEP_FOOT_A_NTFY_URL || '';
const SCRAPE_INTERVAL_MS = 10_000;
// startSafetyLogs(BOT_NAME, CONFIDENCE_THRESHOLD); // starts heartbeat every hour

startSafetyLogs(BOT_NAME); // starts heartbeat every hour
await launchTopicWatcher(TARGET_URL, DISCORD_WEBHOOK_URL, NTFY_URL, SCRAPE_INTERVAL_MS);

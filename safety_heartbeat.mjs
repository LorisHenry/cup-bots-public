// safetyLogger.mjs
import fetch from 'node-fetch';

const DISCORD_SAFETY_WEBHOOK_URL = process.env.DISCORD_SAFETY_WEBHOOK_URL;

async function sendSafetyLog(BOT_NAME, note = '') {
  if (!DISCORD_SAFETY_WEBHOOK_URL) return;

  try {
    await fetch(DISCORD_SAFETY_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🛡️ ${BOT_NAME} is alive! ${note} Timestamp: ${new Date().toISOString()}`
      }),
    });
    console.log('Safety log sent.');
  } catch (err) {
    console.error('Failed to send safety log:', err);
  }
}

export function startSafetyLogs(BOT_NAME, INTERVAL_MS = 3600_000) {
  if (!DISCORD_SAFETY_WEBHOOK_URL) return;

  // 👇 Send one immediately at startup
  sendSafetyLog(BOT_NAME, '(startup)');

  // 👇 Then continue sending on interval
  setInterval(() => {
    sendSafetyLog(BOT_NAME);
  }, INTERVAL_MS);

  console.log(`Safety logger running every ${INTERVAL_MS / 1000 / 60} minutes.`);
}

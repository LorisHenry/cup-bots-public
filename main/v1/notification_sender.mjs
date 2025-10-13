/**
 * Notification sender (v1)
 * - Sends messages to two optional channels: Discord (webhook) and ntfy.
 * - If a channel URL is not provided, it is skipped silently.
 * - Minimal formatting: Discord @everyone prefix + raw message; ntfy supports Title/Priority headers.
 */
import fetch from "node-fetch";

export async function sendNotification(message, DISCORD_WEBHOOK_URL, NFTY_URL) {

  // --- Discord notification ---
  if (DISCORD_WEBHOOK_URL) {
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `@everyone ${message}`,
        }),
      });
      console.log('✅ Notification Discord envoyée pour:', message.substring(0, 50));
    } catch (err) {
      console.error('❌ Erreur envoi webhook Discord:', err);
    }
  }

  // --- ntfy notification ---
  if (NFTY_URL) {
    try {
      await fetch(NFTY_URL, {
        method: 'POST',
        body: message,
        headers: {
          'Title': 'ALERTE',
          'Priority': 'high',
        },
      });
      console.log('✅ Notification ntfy envoyée pour:', message.substring(0, 50));
    } catch (err) {
      console.error('❌ Erreur envoi ntfy:', err);
    }
  }
}

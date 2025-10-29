/**
 * Notification sender (v1)
 * - Sends messages to two optional channels: Discord (webhook) and ntfy.
 * - If a channel URL is not provided, it is skipped silently.
 * - Minimal formatting: Discord @everyone prefix + raw message; ntfy supports Title/Priority headers.
 */
import fetch from "node-fetch";

function ensureAbsoluteUrl(url) {
  if (!url) return url;
  // If it already starts with http:// or https://, keep as-is
  if (/^https?:\/\//i.test(url)) return url;
  // Otherwise, default to https://
  return `https://${url}`;
}

export async function sendNotification(message, DISCORD_WEBHOOK_URL, NFTY_URL) {
  const discordUrl = ensureAbsoluteUrl(DISCORD_WEBHOOK_URL);
  const ntfyUrl = ensureAbsoluteUrl(NFTY_URL);

  // --- Discord notification ---
  if (discordUrl) {
    try {
      await fetch(discordUrl, {
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
  if (ntfyUrl) {
    try {
      await fetch(ntfyUrl, {
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

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

// cookies.mjs
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.BASE_FORUM_URL;

export async function getCookies(maxRetries = 5, delayMs = 5_000) {
  let attempt = 1;

  while (attempt < maxRetries) {
    if (attempt > 1) {
      console.log(`🔑 Getting cookies (attempt ${attempt}/${maxRetries})...`);
    }
    try {
      const response = await fetch(`${BASE_URL}ucp.php?mode=login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) NodeBot/1.0",
        },
        body: new URLSearchParams({
          username: process.env.FORUM_USER,
          password: process.env.FORUM_PASS,
          autologin: "on",
          login: "Connexion",
          redirect: "./index.php?",
        }),
        redirect: "manual", // important to avoid automatic redirect
      });

      // console.log("Status:", response.status);

      const rawCookies = response.headers.raw()['set-cookie'];
      if (!rawCookies || rawCookies.length === 0) {
        throw new Error("❌ Aucun cookie renvoyé !");
      }
      return rawCookies
          .slice(-3)
          .map(c => c.split(';')[0])
          .join('; ');
    } catch (err) {
      console.error(`⚠️ Failed to get cookies (attempt ${attempt}):`, err.message);
      attempt++;
      if (attempt < maxRetries) {
        console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.error("❌ Max retries reached. Could not get cookies.");
        throw err; // crash after max retries
      }
    }
  }
}

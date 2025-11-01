#!/usr/bin/env node
// scripts/test_auto_submit.mjs
// Simple runner to test autoSubmitGoogleForm with provided Google Form URLs.
// Usage:
//   node scripts/test_auto_submit.mjs <formUrl1> [formUrl2 ...]
// Or set env FORMS_URLS (comma or space separated)
// Ensure your .env contains values for NOM, PRENOM, MAIL, NUMERO (or their variants).

import 'dotenv/config';
import { autoSubmitGoogleForm } from '../main/scraper.mjs';

function parseUrlsFromArgsOrEnv() {
  const args = process.argv.slice(2).filter(Boolean);
  if (args.length > 0) return args;
  const env = process.env.FORMS_URLS || '';
  const parts = env.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  return parts;
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/test_auto_submit.mjs <formUrl1> [formUrl2 ...]',
      '  FORMS_URLS="<url1>, <url2>" node scripts/test_auto_submit.mjs',
      '',
      'This will attempt to auto-submit the Google Form(s) using values from your .env:',
      '  NOM / PRENOM / MAIL / NUMERO (or FORM_NOM/PRENOM/MAIL/NUMERO)',
      'Optional:',
      '  DEBUG_DISCORD_WEBHOOK_URL / DEBUG_NTFY_URL to receive notifications',
      '  FORM_PAYLOAD_JSON to provide extra entry.xxx mappings',
    ].join('\n')
  );
}

async function run() {
  const urls = parseUrlsFromArgsOrEnv();
  if (urls.length === 0) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  console.log(`Found ${urls.length} URL(s) to test.`);

  let anyFail = false;
  for (const url of urls) {
    console.log('\n==============================');
    console.log(`Testing autoSubmitGoogleForm for: ${url}`);
    try {
      const result = await autoSubmitGoogleForm(url);
      console.log('Result:', JSON.stringify(result, null, 2));
      if (!result.ok) anyFail = true;
    } catch (err) {
      console.error('Error while running autoSubmitGoogleForm:', err?.message || err);
      anyFail = true;
    }
  }

  if (anyFail) {
    console.log('\nOne or more submissions failed.');
    process.exitCode = 1;
  } else {
    console.log('\nAll submissions reported ok.');
  }
}

run();

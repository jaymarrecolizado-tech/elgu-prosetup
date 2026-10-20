/**
 * Runtime config for ELGU fee automation.
 * Keep secrets out of source — load from .env / environment.
 */
require('dotenv').config();

const LOGIN_URL = process.env.ELGU_LOGIN_URL || '';

if (!LOGIN_URL || LOGIN_URL.includes('REPLACE-WITH-YOUR')) {
  console.error(`
[config] ELGU_LOGIN_URL is missing or still a placeholder.

1. Copy .env.example → .env
2. Set ELGU_LOGIN_URL to your LGU login page
3. Re-run: npm run fees:configure
`);
  process.exit(1);
}

module.exports = {
  LOGIN_URL,
  /** Slow motion (ms) between Playwright actions — helpful while reconning the UI */
  SLOW_MO_MS: Number(process.env.ELGU_SLOW_MO_MS || 50),
};

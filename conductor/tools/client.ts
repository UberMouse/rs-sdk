// Run the rendering browser bot client for one bot in the system Chrome.
//
//   bun conductor/tools/client.ts <bot>             # visible window: watch it play
//   bun conductor/tools/client.ts <bot> --headless  # no window, still screenshot-able
//
// Unlike the lite runner this client draws the game, so `conductor/tools/screenshot.ts`
// works against it. Scripts attach exactly as they do to the lite client. Leave it
// running; it exits non-zero if the page leaves the game for too long or the
// browser is closed.
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { botClientUrl, loadBotEnv } from '../lib/env';

const args = process.argv.slice(2);
const name = args.find(a => !a.startsWith('-'));
if (!name) {
    console.error('usage: bun conductor/tools/client.ts <bot> [--headless]');
    process.exit(2);
}
const headless = args.includes('--headless');
const env = loadBotEnv(name);

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    '/etc/profiles/per-user/' + process.env.USER + '/bin/google-chrome-stable',
    '/run/current-system/sw/bin/google-chrome-stable',
    '/run/current-system/sw/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
].filter((p): p is string => !!p);
const executablePath = CHROME_CANDIDATES.find(p => existsSync(p));
if (!executablePath) {
    console.error(`No Chrome found; set CHROME_PATH. Tried: ${CHROME_CANDIDATES.join(', ')}`);
    process.exit(2);
}

const browser = await puppeteer.launch({
    executablePath,
    headless,
    defaultViewport: headless ? { width: 1100, height: 700 } : null,
    args: [
        '--mute-audio',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--window-size=1100,780',
        `--user-data-dir=${process.env.HOME}/.cache/rs-sdk-conductor/chrome-${env.username}`,
    ],
    protocolTimeout: 120_000,
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
page.on('pageerror', e => console.error(`[client:${env.username}] page error: ${e instanceof Error ? e.message : String(e)}`));
await page.goto(botClientUrl(env), { waitUntil: 'networkidle2', timeout: 60_000 });
console.log(`[client:${env.username}] ${headless ? 'headless' : 'windowed'} browser client loaded`);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const inGame = () => page.evaluate(() => !!(window as any).gameClient?.ingame).catch(() => false);

let wasInGame = false;
let outSince = Date.now();
browser.on('disconnected', () => {
    console.error(`[client:${env.username}] browser closed`);
    process.exit(1);
});
const shutdown = async () => {
    await browser.close().catch(() => {});
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// The page logs in on its own; report transitions and bail if it stays out of
// game, mirroring the lite runner's "session ended" exit.
for (;;) {
    const now = await inGame();
    if (now && !wasInGame) console.log(`[client:${env.username}] in game`);
    if (!now && wasInGame) console.error(`[client:${env.username}] left game`);
    if (now) outSince = Date.now();
    else if (Date.now() - outSince > 120_000) {
        console.error(`[client:${env.username}] not in game for 120s, exiting`);
        await browser.close().catch(() => {});
        process.exit(1);
    }
    wasInGame = now;
    await sleep(2000);
}

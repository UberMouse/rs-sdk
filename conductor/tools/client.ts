// Run the rendering browser bot client for one bot in the system Chrome.
//
//   bun conductor/tools/client.ts <bot>             # visible window: watch it play
//   bun conductor/tools/client.ts <bot> --headless  # no window, still screenshot-able
//   --fps <n>  frame cap (default 15 windowed, 10 headless; --fps=<n> works too)
//   --gpu      use GPU acceleration (off by default, see below)
//
// Unlike the lite runner this client draws the game, so `conductor/tools/screenshot.ts`
// works against it. Scripts attach exactly as they do to the lite client. Leave it
// running; it exits non-zero if the page leaves the game for too long or the
// browser is closed.
//
// GPU is off by default: on a VMware guest a GPU-accelerated windowed client filled
// vmwgfx graphics memory (6-11G, booked to Xorg, invisible to process meters) and
// stalled every other window's redraws behind its buffer churn. Software rendering
// plus a frame cap costs a little CPU instead.
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { botClientUrl, loadBotEnvOrFail, sleep } from '../lib/env';
import { errMessage, fail, parseCli } from '../lib/util';

const usage = 'usage: bun conductor/tools/client.ts <bot> [--headless] [--fps <n>] [--gpu]';
const { values: flags, positionals } = parseCli(
    { headless: { type: 'boolean' }, gpu: { type: 'boolean' }, fps: { type: 'string' } },
    usage,
);
const [name] = positionals;
if (!name || positionals.length > 1) fail(usage, 2);
const headless = flags.headless ?? false;
const gpu = flags.gpu ?? false;
const fps = flags.fps !== undefined ? Number(flags.fps) : headless ? 10 : 15;
if (!Number.isInteger(fps) || fps < 1) {
    fail(`bad --fps ${flags.fps}: expected a positive integer`, 2);
}
const env = loadBotEnvOrFail(name);

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    `/etc/profiles/per-user/${userInfo().username}/bin/google-chrome-stable`,
    '/run/current-system/sw/bin/google-chrome-stable',
    '/run/current-system/sw/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
].filter((p): p is string => !!p);
const executablePath = CHROME_CANDIDATES.find(p => existsSync(p));
if (!executablePath) {
    fail(`No Chrome found; set CHROME_PATH. Tried: ${CHROME_CANDIDATES.join(', ')}`, 2);
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
        `--user-data-dir=${join(homedir(), '.cache/rs-sdk-conductor', `chrome-${env.username}`)}`,
        ...(gpu ? [] : ['--disable-gpu']),
    ],
    protocolTimeout: 120_000,
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
page.on('pageerror', e => console.error(`[client:${env.username}] page error: ${errMessage(e)}`));
// bot.ejs applies ?fps= via client.setTargetedFramerate once in game.
await page.goto(`${botClientUrl(env)}&fps=${fps}`, { waitUntil: 'networkidle2', timeout: 60_000 });
console.log(
    `[client:${env.username}] ${headless ? 'headless' : 'windowed'} browser client loaded (gpu ${gpu ? 'on' : 'off'}, ${fps} fps)`,
);

/** The slice of the page's global that the bot client exposes. */
type GamePage = Window & { gameClient?: { ingame?: boolean } };

const inGame = () => page.evaluate(() => !!(window as GamePage).gameClient?.ingame).catch(() => false);

let wasInGame = false;
let outSince = Date.now();
// browser.close() emits 'disconnected' synchronously; a deliberate shutdown must not exit 1.
let shuttingDown = false;
browser.on('disconnected', () => {
    if (shuttingDown) return;
    console.error(`[client:${env.username}] browser closed`);
    process.exit(1);
});
const shutdown = async () => {
    shuttingDown = true;
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

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BotSDK } from '../../sdk/index';
import { REPO_ROOT } from './env';
import { fileStamp } from './util';

/** Default location: conductor/runs/<bot>/screenshots/<timestamp>-<label>.png (gitignored). */
export function screenshotPath(bot: string, label = 'shot'): string {
    return join(REPO_ROOT, 'conductor/runs', bot, 'screenshots', `${fileStamp()}-${label}.png`);
}

/** Ask the attached browser client for its canvas and write it as PNG. Returns the absolute path. */
export async function captureScreenshot(sdk: BotSDK, bot: string, out?: string, label?: string): Promise<string> {
    const dataUrl = await sdk.sendScreenshot(10_000);
    const m = /^data:image\/\w+;base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error('client returned an unexpected screenshot payload');
    const path = out ? resolve(out) : screenshotPath(bot, label);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(m[1]!, 'base64'));
    return path;
}

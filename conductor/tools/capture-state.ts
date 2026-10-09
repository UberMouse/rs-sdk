// Write a bot's current world state, trimmed, as a test fixture for conductor/test/world.ts.
//
//   bun conductor/tools/capture-state.ts <bot> [--name <fixture>]
//
// Connects in observe mode, so it never steals control from a running task. Capture from a
// throwaway fixture bot (conductor/test/integration/harness.ts), not a real account: a fixture is
// committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { BotSDK } from '../../sdk/index';
import { trimState } from '../lib/capture';
import { connectSdk, disconnectQuietly, loadBotEnv, REPO_ROOT } from '../lib/env';
import { errMessage } from '../lib/util';

const READY_TIMEOUT_MS = 30_000;
const usage = 'usage: bun conductor/tools/capture-state.ts <bot> [--name <fixture>]';
let parsed: ReturnType<typeof parseArgs<{ allowPositionals: true; options: { name: { type: 'string' } } }>>;
try {
    parsed = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { name: { type: 'string' } } });
} catch (e) {
    console.error(`${errMessage(e)}\n${usage}`);
    process.exit(2);
}
const [bot, ...extra] = parsed.positionals;
const fixture = parsed.values.name;
if (!bot || extra.length) {
    console.error(usage);
    process.exit(2);
}
// Both end up in the output path, so neither may carry a separator or `..`.
for (const [what, value] of [
    ['bot', bot],
    ['fixture name', fixture],
] as const) {
    if (value !== undefined && !/^[\w-]+$/.test(value)) {
        console.error(`${what} "${value}" must be letters, digits, _ or -`);
        process.exit(2);
    }
}

let sdk: BotSDK | undefined;
try {
    sdk = await connectSdk(loadBotEnv(bot), 'observe');
    const state = trimState(await sdk.waitForReady(READY_TIMEOUT_MS));
    const file = join(REPO_ROOT, 'conductor/test/fixtures', `${fixture ?? bot}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    console.log(file);
} catch (e) {
    console.error(`capture failed: ${errMessage(e)}`);
    process.exitCode = 1;
} finally {
    if (sdk) await disconnectQuietly(sdk);
    process.exit(process.exitCode ?? 0);
}

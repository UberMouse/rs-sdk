// Write a bot's current world state, trimmed, as a test fixture for conductor/test/world.ts.
//
//   bun conductor/tools/capture-state.ts <bot> [--name <fixture>]
//
// Connects in observe mode, so it never steals control from a running task. Capture from a
// throwaway fixture bot (conductor/test/integration/harness.ts), not a real account: a fixture is
// committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BotSDK } from '../../sdk/index';
import { trimState } from '../lib/capture';
import { connectSdk, disconnectQuietly, loadBotEnv, REPO_ROOT } from '../lib/env';
import { errMessage } from '../lib/util';

const READY_TIMEOUT_MS = 30_000;
const args = process.argv.slice(2);
const nameFlag = args.indexOf('--name');
const fixture = nameFlag >= 0 ? args[nameFlag + 1] : undefined;
const bot = args.find((a, i) => !a.startsWith('--') && i !== nameFlag + 1);
if (!bot || (nameFlag >= 0 && !fixture)) {
    console.error('usage: bun conductor/tools/capture-state.ts <bot> [--name <fixture>]');
    process.exit(2);
}
if (fixture && !/^[\w-]+$/.test(fixture)) {
    console.error(`fixture name "${fixture}" must be letters, digits, _ or -`);
    process.exit(2);
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

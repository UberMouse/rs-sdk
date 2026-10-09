// Capture the bot's game canvas to a PNG so an agent can look at it with Read.
//
//   bun conductor/tools/screenshot.ts <bot> [out.png]
//
// Connects in observe mode, so it never steals control from a running task.
// Needs the rendering browser client (conductor/tools/client.ts); the headless
// lite client has no pixels to capture.
import type { BotSDK } from '../../sdk/index';
import { connectSdk, disconnectQuietly, loadBotEnv } from '../lib/env';
import { captureScreenshot } from '../lib/screenshot';
import { errMessage } from '../lib/util';

const [name, outArg] = process.argv.slice(2);
if (!name) {
    console.error('usage: bun conductor/tools/screenshot.ts <bot> [out.png]');
    process.exit(2);
}
const env = loadBotEnv(name);
let sdk: BotSDK | undefined;

try {
    sdk = await connectSdk(env, 'observe');
    const path = await captureScreenshot(sdk, env.username, outArg);
    console.log(path);
} catch (e) {
    console.error(`screenshot failed: ${errMessage(e)}`);
    process.exitCode = 1;
} finally {
    if (sdk) await disconnectQuietly(sdk);
    process.exit(process.exitCode ?? 0);
}

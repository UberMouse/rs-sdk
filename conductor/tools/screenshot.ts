// Capture the bot's game canvas to a PNG so an agent can look at it with Read.
//
//   bun conductor/tools/screenshot.ts <bot> [out.png]
//
// Connects in observe mode, so it never steals control from a running task.
// Needs the rendering browser client (conductor/tools/client.ts); the headless
// lite client has no pixels to capture.
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { loadBotEnv } from '../lib/env';
import { captureScreenshot } from '../lib/screenshot';

const [name, outArg] = process.argv.slice(2);
if (!name) {
    console.error('usage: bun conductor/tools/screenshot.ts <bot> [out.png]');
    process.exit(2);
}
const env = loadBotEnv(name);
const sdk = new BotSDK({
    botUsername: env.username,
    password: env.password,
    gatewayUrl: deriveGatewayUrl(env.server),
    connectionMode: 'observe',
    autoLaunchBrowser: false,
    autoReconnect: false,
    showChat: false,
});

try {
    await sdk.connect();
    const path = await captureScreenshot(sdk, env.username, outArg);
    console.log(path);
} catch (e: any) {
    console.error(`screenshot failed: ${e?.message ?? e}`);
    process.exitCode = 1;
} finally {
    await Promise.race([sdk.disconnect(), new Promise(r => setTimeout(r, 3000))]);
    process.exit(process.exitCode ?? 0);
}

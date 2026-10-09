import { runScript } from '../../sdk/runner';

await runScript(async ({ bot, sdk }) => {
    const r = await bot.skipTutorial();
    console.log(r);
    const p = sdk.getState()?.player;
    return { pos: p && [p.worldX, p.worldZ] };
}, { timeout: 120_000 });

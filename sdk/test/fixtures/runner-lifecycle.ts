import { runScript } from '../../runner';

const mode = process.argv[2];
const options = { printState: false, timeout: 60_000 };

if (mode === 'consecutive') {
    const first = await runScript(async () => {}, options);
    const second = await runScript(async () => {
        // Outlast the old cleanup's five-second forced exit.
        await Bun.sleep(5500);
        console.log('SECOND_SCRIPT_FINISHED');
    }, options);
    console.log(`RUN_FINISHED:${first.success}:${second.success}`);
} else if (mode === 'failure') {
    const result = await runScript(async () => {
        throw new Error('expected script failure');
    }, options);
    console.log(`RUN_FINISHED:${result.success}:${result.error?.message}`);
} else if (mode === 'success') {
    const result = await runScript(async () => {}, options);
    console.log(`RUN_FINISHED:${result.success}`);
} else {
    throw new Error(`Unknown runner lifecycle mode: ${mode}`);
}

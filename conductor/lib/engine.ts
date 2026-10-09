import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { REPO_ROOT, sleep } from './env';
import { findFood, INTERRUPTS } from './interrupts';
import { captureScreenshot } from './screenshot';
import { checkStops, describeStop, validateStops, type StopCondition } from './stop';
import type { Step, TaskContext, TaskDef, TaskResult, TaskStatus } from './task';
import { isLowHp } from './threat';
import { distance, errMessage, fileStamp, INVENTORY_SLOTS, memoryCounter, xpGainedSince } from './util';

/** The client must publish a new tick within this long, else the run is `stuck`. */
const TICK_STALL_MS = 30_000;
/** Consecutive loops with no applicable step before the run fails (covers mid-animation gaps). */
const MAX_IDLE_LOOPS = 20;
/** One game tick; the wait between idle loops. */
const IDLE_POLL_MS = 600;
export const DEFAULT_STUCK_AFTER_MS = 90_000;
export const DEFAULT_STEP_TIMEOUT_MS = 120_000;
const DEFAULT_PROGRESS_EVERY_MS = 30_000;

export interface ExecuteOptions {
    bot: BotActions;
    sdk: BotSDK;
    botName: string;
    rawParams: unknown;
    stops: StopCondition[];
    /** Print a progress line this often. Default DEFAULT_PROGRESS_EVERY_MS. */
    progressEveryMs?: number;
}

function inventoryCounts(s: BotWorldState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of s.inventory) out[i.name] = (out[i.name] ?? 0) + i.count;
    return out;
}

/** What the watchdog compares: any change in XP, position, inventory counts or HP (regeneration) counts as progress. */
function progressSignature(s: BotWorldState): string {
    const xp = s.skills.reduce((n, k) => n + k.experience, 0);
    const p = s.player;
    const inv = s.inventory.map(i => `${i.id}x${i.count}`).join(',');
    return `${xp}|${p?.worldX},${p?.worldZ},${p?.level}|${inv}|${p?.hp}`;
}

const posOf = (s: BotWorldState) => (s.player ? { x: s.player.worldX, z: s.player.worldZ } : null);

function newRunId(task: string): string {
    return `${fileStamp()}-${task}`;
}

interface ActiveRun {
    runId: string;
    logFile: string;
    append(event: Record<string, unknown>): void;
}

/** The run whose NDJSON log is open, until its result is written. */
let activeRun: ActiveRun | null = null;

/** Lets a signal handler record a result for the run in flight; null when none is open. */
export function currentRunLog(): ActiveRun | null {
    return activeRun;
}

export async function executeTask(def: TaskDef, opts: ExecuteOptions): Promise<TaskResult> {
    const { bot, sdk, botName, stops } = opts;
    const runId = newRunId(def.name);
    const logFile = join(REPO_ROOT, 'conductor/runs', botName, `${runId}.ndjson`);
    mkdirSync(dirname(logFile), { recursive: true });
    const startedAt = Date.now();
    const screenshots: string[] = [];

    const emit = (event: Record<string, unknown>) => {
        appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...event }) + '\n');
    };
    activeRun = { runId, logFile, append: emit };
    const say = (msg: string) => console.log(`[task:${def.name}] ${msg}`);

    const requireState = (): BotWorldState => {
        const s = sdk.getState();
        if (!s) throw new Error('no world state from client');
        return s;
    };

    const parsed = def.params.safeParse(opts.rawParams ?? {});
    const initial = requireState();
    const xpBefore: Record<string, number> = {};
    const levelBefore: Record<string, number> = {};
    for (const k of initial.skills) {
        xpBefore[k.name] = k.experience;
        levelBefore[k.name] = k.baseLevel;
    }
    const invBefore = inventoryCounts(initial);

    const memory: Record<string, unknown> = {};
    const ctx: TaskContext = {
        bot,
        sdk,
        botName,
        params: parsed.success ? parsed.data : undefined,
        state: requireState,
        log: (msg, data) => {
            say(msg);
            emit({ type: 'log', msg, data });
        },
        screenshot: async label => {
            try {
                const path = await captureScreenshot(sdk, botName, undefined, `${def.name}-${label}`);
                screenshots.push(path);
                emit({ type: 'screenshot', label, path });
                return path;
            } catch {
                return null;
            }
        },
        startTick: initial.tick,
        memory,
        previousPos: null,
        counter: name => memoryCounter(memory, name),
        inventoryFull: () => requireState().inventory.length >= INVENTORY_SLOTS,
        distanceTo: (x, z) => {
            const p = requireState().player;
            return p ? distance({ x: p.worldX, z: p.worldZ }, { x, z }) : Infinity;
        },
    };
    let currentPos = posOf(initial);

    const stepRuns: Record<string, number> = {};
    let loops = 0;
    let lastStep: string | null = null;

    /** Best effort, once: leave the bot above the low-HP line when food is at hand. Never throws. */
    const eatIfHurt = async () => {
        try {
            const s = sdk.getState();
            const food = s && isLowHp(s) ? findFood(s) : undefined;
            if (food) await bot.eatFood(food);
        } catch {
            // The result still reports the HP and combat state the bot was left in.
        }
    };

    const finish = async (status: TaskStatus, reason: string): Promise<TaskResult> => {
        activeRun = null;
        if (status !== 'done') await ctx.screenshot(status);
        await eatIfHurt();
        const s = sdk.getState();
        const xpGained = s ? xpGainedSince(s, xpBefore) : {};
        const levelsGained: Record<string, { from: number; to: number }> = {};
        const inventoryDelta: Record<string, number> = {};
        if (s) {
            for (const k of s.skills) {
                if (k.baseLevel > (levelBefore[k.name] ?? k.baseLevel)) {
                    levelsGained[k.name] = { from: levelBefore[k.name] ?? k.baseLevel, to: k.baseLevel };
                }
            }
            const invAfter = inventoryCounts(s);
            for (const name of new Set([...Object.keys(invBefore), ...Object.keys(invAfter)])) {
                const d = (invAfter[name] ?? 0) - (invBefore[name] ?? 0);
                if (d !== 0) inventoryDelta[name] = d;
            }
        }
        const p = s?.player;
        const result: TaskResult = {
            task: def.name,
            bot: botName,
            runId,
            status,
            reason,
            params: ctx.params ?? opts.rawParams,
            durationMs: Date.now() - startedAt,
            loops,
            stepRuns,
            lastStep,
            xpGained,
            levelsGained,
            inventoryDelta,
            finalPos: p ? { x: p.worldX, z: p.worldZ, level: p.level } : null,
            hp: p ? { current: p.hp, max: p.maxHp } : null,
            inCombat: p ? p.combat.inCombat : null,
            screenshots,
            logFile,
        };
        emit({ type: 'result', ...result });
        say(`${status}: ${reason}`);
        return result;
    };

    emit({ type: 'start', task: def.name, bot: botName, params: opts.rawParams, stops });

    if (!parsed.success) {
        return finish(
            'error',
            `invalid params: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
        );
    }
    try {
        validateStops(stops, initial);
    } catch (e) {
        return finish('error', errMessage(e));
    }
    say(`start ${JSON.stringify(ctx.params)}${stops.length ? ` until ${stops.map(describeStop).join(' | ')}` : ''}`);

    const start = initial.player;
    if (start?.combat.inCombat)
        return finish('failed', `in combat at (${start.worldX},${start.worldZ}); handle the attacker first`);
    try {
        const refused = await def.preflight?.(ctx);
        if (refused) return finish('failed', `preflight: ${refused}`);
    } catch (e) {
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `preflight threw: ${errMessage(e)}`);
    }

    const steps: Step[] = [...INTERRUPTS, ...def.steps];
    const stuckAfterMs = def.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
    const stepTimeoutMs = def.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const progressEveryMs = opts.progressEveryMs ?? DEFAULT_PROGRESS_EVERY_MS;

    let signature = progressSignature(initial);
    let lastProgressAt = Date.now();
    let lastTick = initial.tick;
    let lastTickAt = Date.now();
    let lastReportAt = Date.now();
    let idleLoops = 0;

    try {
        for (;;) {
            loops++;
            const s = requireState();
            ctx.previousPos = currentPos;
            currentPos = posOf(s);

            // Watchdog: the client must keep ticking, and the bot must keep changing something.
            if (s.tick !== lastTick) {
                lastTick = s.tick;
                lastTickAt = Date.now();
            } else if (Date.now() - lastTickAt > TICK_STALL_MS) {
                return finish('stuck', `client stopped publishing ticks for ${TICK_STALL_MS / 1000}s`);
            }
            const sig = progressSignature(s);
            if (sig !== signature) {
                signature = sig;
                lastProgressAt = Date.now();
            } else if (Date.now() - lastProgressAt > stuckAfterMs) {
                return finish(
                    'stuck',
                    `no XP, position, HP or inventory change for ${Math.round(stuckAfterMs / 1000)}s (last step: ${lastStep})`,
                );
            }

            const stopReason = checkStops(stops, s, xpBefore, startedAt);
            if (stopReason) return finish('done', stopReason);
            const complete = def.isComplete?.(ctx);
            if (complete) return finish('done', complete);

            if (Date.now() - lastReportAt >= progressEveryMs) {
                lastReportAt = Date.now();
                const gained = Object.entries(xpGainedSince(s, xpBefore))
                    .map(([n, d]) => `${n} +${d}`)
                    .join(', ');
                say(
                    `progress ${Math.round((Date.now() - startedAt) / 1000)}s: ${gained || 'no xp yet'}; steps ${JSON.stringify(stepRuns)}`,
                );
                emit({ type: 'progress', stepRuns, gained });
            }

            const step = steps.find(st => st.when(ctx));
            if (!step) {
                // Nothing applicable can be a transient state (mid-animation); give it a few ticks.
                if (++idleLoops > MAX_IDLE_LOOPS) return finish('failed', 'no step applies to the current state');
                await sleep(IDLE_POLL_MS);
                continue;
            }
            idleLoops = 0;
            if (step.name !== lastStep) emit({ type: 'step', step: step.name });
            lastStep = step.name;
            stepRuns[step.name] = (stepRuns[step.name] ?? 0) + 1;

            let timer: ReturnType<typeof setTimeout> | undefined;
            const running = step.run(ctx);
            const outcome = await Promise.race([
                running,
                new Promise<{ timeout: true }>(r => {
                    timer = setTimeout(() => r({ timeout: true }), stepTimeoutMs);
                }),
            ]).finally(() => clearTimeout(timer));
            // A timed-out step is abandoned but keeps running; log its late failure instead of leaving it unhandled.
            if (outcome && 'timeout' in outcome)
                running.catch(e => emit({ type: 'abandoned-step-error', step: step.name, message: errMessage(e) }));

            // Yield to the macrotask queue: a step that returns without awaiting I/O (e.g. a
            // dialog interrupt that stays applicable) would otherwise loop on microtasks only
            // and starve the step timeout, watchdog and websocket frames.
            await sleep(0);

            if (outcome && 'timeout' in outcome)
                return finish('stuck', `step "${step.name}" ran over ${stepTimeoutMs / 1000}s`);
            if (outcome && 'fail' in outcome) return finish('failed', `${step.name}: ${outcome.fail}`);
            if (outcome && 'done' in outcome) return finish('done', `${step.name}: ${outcome.done}`);
        }
    } catch (e) {
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `${lastStep ?? 'setup'} threw: ${errMessage(e)}`);
    }
}

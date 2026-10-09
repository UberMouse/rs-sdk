import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { REPO_ROOT } from './env';
import { INTERRUPTS } from './interrupts';
import { captureScreenshot } from './screenshot';
import { checkStops, describeStop, validateStops, type StopCondition } from './stop';
import type { Step, TaskContext, TaskDef, TaskResult, TaskStatus } from './task';

export interface ExecuteOptions {
    bot: BotActions;
    sdk: BotSDK;
    botName: string;
    rawParams: unknown;
    stops: StopCondition[];
    /** Print a progress line this often. Default 30s. */
    progressEveryMs?: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function inventoryCounts(s: BotWorldState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of s.inventory) out[i.name] = (out[i.name] ?? 0) + i.count;
    return out;
}

/** What the watchdog compares: any change in XP, position or inventory counts as progress. */
function progressSignature(s: BotWorldState): string {
    const xp = s.skills.reduce((n, k) => n + k.experience, 0);
    const p = s.player;
    const inv = s.inventory.map(i => `${i.id}x${i.count}`).join(',');
    return `${xp}|${p?.worldX},${p?.worldZ},${p?.level}|${inv}`;
}

function newRunId(task: string): string {
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${task}`;
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

    const ctx: TaskContext<any> = {
        bot,
        sdk,
        botName,
        params: parsed.success ? parsed.data : undefined,
        state: requireState,
        log: (msg, data) => {
            say(msg);
            emit({ type: 'log', msg, ...data });
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
        memory: { __startTick: initial.tick },
    };

    const stepRuns: Record<string, number> = {};
    let loops = 0;
    let lastStep: string | null = null;

    const finish = async (status: TaskStatus, reason: string): Promise<TaskResult> => {
        if (status !== 'done') await ctx.screenshot(status);
        const s = sdk.getState();
        const xpGained: Record<string, number> = {};
        const levelsGained: Record<string, { from: number; to: number }> = {};
        const inventoryDelta: Record<string, number> = {};
        if (s) {
            for (const k of s.skills) {
                const d = k.experience - (xpBefore[k.name] ?? k.experience);
                if (d > 0) xpGained[k.name] = d;
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
            screenshots,
            logFile,
        };
        emit({ type: 'result', ...result });
        say(`${status}: ${reason}`);
        return result;
    };

    emit({ type: 'start', task: def.name, bot: botName, params: opts.rawParams, stops });

    if (!parsed.success) {
        return finish('error', `invalid params: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    }
    try {
        validateStops(stops, initial);
    } catch (e: any) {
        return finish('error', e.message);
    }
    say(`start ${JSON.stringify(ctx.params)}${stops.length ? ` until ${stops.map(describeStop).join(' | ')}` : ''}`);

    const refused = await def.preflight?.(ctx);
    if (refused) return finish('failed', `preflight: ${refused}`);

    const steps: Step<any>[] = [...INTERRUPTS, ...def.steps];
    const stuckAfterMs = def.stuckAfterMs ?? 90_000;
    const stepTimeoutMs = def.stepTimeoutMs ?? 120_000;
    const progressEveryMs = opts.progressEveryMs ?? 30_000;

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

            // Watchdog (FailSafeThread): the client must keep ticking, and the bot must keep changing something.
            if (s.tick !== lastTick) {
                lastTick = s.tick;
                lastTickAt = Date.now();
            } else if (Date.now() - lastTickAt > 30_000) {
                return finish('stuck', 'client stopped publishing ticks for 30s');
            }
            const sig = progressSignature(s);
            if (sig !== signature) {
                signature = sig;
                lastProgressAt = Date.now();
            } else if (Date.now() - lastProgressAt > stuckAfterMs) {
                return finish('stuck', `no XP, position or inventory change for ${Math.round(stuckAfterMs / 1000)}s (last step: ${lastStep})`);
            }

            const stopReason = checkStops(stops, s, xpBefore, startedAt);
            if (stopReason) return finish('done', stopReason);
            const complete = def.isComplete?.(ctx);
            if (complete) return finish('done', complete);

            if (Date.now() - lastReportAt >= progressEveryMs) {
                lastReportAt = Date.now();
                const gained = s.skills
                    .map(k => [k.name, k.experience - (xpBefore[k.name] ?? k.experience)] as const)
                    .filter(([, d]) => d > 0)
                    .map(([n, d]) => `${n} +${d}`)
                    .join(', ');
                say(`progress ${Math.round((Date.now() - startedAt) / 1000)}s: ${gained || 'no xp yet'}; steps ${JSON.stringify(stepRuns)}`);
                emit({ type: 'progress', stepRuns, gained });
            }

            const step = steps.find(st => st.when(ctx));
            if (!step) {
                // Nothing applicable can be a transient state (mid-animation); give it a few ticks.
                if (++idleLoops > 20) return finish('failed', 'no step applies to the current state');
                await sleep(600);
                continue;
            }
            idleLoops = 0;
            if (step.name !== lastStep) emit({ type: 'step', step: step.name });
            lastStep = step.name;
            stepRuns[step.name] = (stepRuns[step.name] ?? 0) + 1;

            let timer: ReturnType<typeof setTimeout> | undefined;
            const outcome = await Promise.race([
                step.run(ctx),
                new Promise<{ timeout: true }>(r => {
                    timer = setTimeout(() => r({ timeout: true }), stepTimeoutMs);
                }),
            ]).finally(() => clearTimeout(timer));

            if (outcome && 'timeout' in outcome) return finish('stuck', `step "${step.name}" ran over ${stepTimeoutMs / 1000}s`);
            if (outcome && 'fail' in outcome) return finish('failed', `${step.name}: ${outcome.fail}`);
            if (outcome && 'done' in outcome) return finish('done', `${step.name}: ${outcome.done}`);
        }
    } catch (e: any) {
        emit({ type: 'exception', message: e?.message, stack: e?.stack });
        return finish('error', `${lastStep ?? 'setup'} threw: ${e?.message ?? e}`);
    }
}

// Runs one task to its TaskResult. Preflight runs first, then the close of a modal an earlier run left
// open (closeLeftover), then the loop. Each loop the first guard (the shared ones in lib/interrupts.ts,
// then the task's own) whose `when()` holds runs, else the first of the task's steps whose `when()`
// passes. A generator step is interpreted (core/interpret.ts) with the same guards and the stops,
// watchdog and step budget as `onTick`, so they act at every tick of its waits.
// All I/O goes through the injected driver and sinks, so tests run a task on a TimelineDriver.
import type { BotWorldState } from '../../sdk/types';
import { type Driver, type Guard, guardsUnder, interpret, type Interpretation, TickStall } from '../core/interpret';
import type { ActionContext } from '../actions/context';
import type { Pathfinder } from '../actions/paths';
import type { WalkWorld } from './walk-graph';
import { clearStrayChoice, dismiss, leftoverModal, strayChoice } from '../actions/dismiss';
import { eat } from '../actions/eat';
import { closeModalUntil } from '../actions/modal';
import { type Command, log, type Op, wait } from '../core/op';
import { type BankMemory, bankMemory, watchBank } from './bank-memory';
import { sleep } from './env';
import {
    deathGuard,
    findFood,
    guardLabel,
    GUARDS,
    isAttacked,
    lowHpGuard,
    ownFight,
    underFire,
    wildernessGuard,
} from './interrupts';
import { checkStops, describeStop, validateStops, type StopCondition } from './stop';
import {
    type Outcome,
    type Sinks,
    type Step,
    stepBudgetTicks as budgetTicksOf,
    type TaskContext,
    type TaskDef,
    type TaskResult,
    type TaskStatus,
} from './task';
import { isLowHp } from './threat';
import { distance, errMessage, INVENTORY_SLOTS, mapCounter, xpGainedSince } from './util';

/** The client must publish a new tick within this long, else the run is `stuck`. */
export const TICK_STALL_MS = 30_000;
/** Consecutive loops with no applicable step before the run fails (covers mid-animation gaps). */
const MAX_IDLE_LOOPS = 20;
export const DEFAULT_STUCK_AFTER_MS = 90_000;
export const DEFAULT_STEP_TIMEOUT_MS = 120_000;
const DEFAULT_PROGRESS_EVERY_MS = 30_000;
/**
 * Commands other than waits a generator step may yield within one tick before the run fails: it
 * bounds a loop of commands that settle without a tick passing, which guards and stops never see.
 */
export const MAX_STEP_COMMANDS = 1000;

/** What the run-start close of a leftover modal is reported as, in `stepRuns` and the step events. */
export const LEFTOVER_STEP = 'close-leftover';
/** Ticks the run-start close waits for the first of its two closes (closeModalUntil). */
export const LEFTOVER_CLOSE_TICKS = 5;

/**
 * Ticks a `done` run that ends in a fight waits for it to end (60 s: long enough for one slow kill).
 */
export const SETTLE_TICKS = 100;

/** Attacked, or still fighting its own target (one that is not hitting back, or not yet). */
const inFight = (s: BotWorldState) => isAttacked(s) || ownFight(s);

/**
 * The HP floor of `TaskDef.holdsDialog`: the hold widens the low-hp eat window from 50% of max HP down to
 * max(HOLD_HP_FLOOR_MIN, HOLD_HP_FLOOR_FRACTION of max), never to death. At or below it the guard eats even if the
 * eat closes the dialog.
 */
export const HOLD_HP_FLOOR_MIN = 8;
export const HOLD_HP_FLOOR_FRACTION = 0.25;

/** What a choice dialog found open at the start is called, when the task does not drive dialogs itself. */
const STRAY_CHOICE = 'choice dialog';

/**
 * Closes `what` (leftoverModal), found open before the run's first step. A modal blocks loc and NPC
 * interaction, and no guard closes an op's own interface, a bank, a shop or a skill menu, so one left by
 * a killed run or a failed close would strand every later task. Bounded by closeModalUntil: two closes,
 * LEFTOVER_CLOSE_TICKS + 1 ticks. A stray choice dialog is declined or closed via clearStrayChoice instead.
 * One that stays open is logged and the run goes on.
 *
 * It runs after preflight, which therefore sees the modal still open, and under the critical guards
 * only (death, the Wilderness, and any task guard marked critical): the others act through the game,
 * which the open modal blocks (the low-HP guard's eat is refused under it, the interface guard would
 * race this close), and they get their turn at the first loop, at most LEFTOVER_CLOSE_TICKS + 1 ticks
 * later.
 */
function* closeLeftover(ctx: ActionContext, what: string): Op<Outcome> {
    yield* log(`${what} left open before the run: clearing it`);
    if (what === STRAY_CHOICE) {
        const c = yield* clearStrayChoice(ctx);
        if (!c.ok) yield* log(`${what} left open before the run did not clear: ${c.message}`);
        return;
    }
    const r = yield* closeModalUntil(ctx, what, s => !leftoverModal(s), LEFTOVER_CLOSE_TICKS);
    if (!r.ok) yield* log(`${what} left open before the run did not close: ${r.message}`);
}

/**
 * Eats once if HP is still low, after clearing a dialog or informational modal that would swallow the
 * eat (as bot.eatFood's dismissBlockingUI does). The caller skips it under a bank or shop, which this
 * leaves open.
 */
function* eatBeforeLeaving(ctx: ActionContext): Op<void> {
    yield* dismiss(ctx);
    const s = ctx.state();
    const food = isLowHp(s) ? findFood(s) : undefined;
    if (food) yield* eat(ctx, food);
}

/** A zero-tick wait: a point where the interpreter calls `onTick`, which then cancels the step. */
const CHECKPOINT: Command = { type: 'wait', label: 'command cap', until: () => false, ticks: 0 };

export interface ExecuteOptions {
    driver: Driver;
    sinks: Sinks;
    /** Wall-clock milliseconds for the watchdog, `minutes:` stops and progress lines. Default `driver.now()`. */
    now?: () => number;
    /** Routes for the walkTo op (TaskContext.pathfinder); default the SDK's collision data. */
    pathfinder?: Pathfinder;
    /** Where the walkTo op plans its way (TaskContext.walkWorld); default the world index's. */
    walkWorld?: WalkWorld;
    /**
     * The bank as the plan last saw it open before this run, item name -> count (TaskContext.bank, which the run's
     * own states showing the bank open update); absent when no plan has seen it. Recorded with the run's inputs, so
     * a replay plans as the run did.
     */
    bank?: Readonly<Record<string, number>>;
    botName: string;
    runId: string;
    /** Where the event sink writes; reported in the result. */
    logFile: string;
    rawParams: unknown;
    stops: StopCondition[];
    /** Print a progress line this often. Default DEFAULT_PROGRESS_EVERY_MS. */
    progressEveryMs?: number;
    /**
     * A stop from outside the task (a plan's `until` and its own stops), checked after `stops` at the
     * same points. A non-null return ends the run `done` with it as the reason.
     */
    externalStop?: (s: BotWorldState) => string | null;
    /** The runId of the plan this run is a phase of; copied into the result. */
    partOf?: string;
}

/** The bank memory's count of an item by name, case aside: 0 for one it does not hold. */
const bankCount =
    (bank: BankMemory) =>
    (item: string): number => {
        const name = item.toLowerCase();
        let n = 0;
        for (const [k, count] of bank.counts() ?? []) if (k.toLowerCase() === name) n += count;
        return n;
    };

/** `by` is the step or guard that ended the run (TaskResult.endedBy). */
type End = { status: TaskStatus; reason: string; by?: string };

/** Item name -> count held, a stack counted as its size. */
export function inventoryCounts(s: BotWorldState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of s.inventory) out[i.name] = (out[i.name] ?? 0) + i.count;
    return out;
}

/**
 * What the watchdog compares: any change in XP, position, inventory counts or HP (regeneration) counts as
 * progress. `hp: false` leaves HP out, for comparisons where regeneration is not progress (a plan's idle rail).
 */
export function progressSignature(s: BotWorldState, { hp = true }: { hp?: boolean } = {}): string {
    const xp = s.skills.reduce((n, k) => n + k.experience, 0);
    const p = s.player;
    const inv = s.inventory.map(i => `${i.id}x${i.count}`).join(',');
    const base = `${xp}|${p?.worldX},${p?.worldZ},${p?.level}|${inv}`;
    return hp ? `${base}|${p?.hp}` : base;
}

const posOf = (s: BotWorldState) => (s.player ? { x: s.player.worldX, z: s.player.worldZ } : null);

const isOp = (x: unknown): x is Op<Outcome> => typeof x === 'object' && x !== null && 'next' in x;

/**
 * An `async` step, guard or preflight (from a cast or plain JS, as the types allow none) returns a
 * promise that would run on unobserved, out of reach of the guards and stops. True for one, whose
 * rejection is then handled.
 */
function strayPromise(x: unknown): boolean {
    if (!(x instanceof Promise)) return false;
    x.catch(() => {});
    return true;
}

/**
 * A guard's `run` returned a promise. Thrown from the guard wrapper, so it ends the run whether the
 * guard fired between steps or inside an interpreted wait; its message is the run's reason.
 */
class AsyncGuard extends Error {
    override name = 'AsyncGuard';
}

function ended(name: string, outcome: Outcome): End | null {
    if (outcome && 'fail' in outcome) return { status: 'failed', reason: `${name}: ${outcome.fail}`, by: name };
    if (outcome && 'done' in outcome) return { status: 'done', reason: `${name}: ${outcome.done}`, by: name };
    return null;
}

const unexpected = (name: string, r: Interpretation<Outcome>): End => ({
    status: 'error',
    reason: `step "${name}" ended unexpectedly: ${JSON.stringify(r)}`,
});

/**
 * Delegates to `op`, counting each command other than a wait with `count`. When `count` reports the
 * cap just passed, it yields a zero-tick wait in place of that command, where `onTick` reports the
 * overrun and the interpreter cancels the step, running its `finally` blocks. Hand-rolled because
 * `yield*` can't count.
 */
function* capped<T>(op: Op<T>, count: () => boolean): Op<T> {
    let resume: { value: unknown } | { error: unknown } = { value: undefined };
    for (;;) {
        const r: IteratorResult<Command, T> = 'error' in resume ? op.throw(resume.error) : op.next(resume.value);
        if (r.done) return r.value;
        const cmd: Command = r.value;
        if (cmd.type !== 'wait' && cmd.type !== 'critical' && count()) {
            try {
                yield CHECKPOINT;
            } catch (error) {
                resume = { error };
                continue;
            }
        }
        try {
            resume = { value: yield cmd };
        } catch (error) {
            resume = { error };
        }
    }
}

/** Any task, whatever its memory type: the engine only creates its memory and hands it to the steps. */
type AnyTaskDef = TaskDef<TaskDef['params'], object>;

export async function executeTask(def: AnyTaskDef, opts: ExecuteOptions): Promise<TaskResult> {
    const { sinks, botName, runId, logFile, stops } = opts;
    // The bank from the plan's record on, as last seen open: what the run's own banking shows replaces it, so a
    // later walk does not detour for an item the run has withdrawn or found missing.
    const bankSeen = opts.bank && bankMemory(new Map(Object.entries(opts.bank)));
    const driver = bankSeen ? watchBank(opts.driver, bankSeen) : opts.driver;
    const now = opts.now ?? (() => driver.now());
    const startedAt = now();
    const screenshots: string[] = [];

    const emit = (event: Record<string, unknown>) => sinks.event(event);
    const say = (msg: string) => sinks.print(`[task:${def.name}] ${msg}`);

    const parsed = def.params.safeParse(opts.rawParams ?? {});
    const initial = driver.state();
    const xpBefore: Record<string, number> = {};
    const levelBefore: Record<string, number> = {};
    for (const k of initial.skills) {
        xpBefore[k.name] = k.experience;
        levelBefore[k.name] = k.baseLevel;
    }
    const invBefore = inventoryCounts(initial);

    const stuckAfterMs = def.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
    const stepTimeoutMs = def.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const stepBudgetTicks = budgetTicksOf(stepTimeoutMs);
    const progressEveryMs = opts.progressEveryMs ?? DEFAULT_PROGRESS_EVERY_MS;

    const counters = new Map<string, number>();
    /** Each step's streak counts, dropped when its `when` is checked false. */
    const streaks = new Map<Step<unknown, object>, Map<string, number>>();
    /** The step whose `run` is in progress; it owns the streaks `ctx.streak` returns. */
    let running: Step<unknown, object> | null = null;
    /** The tick the op runOp is interpreting started at, which its tick budget counts from; null between ops. */
    let opStartTick: number | null = null;
    /** Best-effort screenshot into this run's log and result; null where the client does not render. */
    const takeScreenshot = async (label: string): Promise<string | null> => {
        try {
            const path = await sinks.screenshot(`${def.name}-${label}`);
            if (!path) return null;
            screenshots.push(path);
            emit({ type: 'screenshot', label, path });
            return path;
        } catch {
            return null;
        }
    };
    const ctx: TaskContext<unknown, object> = {
        botName,
        params: parsed.success ? parsed.data : undefined,
        state: () => driver.state(),
        log: (msg, data) => {
            say(msg);
            emit({ type: 'log', msg, data });
        },
        startTick: initial.tick,
        memory: def.memory?.() ?? {},
        previousPos: null,
        counter: name => mapCounter(counters, name),
        streak: name => {
            if (!running) throw new Error(`ctx.streak("${name}") called outside a step's run`);
            let counts = streaks.get(running);
            if (!counts) {
                counts = new Map();
                streaks.set(running, counts);
            }
            return mapCounter(counts, name);
        },
        ...(opts.pathfinder && { pathfinder: opts.pathfinder }),
        ...(opts.walkWorld && { walkWorld: opts.walkWorld }),
        ...(bankSeen && { bank: bankCount(bankSeen) }),
        stepTicksLeft: () => (opStartTick === null ? undefined : opStartTick + stepBudgetTicks - driver.state().tick),
        inventoryFull: () => driver.state().inventory.length >= INVENTORY_SLOTS,
        distanceTo: (x, z) => {
            const p = driver.state().player;
            return p ? distance({ x: p.worldX, z: p.worldZ }, { x, z }) : Infinity;
        },
    };
    let currentPos = posOf(initial);

    // Ops' log and screenshot commands land in this run's log and result like the context's own.
    const view: Driver = {
        state: () => driver.state(),
        nextTick: () => driver.nextTick(),
        send: action => driver.send(action),
        scan: radius => driver.scan(radius),
        log: ctx.log,
        screenshot: takeScreenshot,
        now: () => driver.now(),
    };

    const stepRuns: Record<string, number> = {};
    let loops = 0;
    let lastStep: string | null = null;

    const stateOrNull = (): BotWorldState | null => {
        try {
            return driver.state();
        } catch {
            return null;
        }
    };

    /**
     * Best effort, once: leave the bot above the low-HP line when food is at hand. A run can end on the
     * tick HP drops (a stop, the watchdog, a step's `done`, another guard's `fail`) before the low-HP
     * guard acts. Runs with no guards or stops, bounded by the ops' own tick limits and by TickStall.
     * Skipped under an open bank or shop: the game refuses the eat there, so it would only delay the
     * result. Never throws.
     */
    const eatIfHurt = async () => {
        try {
            const s = stateOrNull();
            if (!s || s.bank.isOpen || s.shop.isOpen) return;
            if (isLowHp(s) && findFood(s)) await interpret(eatBeforeLeaving(ctx), { driver: view });
        } catch {
            // The result still reports the HP and combat state the bot was left in.
        }
    };

    // A dialog the run keeps open for the next phase: the eat would close it. Only above the HP floor: the hold
    // widens the low-hp eat window from 50% down to the floor, never to death; below it the guard eats even if
    // that closes the dialog.
    const holdsDialog = (s: BotWorldState) => {
        const p = s.player;
        return (
            parsed.success &&
            !!p &&
            p.hp > Math.max(HOLD_HP_FLOOR_MIN, Math.ceil(HOLD_HP_FLOOR_FRACTION * p.maxHp)) &&
            !!def.holdsDialog?.(ctx.params, s)
        );
    };

    /**
     * The task's `onEnd` cleanup, once, best effort: under no guards and no stops (the stop that ended the run
     * would fire again). Skipped when the params never parsed. Never throws; a failure is logged.
     */
    const runOnEnd = async () => {
        if (!def.onEnd || !parsed.success) return;
        try {
            await interpret(def.onEnd(ctx), { driver: view });
        } catch (e) {
            say(`onEnd failed: ${errMessage(e)}`);
        }
    };

    /** One per run, so the dialog guard fires at most once a tick even across consecutive steps. */
    const firedAt = new Map<string, number>();

    /**
     * A `done` run that ends in a fight (`inFight`) waits up to SETTLE_TICKS for it to end,
     * under the shared guards only and with no stops (the stop that ended the run would fire again);
     * TickStall still ends it. An abort guard that ends without an outcome (an eat) resumes the wait on
     * what is left of the budget; one that fails makes the run `failed`.
     */
    const settle = async (end: End): Promise<End> => {
        const from = driver.state().tick;
        const settled = (s: BotWorldState): End => ({
            ...end,
            reason: inFight(s)
                ? `${end.reason}; still in combat after ${SETTLE_TICKS} ticks`
                : `${end.reason}; fight settled in ${s.tick - from} ticks`,
        });
        try {
            for (;;) {
                const left = SETTLE_TICKS - (driver.state().tick - from);
                if (left <= 0) return settled(driver.state());
                const r = await interpret(
                    wait('settle fight', s => !inFight(s), left),
                    { driver: view, guards: settleGuards, firedAt },
                );
                if (r.kind === 'returned') return settled(r.value.state);
                if (r.kind === 'cancelled') return unexpected('settle fight', r);
                const e = ended(r.by, r.outcome);
                if (e) return { ...e, reason: `${end.reason}; ${e.reason}` };
            }
        } catch (e) {
            if (e instanceof TickStall) return { status: 'stuck', reason: `${end.reason}; ${e.message}` };
            return { status: 'error', reason: `${end.reason}; settle fight threw: ${errMessage(e)}` };
        }
    };

    /** The task's diagnostics hook, best effort: a throw is logged and the result carries none. */
    const readDiagnostics = (): { diagnostics?: Record<string, unknown>; warnings?: string[] } => {
        try {
            return def.diagnostics?.(ctx) ?? {};
        } catch (e) {
            say(`diagnostics failed: ${errMessage(e)}`);
            return {};
        }
    };

    const finish = async (endStatus: TaskStatus, endReason: string, endBy?: string): Promise<TaskResult> => {
        const atStop = stateOrNull();
        const keepsDialog = endStatus === 'done' && !!atStop && holdsDialog(atStop);
        const { status, reason, by } =
            endStatus === 'done' && atStop && inFight(atStop) && !keepsDialog
                ? await settle({ status: endStatus, reason: endReason, by: endBy })
                : { status: endStatus, reason: endReason, by: endBy };
        if (status !== 'done') await takeScreenshot(status);
        // Eating first: a slow onEnd must not delay it at low HP.
        if (by !== guardLabel(deathGuard.name) && !keepsDialog) await eatIfHurt();
        await runOnEnd();
        const s = stateOrNull();
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
        const extra = parsed.success ? readDiagnostics() : {};
        const result: TaskResult = {
            task: def.name,
            bot: botName,
            runId,
            ...(opts.partOf !== undefined && { partOf: opts.partOf }),
            status,
            reason,
            ...(by !== undefined && { endedBy: by }),
            params: ctx.params ?? opts.rawParams,
            durationMs: now() - startedAt,
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
            ...(extra.diagnostics && Object.keys(extra.diagnostics).length > 0 && { diagnostics: extra.diagnostics }),
            ...(extra.warnings && extra.warnings.length > 0 && { warnings: extra.warnings }),
        };
        for (const w of extra.warnings ?? []) say(`warning: ${w}`);
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
    // A task built without defineTask (a cast, JSON) bypasses the AllowableGuard type.
    // `allowGuards` counts too: it must not be a way round the refusal.
    const allowed: readonly string[] = [...(def.allow ?? []), ...(def.allowGuards?.(ctx.params) ?? [])];
    const critical = GUARDS.filter(g => g.critical && allowed.includes(g.name)).map(g => g.name);
    if (critical.length) return finish('error', `task allows critical guard(s): ${critical.join(', ')}`);
    // Guards share episodes, step counts and the suspend bookkeeping by name.
    const names = [...GUARDS, ...(def.guards ?? [])].map(g => g.name);
    const clashes = names.filter((n, i) => names.indexOf(n) !== i);
    if (clashes.length) return finish('error', `task guard name(s) taken: ${[...new Set(clashes)].join(', ')}`);
    say(`start ${JSON.stringify(ctx.params)}${stops.length ? ` until ${stops.map(describeStop).join(' | ')}` : ''}`);

    const start = initial.player;
    // The client's inCombat flag outlasts a fight: only an attacker or a recent hit refuses the start.
    if (start && isAttacked(initial) && !def.startInCombat?.(ctx.params, initial))
        return finish('failed', `in combat at (${start.worldX},${start.worldZ}); handle the attacker first`);
    try {
        const refused: unknown = def.preflight?.(ctx);
        if (strayPromise(refused))
            return finish('error', 'preflight returned a promise: async preflights are not supported');
        if (refused) return finish('failed', `preflight: ${String(refused)}`);
    } catch (e) {
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `preflight threw: ${errMessage(e)}`);
    }

    // Each guard's episode state, from when it first runs until its `when` is next checked false.
    const episodes = new Map<string, object>();
    const inWilderness = !!def.allowWilderness?.(ctx.params);
    const shared = GUARDS.filter(g => !allowed.includes(g.name) && !(inWilderness && g.name === wildernessGuard.name));
    const enabled = [...shared, ...(def.guards ?? [])];
    // In a fight (or just hit) at low HP with no food (where the guard would fail the run) a task that keeps going holds the guard
    // off; out of combat the guard still waits for HP to regenerate. `when` is pure, so food is read here.
    const goesOnWithoutFood = !!def.keepGoingWithoutFood?.(ctx.params);
    const wrap = (g: (typeof enabled)[number]): Guard => ({
        name: guardLabel(g.name),
        policy: g.policy,
        critical: g.critical,
        when: s =>
            g.when(s, ctx) &&
            !(goesOnWithoutFood && g.name === lowHpGuard.name && underFire(s) && !findFood(s)) &&
            !(g.name === lowHpGuard.name && holdsDialog(s)),
        cleared: () => episodes.delete(g.name),
        run: s => {
            const label = guardLabel(g.name);
            stepRuns[label] = (stepRuns[label] ?? 0) + 1;
            let episode = episodes.get(g.name);
            if (!episode) {
                episode = g.episode();
                episodes.set(g.name, episode);
            }
            const out: unknown = g.run(s, ctx, episode);
            if (strayPromise(out))
                throw new AsyncGuard(`guard "${label}" returned a promise: async guards are not supported`);
            return out as ReturnType<Guard['run']>;
        },
    });
    const guards = enabled.map(wrap);
    /** The settle runs under the shared guards only, sharing their per-guard state by name. */
    const settleGuards = shared.map(wrap);

    let signature = progressSignature(initial);
    let lastProgressAt = now();
    let lastTick = initial.tick;
    let lastTickAt = now();
    let lastReportAt = now();
    let idleLoops = 0;
    /** Calls of `opts.externalStop` so far: the one that fires is recorded, for the replay to fire on. */
    let externalChecks = 0;

    /**
     * Watchdog, stops (the task's, then the external one) and progress lines. Runs between steps and
     * on every check of a generator step's waits, often several times a tick: everything here
     * compares against the last change, so a repeat call on the same state changes nothing. A stop
     * ends the run, so the external one fires (and is emitted) at most once.
     */
    const checkRun = (s: BotWorldState): End | null => {
        const t = now();
        // Watchdog: the client must keep ticking, and the bot must keep changing something.
        if (s.tick !== lastTick) {
            lastTick = s.tick;
            lastTickAt = t;
        } else if (t - lastTickAt > TICK_STALL_MS) {
            return { status: 'stuck', reason: `client stopped publishing ticks for ${TICK_STALL_MS / 1000}s` };
        }
        const sig = progressSignature(s);
        if (sig !== signature) {
            signature = sig;
            lastProgressAt = t;
        } else if (t - lastProgressAt > stuckAfterMs) {
            return {
                status: 'stuck',
                reason: `no XP, position, HP or inventory change for ${Math.round(stuckAfterMs / 1000)}s (last step: ${lastStep})`,
            };
        }
        const stop = checkStops(stops, s, xpBefore, t - startedAt);
        if (stop) return { status: 'done', reason: stop };
        if (opts.externalStop) {
            const check = ++externalChecks;
            const external = opts.externalStop(s);
            if (external !== null) {
                // The recorder writes this as the record a replay stops at (core/drivers/recording.ts).
                emit({ type: 'external-stop', reason: external, tick: s.tick, check });
                return { status: 'done', reason: external };
            }
        }
        if (t - lastReportAt >= progressEveryMs) {
            lastReportAt = t;
            const gained = Object.entries(xpGainedSince(s, xpBefore))
                .map(([n, d]) => `${n} +${d}`)
                .join(', ');
            say(
                `progress ${Math.round((t - startedAt) / 1000)}s: ${gained || 'no xp yet'}; steps ${JSON.stringify(stepRuns)}`,
            );
            emit({ type: 'progress', stepRuns, gained });
        }
        return null;
    };

    /**
     * Interprets one step or guard op under `active`, with the stops, watchdog, tick budget and command
     * cap as `onTick`: the first of them to end the run cancels the op at its next check. No wall-clock
     * limit: a client that stops ticking is TickStall, and every command the live driver forwards is
     * bounded by the SDK's own timeouts.
     */
    const runOp = async (name: string, op: Op<Outcome>, active: readonly Guard[]): Promise<End | null> => {
        const startTick = driver.state().tick;
        let ending: End | null = null;
        let overrun: End | null = null;
        let countedTick = startTick;
        let commandsThisTick = 0;

        const onTick = (s: BotWorldState): string | null => {
            if (s.tick !== countedTick) {
                countedTick = s.tick;
                commandsThisTick = 0;
            }
            if (!ending) {
                const e =
                    checkRun(s) ??
                    overrun ??
                    (s.tick - startTick > stepBudgetTicks
                        ? {
                              status: 'stuck' as const,
                              reason: `step "${name}" ran over ${stepBudgetTicks} ticks (${stepTimeoutMs / 1000}s)`,
                          }
                        : null);
                if (e) ending = e;
            }
            return ending?.reason ?? null;
        };
        /** Counts one command; true for the first past the cap this tick. */
        const count = () => {
            if (++commandsThisTick !== MAX_STEP_COMMANDS + 1) return false;
            overrun = {
                status: 'failed',
                reason: `step "${name}" yielded over ${MAX_STEP_COMMANDS} commands in one tick (a loop that never waits?)`,
            };
            return true;
        };

        opStartTick = startTick;
        let r: Interpretation<Outcome>;
        try {
            r = await interpret(capped(op, count), { driver: view, guards: active, onTick, firedAt });
        } finally {
            opStartTick = null;
        }
        switch (r.kind) {
            case 'returned':
                return ended(name, r.value);
            case 'aborted':
                return ended(r.by, r.outcome);
            case 'cancelled':
                return ending ?? unexpected(name, r);
        }
    };

    /** A guard or step starts this loop: logged when it differs from the last. */
    const begin = (name: string) => {
        idleLoops = 0;
        if (name !== lastStep) emit({ type: 'step', step: name });
        lastStep = name;
    };

    try {
        const opening = driver.state();
        const leftover =
            leftoverModal(opening) ?? (strayChoice(opening) && !allowed.includes('dialog') ? STRAY_CHOICE : null);
        if (leftover) {
            begin(LEFTOVER_STEP);
            stepRuns[LEFTOVER_STEP] = 1;
            const criticalGuards = guards.filter(g => g.critical);
            const end = await runOp(LEFTOVER_STEP, closeLeftover(ctx, leftover), criticalGuards);
            if (end) return finish(end.status, end.reason, end.by);
        }
        for (;;) {
            loops++;
            const s = driver.state();
            ctx.previousPos = currentPos;
            currentPos = posOf(s);

            const end = checkRun(s);
            if (end) return finish(end.status, end.reason, end.by);
            const complete = def.isComplete?.(ctx);
            if (complete) return finish('done', complete);

            let stepEnd: End | null;
            const guard = guards.find(g => {
                if (g.when(s)) return true;
                g.cleared?.();
                return false;
            });
            if (guard) {
                begin(guard.name);
                const out = guard.run(s);
                stepEnd = isOp(out) ? await runOp(guard.name, out, guardsUnder(guards, guard)) : ended(guard.name, out);
            } else {
                // Every step's `when`, so a step that stopped applying loses its streaks even in a loop
                // where an earlier step runs.
                const applies = def.steps.map(st => st.when(ctx));
                for (const [i, st] of def.steps.entries()) if (!applies[i]) streaks.delete(st);
                const step = def.steps[applies.indexOf(true)];
                if (!step) {
                    // Nothing applicable can be a transient state (mid-animation); give it a few ticks.
                    if (++idleLoops > MAX_IDLE_LOOPS) return finish('failed', 'no step applies to the current state');
                    await driver.nextTick();
                    continue;
                }
                begin(step.name);
                stepRuns[step.name] = (stepRuns[step.name] ?? 0) + 1;
                running = step;
                try {
                    const out = step.run(ctx);
                    // A generator is an op, anything else is the outcome of a step that only decided. That
                    // value is trusted to be an Outcome: an object without fail/done is read as no outcome,
                    // and a string or number makes `'fail' in x` throw, which surfaces as the step having
                    // thrown.
                    if (strayPromise(out))
                        return finish('error', `step "${step.name}" returned a promise: async steps are not supported`);
                    stepEnd = isOp(out) ? await runOp(step.name, out, guards) : ended(step.name, out);
                } finally {
                    running = null;
                }
            }

            // Yield to the macrotask queue: a step that returns without awaiting I/O (e.g. a
            // dialog guard that stays applicable) would otherwise loop on microtasks only
            // and starve the watchdog and websocket frames.
            await sleep(0);

            if (stepEnd) return finish(stepEnd.status, stepEnd.reason, stepEnd.by);
        }
    } catch (e) {
        if (e instanceof TickStall) return finish('stuck', e.message);
        if (e instanceof AsyncGuard) return finish('error', e.message);
        emit({ type: 'exception', message: errMessage(e), stack: e instanceof Error ? e.stack : undefined });
        return finish('error', `${lastStep ?? 'setup'} threw: ${errMessage(e)}`);
    }
}

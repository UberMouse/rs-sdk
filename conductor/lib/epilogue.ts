// The end-of-run safety step: a run that ends not `done` with the bot under attack must not leave it
// defenceless. Nothing runs once the process exits, so the low-HP and death guards stop with it and a fight
// the run left open goes on unwatched.
//
// It runs from run-task.ts after the plan or task has its result, under no guards and no stops, bounded by
// EPILOGUE_TICKS, and only adds an `epilogue` to the RESULT: the run's status and reason are the run's own.
// In order, each pass: eat while HP is under the eat line and food is held; teleport (a standard-spellbook
// town teleport the bot can cast) when HP is low with no food, or when walking away has not ended the fight
// and HP has fallen meaningfully; hold and defend when the only foe is the bot's own fight and HP is fine;
// otherwise walk away from the attacker (a few legs, ended early once HP falls with the fight still on; a
// foe that follows is then fought where the bot stands), toward the last place the bot stood out of combat
// when that lies away from the fight, else directly away, never deeper into the Wilderness. With
// auto-retaliate off the bot would not defend itself where it stands, so it teleports at once when it can
// and otherwise keeps walking. It never attacks, picks nothing up, and does nothing at all when the bot is
// not under attack.
import type { BotWorldState } from '../../sdk/types';
import type { ActionContext } from '../actions/context';
import { dismiss } from '../actions/dismiss';
import { EAT_ATTEMPT_TICKS, eat } from '../actions/eat';
import type { Pathfinder } from '../actions/paths';
import { castTeleport, missingRunes, TELEPORT_WAIT_TICKS, TELEPORTS, type TeleportName } from '../actions/teleport';
import { walkTo } from '../actions/walk';
import { type Driver, interpret } from '../core/interpret';
import { log, type Op, ticks } from '../core/op';
import { attackers, diedSince, findFood, isAttacked, lowForAttackers, ownFight } from './interrupts';
import type { TaskResult } from './task';
import { errMessage, findSkill, TICK_MS } from './util';
import type { WalkWorld } from './walk-graph';
import { wildernessLevel } from './wilderness';

/** The whole epilogue's budget: 60 s of game time. */
export const EPILOGUE_TICKS = Math.ceil(60_000 / TICK_MS);
/** Ticks past the budget before the interpreter cancels whatever op is running (an eat or a cast that began inside it). */
export const EPILOGUE_GRACE_TICKS = 12;
/** Tiles to run from the attacker when walking directly away. */
export const FLEE_DISTANCE = 14;
/** Ticks one walk leg may take; HP and the fight are re-read between legs. */
export const FLEE_LEG_TICKS = 10;
/** Walk legs per epilogue before it stands its ground. */
export const MAX_FLEE_LEGS = 6;
/** Eats sent per epilogue, counting ones that showed no effect. */
export const MAX_EPILOGUE_EATS = 12;
/** A remembered safe spot closer than this (tiles) is no place to run to. */
export const MIN_SAFE_SPOT_DISTANCE = 6;
/** A remembered safe spot farther than this (tiles) is stale: the directional flee is used instead. */
export const MAX_SAFE_SPOT_DISTANCE = FLEE_DISTANCE * 2;
/** HP lost since a walk leg began, as a fraction of max HP, that counts as the fight following (a teleport). */
export const LOSING_FRACTION = 0.15;
/** Walk tolerance at a flee destination. */
const FLEE_TOLERANCE = 2;
/** The town teleports tried, in order: no quest needed. */
const ESCAPE_SPELLS: readonly TeleportName[] = ['lumbridge', 'varrock', 'falador', 'camelot'];
/** The server refuses a teleport above this Wilderness level. */
const MAX_TELEPORT_WILDERNESS_LEVEL = 20;
/** A result whose reason says the client is gone: nothing to act through. */
const CLIENT_GONE = /client stopped publishing|the SDK disconnected|no world state from client/i;

type Point = { x: number; z: number };
export type SafeSpot = Point & { level: number };

/**
 * Why the epilogue stopped, one of:
 * - `safe`: not under attack at the last state read (not hit, not fighting). A chaser outside attack reach that has
 *   not hit yet counts, so `safe` is not proof the chase is over. The epilogue also runs for `stopped` runs (an
 *   `--until` stop mid-fight), holding or defending up to 60 s of process time, deliberately. It cannot set
 *   auto-retaliate (no op for it). Ranged or fire attackers (Elvarg's dragonfire) are not solved by walking:
 *   eating or teleporting is the defence;
 * - `timeout`: still under attack when EPILOGUE_TICKS ran out;
 * - `died`: the bot died during it (the respawn clears combat, so this is not `safe`);
 * - `no player in state`: the client published no player;
 * - `out of time`: the interpreter cancelled it past the budget plus EPILOGUE_GRACE_TICKS;
 * - `cut short`: it was aborted by something else (the reason is in `cutShort`).
 */
export type EpilogueEnd = 'safe' | 'timeout' | 'died' | 'no player in state' | 'out of time' | 'cut short';

export interface Epilogue {
    /**
     * What it did, in order: `ate`, `walked`, `teleported <town>`, repeats as `ate x2`; `retaliate off` once when
     * auto-retaliate was off while the bot was under attack. Empty when nothing worked.
     */
    actions: string[];
    ended: EpilogueEnd;
    /** Free text for `ended: 'cut short'`; absent otherwise. */
    cutShort?: string;
    hpBefore: number | null;
    hpAfter: number | null;
    maxHp: number | null;
    inCombat: boolean | null;
    ticks: number;
}

/** What the generator has done so far, shared with its caller so a cut-short result keeps it. */
export interface EpilogueProgress {
    actions: string[];
    hpBefore: number | null;
}

/** Under attack: something hits the bot or it fights something. The epilogue works only on this. */
export const endangered = (s: BotWorldState): boolean => isAttacked(s) || ownFight(s);

/** Whether a result is one the epilogue follows: any run that did not end `done`, unless the client is gone. */
export const needsEpilogue = (r: Pick<TaskResult, 'status' | 'reason'>): boolean =>
    r.status !== 'done' && !CLIENT_GONE.test(r.reason);

const tileOf = (n: BotWorldState['nearbyNpcs'][number]): Point => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });

/** The NPC to run from: the nearest of those hitting the bot, else the one the bot fights. */
function foeOf(s: BotWorldState): Point | null {
    const hitting = attackers(s).sort((a, b) => a.distance - b.distance)[0];
    if (hitting) return tileOf(hitting);
    const c = s.player?.combat;
    const own = c?.targetType === 'npc' ? s.nearbyNpcs.find(n => n.index === c.targetIndex) : undefined;
    return own ? tileOf(own) : null;
}

const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Where to run, best first: the remembered safe spot when it lies away from the foe, then the tile
 * FLEE_DISTANCE directly away from it, then that direction turned by 45, -45, 90 and -90 degrees (a wall or
 * a dead end on the straight line). With no foe in view only the safe spot.
 */
export function fleeDestinations(s: BotWorldState, safe: SafeSpot | null): Point[] {
    const p = s.player;
    if (!p) return [];
    const here = { x: p.worldX, z: p.worldZ };
    const foe = foeOf(s);
    const out: Point[] = [];
    // Never deeper into the Wilderness (walk treats a destination as "tame" only from outside it): outside, drop
    // destinations inside; inside, keep only those with a lower level.
    const hereWild = wildernessLevel(p.level, here.x, here.z);
    const allowed = (d: Point) => {
        const w = wildernessLevel(p.level, d.x, d.z);
        return hereWild === 0 ? w === 0 : w < hereWild;
    };
    const awayX = foe ? here.x - foe.x : 0;
    const awayZ = foe ? here.z - foe.z : 0;
    const safeDistance = safe ? chebyshev(here, safe) : 0;
    if (
        safe &&
        safe.level === p.level &&
        safeDistance >= MIN_SAFE_SPOT_DISTANCE &&
        safeDistance <= MAX_SAFE_SPOT_DISTANCE
    ) {
        // Running to it must not run past the foe.
        const dot = (safe.x - here.x) * awayX + (safe.z - here.z) * awayZ;
        if ((!foe || dot > 0) && allowed(safe)) out.push({ x: safe.x, z: safe.z });
    }
    if (!foe) return out;
    // Standing on the foe's tile: any direction is away.
    const len = Math.hypot(awayX, awayZ);
    const dir = len === 0 ? { x: 1, z: 0 } : { x: awayX / len, z: awayZ / len };
    for (const turn of [0, 45, -45, 90, -90]) {
        const a = (turn * Math.PI) / 180;
        const x = dir.x * Math.cos(a) - dir.z * Math.sin(a);
        const z = dir.x * Math.sin(a) + dir.z * Math.cos(a);
        const d = { x: Math.round(here.x + x * FLEE_DISTANCE), z: Math.round(here.z + z * FLEE_DISTANCE) };
        if (allowed(d)) out.push(d);
    }
    return out;
}

/** The first escape teleport the bot can cast now (level, runes, outside Wilderness level 21+), if any. */
export function escapeSpell(s: BotWorldState): TeleportName | null {
    const p = s.player;
    if (!p || wildernessLevel(p.level, p.worldX, p.worldZ) > MAX_TELEPORT_WILDERNESS_LEVEL) return null;
    const magic = findSkill(s, 'Magic');
    if (!magic) return null;
    return (
        ESCAPE_SPELLS.find(
            name => magic.level >= TELEPORTS[name].level && missingRunes(s, TELEPORTS[name]).length === 0,
        ) ?? null
    );
}

/** `ate, ate, walked, walked` -> `ate x2, walked x2`. */
function collapse(actions: string[]): string[] {
    const out: string[] = [];
    let n = 0;
    for (let i = 0; i < actions.length; i++) {
        n++;
        if (actions[i + 1] !== actions[i]) {
            out.push(n > 1 ? `${actions[i]} x${n}` : actions[i]!);
            n = 0;
        }
    }
    return out;
}

/** The only NPC fighting the bot is the one it targets itself: a fight it chose, not one it was dragged into. */
const onlyOwnFight = (s: BotWorldState): boolean =>
    ownFight(s) && attackers(s).every(n => n.index === s.player?.combat.targetIndex);

/**
 * The epilogue as an op; `safe` is where the bot last stood out of combat. Null when the bot is not under attack
 * (nothing was done). Bounded by EPILOGUE_TICKS from the first state: an eat or a cast may finish a few ticks past it.
 * `progress` is filled as it goes, for a caller that cuts it short.
 */
export function* epilogue(
    ctx: ActionContext,
    safe: SafeSpot | null = null,
    progress: EpilogueProgress = { actions: [], hpBefore: null },
): Op<Epilogue | null> {
    const first = ctx.state();
    if (!first.player || !endangered(first)) return null;
    const startTick = first.tick;
    const deadline = startTick + EPILOGUE_TICKS;
    const actions = progress.actions;
    const hpBefore = first.player.hp;
    progress.hpBefore = hpBefore;
    const destinations = fleeDestinations(first, safe);
    let destination = 0;
    let legs = 0;
    let eats = 0;
    let teleported = false;
    let held = false;
    let stalled = false;
    let noted = false;
    let hpMark = hpBefore;
    let ended: EpilogueEnd = 'timeout';
    yield* log(
        `epilogue: bot under attack after a run that did not end done (hp ${hpBefore}/${first.player.maxHp}); keeping it alive`,
    );
    // A dialog swallows the eat and the walk; if it will not clear, the passes below meet that.
    yield* dismiss(ctx);

    for (;;) {
        const s = ctx.state();
        const p = s.player;
        if (!p) {
            ended = 'no player in state';
            break;
        }
        // Dying clears combat: without this it would read as safe.
        if (diedSince(s, startTick)) {
            ended = 'died';
            break;
        }
        if (!endangered(s)) {
            ended = 'safe';
            break;
        }
        const left = deadline - s.tick;
        if (left <= 0) break;
        const lowHp = lowForAttackers(s);
        const food = findFood(s);

        if (lowHp && food && eats < MAX_EPILOGUE_EATS) {
            eats++;
            const r = yield* eat(ctx, food, Math.min(EAT_ATTEMPT_TICKS, left));
            if (r.ok) actions.push('ate');
            // The eat's HP is not a fall or a rise of the fight's making.
            hpMark = ctx.state().player?.hp ?? hpMark;
            continue;
        }
        // The fight came along a walk leg when HP fell by a real amount, or is under the eat line and still falling.
        const losing = legs > 0 && (hpMark - p.hp >= Math.ceil(p.maxHp * LOSING_FRACTION) || (lowHp && p.hp < hpMark));
        const ownHold = !lowHp && onlyOwnFight(s);
        const target = destinations[destination];
        const atHold = !ownHold && (!target || legs >= MAX_FLEE_LEGS || stalled);
        // With auto-retaliate off the bot would not defend itself where it stands.
        const retaliateOff = s.autoRetaliateEnabled === false;
        const spell = !teleported && left >= TELEPORT_WAIT_TICKS ? escapeSpell(s) : null;
        if (atHold && retaliateOff && !noted) {
            noted = true;
            actions.push('retaliate off');
            yield* log('epilogue: retaliate off, the bot would not defend itself where it stands');
        }
        if (spell && ((lowHp && !food) || losing || (atHold && retaliateOff))) {
            teleported = true;
            const r = yield* castTeleport(ctx, TELEPORTS[spell]);
            if (r.ok) actions.push(`teleported ${spell}`);
            else yield* log(`epilogue: ${TELEPORTS[spell].name} failed: ${r.message}`);
            continue;
        }
        if (ownHold) {
            // A fight the bot chose and is winning (HP above the eat line): fight on, eating as above.
            if (!held) yield* log('epilogue: fighting its own target with HP fine; holding position');
            held = true;
            yield* ticks(1);
            continue;
        }
        let goal = target;
        if (atHold) {
            if (!retaliateOff) {
                // The fight follows (a chasing foe) or no way is open: stand and defend (auto-retaliate), eating or
                // teleporting as above, until it ends or the time is up.
                if (!held) yield* log('epilogue: could not shake the attacker; holding position');
                held = true;
                yield* ticks(1);
                continue;
            }
            // Standing still would not defend: keep walking, from where the bot is now, past the leg cap.
            goal = fleeDestinations(s, safe)[0];
            if (!goal) {
                yield* ticks(1);
                continue;
            }
        }
        if (!goal) continue;
        legs++;
        hpMark = p.hp;
        const w = yield* walkTo(ctx, goal.x, goal.z, FLEE_TOLERANCE, {
            maxTicks: Math.min(FLEE_LEG_TICKS, left),
            reserveTicks: 0,
        });
        if (w.ok || w.reason === 'timeout') {
            actions.push('walked');
            // HP fell and the fight is still on: running does not shake it.
            const after = ctx.state();
            if (endangered(after) && (after.player?.hp ?? hpMark) < hpMark) stalled = true;
        } else {
            // This way is closed: the next leg tries the next direction.
            if (!atHold) destination++;
            yield* log(`epilogue: could not walk to (${goal.x},${goal.z}): ${w.message}`);
            // A refusal that took no tick must not spin.
            yield* ticks(1);
        }
    }
    const last = ctx.state();
    return {
        actions: collapse(actions),
        ended,
        hpBefore,
        hpAfter: last.player?.hp ?? null,
        maxHp: last.player?.maxHp ?? null,
        inCombat: last.player?.combat.inCombat ?? null,
        ticks: last.tick - startTick,
    };
}

/**
 * Runs the epilogue on `driver` (no guards, no stops), at most EPILOGUE_TICKS plus the grace. Never throws: a driver
 * that fails (the client gone) gives null, with the error logged.
 */
export async function runEpilogue(
    driver: Driver,
    opts: { safe?: SafeSpot | null; pathfinder?: Pathfinder; walkWorld?: WalkWorld } = {},
): Promise<Epilogue | null> {
    let startTick: number;
    try {
        startTick = driver.state().tick;
    } catch {
        return null;
    }
    const ctx: ActionContext = {
        state: () => driver.state(),
        ...(opts.pathfinder && { pathfinder: opts.pathfinder }),
        ...(opts.walkWorld && { walkWorld: opts.walkWorld }),
    };
    const progress: EpilogueProgress = { actions: [], hpBefore: null };
    try {
        const r = await interpret(epilogue(ctx, opts.safe ?? null, progress), {
            driver,
            onTick: s => (s.tick - startTick > EPILOGUE_TICKS + EPILOGUE_GRACE_TICKS ? 'epilogue out of time' : null),
        });
        if (r.kind === 'returned') return r.value;
        const s = driver.state();
        return {
            actions: collapse(progress.actions),
            ended: r.kind === 'cancelled' ? 'out of time' : 'cut short',
            ...(r.kind === 'aborted' && { cutShort: `aborted by ${r.by}` }),
            hpBefore: progress.hpBefore,
            hpAfter: s.player?.hp ?? null,
            maxHp: s.player?.maxHp ?? null,
            inCombat: s.player?.combat.inCombat ?? null,
            ticks: s.tick - startTick,
        };
    } catch (e) {
        try {
            driver.log(`epilogue failed: ${errMessage(e)}`);
        } catch {
            // The log is best effort.
        }
        // Keep what it did before the driver failed.
        if (progress.actions.length === 0 && progress.hpBefore === null) return null;
        let s: BotWorldState | null = null;
        try {
            s = driver.state();
        } catch {
            // State unreadable: the hp fields stay null.
        }
        return {
            actions: collapse(progress.actions),
            ended: 'cut short',
            cutShort: errMessage(e),
            hpBefore: progress.hpBefore,
            hpAfter: s?.player?.hp ?? null,
            maxHp: s?.player?.maxHp ?? null,
            inCombat: s?.player?.combat.inCombat ?? null,
            ticks: s ? s.tick - startTick : 0,
        };
    }
}

/** One line for the console: what it did, why it ended, where the bot stands. */
export const epilogueSummary = (e: Epilogue): string =>
    `epilogue: ${e.actions.join(', ') || 'nothing done'} (${e.ended}${e.cutShort ? `: ${e.cutShort}` : ''}), hp ${e.hpAfter}/${e.maxHp}, inCombat ${e.inCombat}`;

/**
 * The run's result with its epilogue: status, reason, duration and XP are the run's own; the final position, HP and
 * combat state are the bot's now (`state`), after the epilogue moved, healed or teleported it.
 */
export function withEpilogueResult(result: TaskResult, ep: Epilogue, state: BotWorldState | null): TaskResult {
    const p = state?.player;
    return {
        ...result,
        epilogue: ep,
        ...(p && {
            finalPos: { x: p.worldX, z: p.worldZ, level: p.level },
            hp: { current: p.hp, max: p.maxHp },
            inCombat: p.combat.inCombat,
        }),
    };
}

/**
 * Remembers where the bot last stood out of combat, from the states it is fed (`sdk.onStateUpdate`): the place to
 * run back to. Null until it has seen one.
 */
export function safeSpotTracker(): { observe(s: BotWorldState): void; spot(): SafeSpot | null } {
    let spot: SafeSpot | null = null;
    return {
        observe(s) {
            const p = s.player;
            if (p && !p.combat.inCombat && !endangered(s)) spot = { x: p.worldX, z: p.worldZ, level: p.level };
        },
        spot: () => spot,
    };
}

/** What `trackSafeSpot` needs of the SDK. */
export interface StateSource {
    getState(): BotWorldState | null;
    onStateUpdate(listener: (state: BotWorldState) => void): () => void;
}

/** A safe-spot tracker fed by `sdk`'s state updates from now on; `stop` unsubscribes. */
export function trackSafeSpot(sdk: StateSource): { spot(): SafeSpot | null; stop(): void } {
    const tracker = safeSpotTracker();
    const first = sdk.getState();
    if (first) tracker.observe(first);
    return { spot: tracker.spot, stop: sdk.onStateUpdate(s => tracker.observe(s)) };
}

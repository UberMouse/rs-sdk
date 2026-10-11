// The live bot for the plan viewer's bot panel: one observe-mode connection per bot that someone is
// viewing (observe never takes control, so it is safe beside a running plan), closed shortly after
// the last viewer leaves.
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { connectSdk, disconnectQuietly, loadBotEnv } from '../../lib/env';
import { errMessage, INVENTORY_SLOTS } from '../../lib/util';
import type { BotSnapshot } from './model';

const POLL_MS = 1000;
const RETRY_MS = 5000;
/** A state older than this has stopped advancing: the client is gone or the gateway replays its last. */
const STATE_STALE_MS = 5000;
const LINGER_MS = 10_000;

/** What the observer reads from a connection: a BotSDK in observe mode. */
export type Observed = Pick<BotSDK, 'getState' | 'getStateAge' | 'getConnectionState' | 'disconnect'>;
/** Opens an observe-mode connection to a bot whose bot.env is under `root`. */
export type Connect = (bot: string, root: string) => Promise<Observed>;
const observeConnect: Connect = (bot, root) => connectSdk(loadBotEnv(bot, root), 'observe');

/** What the bot panel shows of a world state. */
export function snapshot(
    s: BotWorldState | null,
    status: BotSnapshot['status'],
    message: string | null,
    stateAgeMs: number | null,
): BotSnapshot {
    const p = s?.player ?? null;
    return {
        status,
        message,
        at: Date.now(),
        stateAgeMs,
        tick: s?.tick ?? null,
        inGame: s?.inGame ?? false,
        player: p && {
            name: p.name,
            x: p.worldX,
            z: p.worldZ,
            plane: p.level,
            hp: p.hp,
            maxHp: p.maxHp,
            combatLevel: p.combatLevel,
            inCombat: p.combat.inCombat,
        },
        inventory: (s?.inventory ?? []).map(i => ({ name: i.name, count: i.count })),
        slots: INVENTORY_SLOTS,
        equipment: (s?.equipment ?? []).map(i => i.name),
        // Stat18/Stat19 are unused slots in this revision's skill list.
        skills: (s?.skills ?? [])
            .filter(k => !/^Stat\d+$/.test(k.name))
            .map(k => ({ name: k.name, level: k.level, baseLevel: k.baseLevel, xp: k.experience })),
    };
}

type Listener = (s: BotSnapshot) => void;

class BotObserver {
    private listeners = new Set<Listener>();
    private sdk: Observed | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private linger: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    last: BotSnapshot = snapshot(null, 'connecting', 'connecting to the gateway', null);

    constructor(
        readonly bot: string,
        private readonly root: string | null,
        private readonly connect: Connect,
        private readonly lingerMs: number,
        private readonly onIdle: () => void,
    ) {
        void this.loop();
    }

    add(l: Listener): () => void {
        if (this.linger) clearTimeout(this.linger);
        this.linger = null;
        this.listeners.add(l);
        l(this.last);
        return () => {
            this.listeners.delete(l);
            if (!this.listeners.size) this.linger = setTimeout(() => void this.stop(), this.lingerMs);
        };
    }

    private publish(s: BotSnapshot) {
        this.last = s;
        for (const l of this.listeners) l(s);
    }

    private async loop(): Promise<void> {
        if (this.stopped) return;
        let delay = POLL_MS;
        try {
            if (!this.root) throw new Error(`no bots/${this.bot}/bot.env in any checkout`);
            if (!this.sdk || this.sdk.getConnectionState() === 'disconnected') {
                if (this.sdk) await disconnectQuietly(this.sdk);
                this.sdk = null;
                const sdk = await this.connect(this.bot, this.root);
                // Stopped while connecting: stop() had nothing to close, so this one is closed here.
                if (this.stopped) {
                    await disconnectQuietly(sdk);
                    return;
                }
                this.sdk = sdk;
            }
            const s = this.sdk.getState();
            const age = s ? this.sdk.getStateAge() : null;
            if (!s) this.publish(snapshot(null, 'connecting', 'connected; no game state yet', null));
            else if (age !== null && age > STATE_STALE_MS)
                this.publish(
                    snapshot(
                        s,
                        'stale',
                        `no new state for ${Math.round(age / 1000)}s: is a game client attached?`,
                        age,
                    ),
                );
            else this.publish(snapshot(s, 'live', null, age));
        } catch (e) {
            this.publish(snapshot(null, 'offline', errMessage(e), null));
            if (this.sdk) await disconnectQuietly(this.sdk);
            this.sdk = null;
            delay = RETRY_MS;
        }
        if (!this.stopped) this.timer = setTimeout(() => void this.loop(), delay);
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.linger) clearTimeout(this.linger);
        // Out of the map first: a viewer arriving during the disconnect gets a fresh observer.
        this.onIdle();
        const sdk = this.sdk;
        this.sdk = null;
        if (sdk) await disconnectQuietly(sdk);
    }
}

/** One observer per bot, shared by its viewers. */
export class Observers {
    private bots = new Map<string, BotObserver>();

    constructor(
        private readonly rootOf: (bot: string) => string | null,
        private readonly opts: { connect?: Connect; lingerMs?: number } = {},
    ) {}

    /** Calls `l` with each snapshot of `bot` until the returned function is called. */
    watch(bot: string, l: Listener): () => void {
        let o = this.bots.get(bot);
        if (!o) {
            const created: BotObserver = new BotObserver(
                bot,
                this.rootOf(bot),
                this.opts.connect ?? observeConnect,
                this.opts.lingerMs ?? LINGER_MS,
                () => {
                    if (this.bots.get(bot) === created) this.bots.delete(bot);
                },
            );
            o = created;
            this.bots.set(bot, o);
        }
        return o.add(l);
    }

    async close(): Promise<void> {
        await Promise.all([...this.bots.values()].map(o => o.stop()));
    }
}

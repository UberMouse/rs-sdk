// The Driver over a connected BotSDK, for real runs. It holds the only wall clock in a run: `now()`
// for the engine's watchdog and `minutes:` stops, and the tick-stall timer that keeps a wait from
// hanging on a client that stopped publishing. Given a Recorder, it records what the run's code
// observes through it (recording.ts), for replay.
import type { BotSDK } from '../../../sdk/index';
import type { ActionResult, BotAction, BotWorldState, NearbyLoc } from '../../../sdk/types';
import type { Sinks } from '../../lib/task';
import { type Driver, TickStall } from '../interpret';
import type { Recorder } from './recording';

interface Pending {
    promise: Promise<BotWorldState>;
    resolve(state: BotWorldState): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

export class LiveDriver implements Driver {
    /** The newest tick seen and when it arrived; tracked even with no caller waiting, so a stall counts from it. */
    private lastTick: number;
    private lastTickAt: number;
    /** One request shared by every caller until the next tick (see Driver.nextTick). */
    private pending: Pending | null = null;
    private closed: Error | null = null;
    private readonly unsubscribe: (() => void)[];

    /**
     * `stallMs`: no new tick for this long rejects `nextTick` with TickStall. `recorder`: records the
     * run; the caller closes it after the driver.
     */
    constructor(
        private readonly sdk: BotSDK,
        private readonly sinks: Sinks,
        private readonly stallMs: number,
        private readonly recorder?: Recorder,
    ) {
        const initial = sdk.getState();
        if (initial) recorder?.publish(initial);
        this.lastTick = initial?.tick ?? -1;
        this.lastTickAt = Date.now();
        this.unsubscribe = [
            sdk.onStateUpdate(s => this.onState(s)),
            sdk.onConnectionStateChange(c => {
                // 'reconnecting' may still recover; the stall timer bounds it.
                if (c === 'disconnected') this.rejectPending(new Error('the SDK disconnected'));
            }),
        ];
    }

    state(): BotWorldState {
        this.recorder?.call();
        const s = this.sdk.getState();
        if (!s) throw new Error('no world state from client');
        return s;
    }

    nextTick(): Promise<BotWorldState> {
        this.recorder?.call();
        if (this.pending) return this.pending.promise;
        if (this.closed) return Promise.reject(this.closed);
        if (this.sdk.getConnectionState() === 'disconnected') return this.refuse(new Error('the SDK disconnected'));
        const left = this.lastTickAt + this.stallMs - Date.now();
        if (left <= 0) return this.refuse(this.stall());
        let resolve!: (s: BotWorldState) => void;
        let reject!: (e: Error) => void;
        const promise = new Promise<BotWorldState>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const timer = setTimeout(() => this.rejectPending(this.stall()), left);
        this.pending = { promise, resolve, reject, timer };
        return promise;
    }

    /** A tick request refused on the spot, recorded like one rejected while pending. */
    private refuse(e: Error): Promise<never> {
        this.recorder?.tickError(e.message, e instanceof TickStall);
        return Promise.reject(e);
    }

    private rejectPending(e: Error): void {
        if (!this.pending) return;
        this.recorder?.tickError(e.message, e instanceof TickStall);
        this.settle(p => p.reject(e));
    }

    private onState(s: BotWorldState): void {
        this.recorder?.publish(s);
        if (s.tick <= this.lastTick) return;
        this.lastTick = s.tick;
        this.lastTickAt = Date.now();
        this.settle(p => p.resolve(s));
    }

    private settle(act: (p: Pending) => void): void {
        const p = this.pending;
        if (!p) return;
        this.pending = null;
        clearTimeout(p.timer);
        act(p);
    }

    private stall(): TickStall {
        return new TickStall(`client stopped publishing ticks for ${this.stallMs / 1000}s`);
    }

    /**
     * Stops listening to the SDK; a pending or later `nextTick` rejects, and so does every later
     * `send` and `scan`, so nothing can act on the game after the run ends.
     */
    close(): void {
        const closed = new Error('driver closed');
        this.closed = closed;
        for (const off of this.unsubscribe) off();
        this.settle(p => p.reject(closed));
    }

    async send(a: BotAction): Promise<ActionResult> {
        if (this.closed) throw this.closed;
        const rec = this.recorder;
        const id = rec?.command({ type: 'send', action: a });
        try {
            const result = await this.dispatch(a);
            if (id !== undefined) rec?.settled(id, result);
            return result;
        } catch (e) {
            if (id !== undefined) rec?.failed(id, e);
            throw e;
        }
    }

    /** Each action through the SDK's public `send*` method for it, so the SDK's own checks still apply. */
    private async dispatch(a: BotAction): Promise<ActionResult> {
        const sdk = this.sdk;
        switch (a.type) {
            case 'none':
                return { success: true, message: `nothing sent: ${a.reason}` };
            case 'wait':
                return sdk.sendWait(a.ticks);
            case 'talkToNpc':
                return sdk.sendTalkToNpc(a.npcIndex);
            case 'interactNpc':
                return sdk.sendInteractNpc(a.npcIndex, a.optionIndex);
            case 'interactPlayer':
                return sdk.sendInteractPlayer(a.playerIndex, a.optionIndex);
            case 'clickDialogOption':
                return sdk.sendClickDialog(a.optionIndex);
            case 'clickComponent':
                return sdk.sendClickComponent(a.componentId);
            case 'clickComponentWithOption':
                return sdk.sendClickComponentWithOption(a.componentId, a.optionIndex, a.slot);
            case 'acceptCharacterDesign':
                return sdk.sendAcceptCharacterDesign();
            case 'randomizeCharacterDesign':
                return sdk.sendRandomizeCharacterDesign();
            case 'walkTo':
                return sdk.sendWalk(a.x, a.z, a.running);
            case 'useInventoryItem':
                return sdk.sendUseItem(a.slot, a.optionIndex, a.interfaceId);
            case 'useEquipmentItem':
                return sdk.sendUseEquipmentItem(a.slot, a.optionIndex);
            case 'dropItem':
                return sdk.sendDropItem(a.slot);
            case 'pickupItem':
                return sdk.sendPickup(a.x, a.z, a.itemId);
            case 'interactGroundItem':
                return {
                    success: false,
                    message: 'the SDK has no public method for interactGroundItem',
                    reason: 'unsupported',
                };
            case 'interactLoc':
                return sdk.sendInteractLoc(a.x, a.z, a.locId, a.optionIndex);
            case 'shopBuy':
                return sdk.sendShopBuy(a.slot, a.amount);
            case 'shopSell':
                return sdk.sendShopSell(a.slot, a.amount);
            case 'closeShop':
                return sdk.sendCloseShop();
            case 'closeModal':
                return sdk.sendCloseModal();
            case 'setCombatStyle':
                return sdk.sendSetCombatStyle(a.style);
            case 'useItemOnItem':
                return sdk.sendUseItemOnItem(a.sourceSlot, a.targetSlot);
            case 'useItemOnLoc':
                return sdk.sendUseItemOnLoc(a.itemSlot, a.x, a.z, a.locId);
            case 'useItemOnNpc':
                return sdk.sendUseItemOnNpc(a.itemSlot, a.npcIndex);
            case 'say':
                return sdk.sendSay(a.message);
            case 'privateMessage':
                return sdk.sendPrivateMessage(a.targetName, a.message);
            case 'spellOnNpc':
                return sdk.sendSpellOnNpc(a.npcIndex, a.spellComponent);
            case 'spellOnPlayer':
                return sdk.sendSpellOnPlayer(a.playerIndex, a.spellComponent);
            case 'spellOnItem':
                return sdk.sendSpellOnItem(a.slot, a.spellComponent);
            case 'spellOnGroundItem':
                return sdk.sendSpellOnGroundItem(a.x, a.z, a.itemId, a.spellComponent);
            case 'setTab':
                return sdk.sendSetTab(a.tabIndex);
            case 'bankDeposit':
                return sdk.sendBankDeposit(a.slot, a.amount);
            case 'bankWithdraw':
                return sdk.sendBankWithdraw(a.slot, a.amount);
            case 'searchGE':
                return sdk.sendGESearch(a.query);
            case 'submitCountDialog':
                return sdk.sendCountDialog(a.value);
            // The SDK's scans return [] on failure too, so an empty `data` may mean either.
            case 'scanNearbyLocs': {
                const locs = await sdk.scanNearbyLocs(a.radius);
                return { success: true, message: `${locs.length} locs`, data: locs };
            }
            case 'scanGroundItems': {
                const items = await sdk.scanGroundItems(a.radius);
                return { success: true, message: `${items.length} ground items`, data: items };
            }
            case 'togglePrayer':
                return sdk.sendTogglePrayer(a.prayerIndex);
            default: {
                // A BotAction type added upstream fails to compile here until it is mapped.
                const unmapped: never = a;
                throw new Error(`unmapped action ${JSON.stringify(unmapped)}`);
            }
        }
    }

    async scan(radius?: number): Promise<NearbyLoc[]> {
        if (this.closed) throw this.closed;
        const rec = this.recorder;
        const id = rec?.command({ type: 'scan', ...(radius !== undefined && { radius }) });
        try {
            const locs = await this.sdk.scanNearbyLocs(radius);
            if (id !== undefined) rec?.settled(id, locs);
            return locs;
        } catch (e) {
            if (id !== undefined) rec?.failed(id, e);
            throw e;
        }
    }

    log(msg: string, data?: Record<string, unknown>): void {
        this.sinks.print(msg);
        this.sinks.event({ type: 'log', msg, data });
    }

    screenshot(label: string): Promise<string | null> {
        return this.sinks.screenshot(label).catch(() => null);
    }

    now(): number {
        const t = Date.now();
        this.recorder?.now(t);
        return t;
    }
}

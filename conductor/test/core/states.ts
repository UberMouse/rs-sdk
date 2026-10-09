// Minimal well-typed world states for core and engine tests; only what a spec names varies.
import type { BotWorldState, InventoryItem } from '../../../sdk/types';

export interface StateSpec {
    hp?: number;
    dialog?: boolean;
    z?: number;
    /** Woodcutting XP; its level is `level`. */
    xp?: number;
    level?: number;
    /** Shrimps (an Eat option), one per slot. */
    food?: number;
    /** The death message arrives on this state's tick. */
    dead?: boolean;
}

const shrimps = (slot: number): InventoryItem => ({
    slot,
    id: 315,
    name: 'Shrimps',
    count: 1,
    optionsWithIndex: [{ text: 'Eat', opIndex: 1 }],
});

export function worldState(
    tick: number,
    { hp = 10, dialog = false, z = 3218, xp = 0, level = 1, food = 0, dead = false }: StateSpec = {},
): BotWorldState {
    return {
        tick,
        inGame: true,
        player: {
            name: 'tester',
            combatLevel: 3,
            hp,
            maxHp: 10,
            x: 0,
            z: 0,
            worldX: 3222,
            worldZ: z,
            level: 0,
            runEnergy: 100,
            runWeight: 0,
            animId: -1,
            spotanimId: -1,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 },
            isDead: hp <= 0,
            lifeId: 0,
            respawnCount: 0,
            lastDeathTick: null,
        },
        skills: [{ name: 'Woodcutting', level, baseLevel: level, experience: xp }],
        inventory: Array.from({ length: food }, (_, slot) => shrimps(slot)),
        equipment: [],
        nearbyNpcs: [],
        nearbyPlayers: [],
        nearbyLocs: [],
        groundItems: [],
        gameMessages: dead ? [{ type: 0, text: 'Oh dear, you are dead!', sender: '', tick, fromSelf: false }] : [],
        recentDialogs: [],
        dialog: { isOpen: dialog, options: [], isWaiting: false },
        interface: { isOpen: false, interfaceId: -1, options: [] },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] },
        bank: { isOpen: false, items: [], noteMode: false },
        modalOpen: false,
        modalInterface: -1,
        combatEvents: [],
        prayers: { activePrayers: [], prayerPoints: 1, prayerLevel: 1 },
    };
}

/** States for ticks 0..n-1; `spec(tick)` sets what differs on each. */
export function timeline(n: number, spec: (tick: number) => StateSpec = () => ({})): BotWorldState[] {
    return Array.from({ length: n }, (_, t) => worldState(t, spec(t)));
}

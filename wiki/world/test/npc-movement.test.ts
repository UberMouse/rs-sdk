import { describe, expect, test } from 'bun:test';
import { parseConfigs } from '../sources/configs';
import { parseConstants } from '../sources/constants';
import { npcMovements, type MovementDefaults } from '../sources/npc-movement';

const defaults: MovementDefaults = {
    wanderRange: { value: 5, at: 'cache/config/NpcType.ts:101' },
    respawnRate: { value: 100, at: 'cache/config/NpcType.ts:105' },
    defaultMode: 'wander',
    moveRestrict: 'normal',
};

const configs = parseConfigs(`
[man]
name=Man

[knight]
wanderrange=15
respawnrate=50

[statue]
wanderrange=8
moverestrict=nomove

[shopkeeper]
defaultmode=none

[indoor]
moverestrict=indoors
wanderrange=2

[guard]
defaultmode=patrol
patrol1=0_50_50_10_20,5
patrol2=0_50_50_14_16,0
patrol3=^guard_corner

[imp]
[citizen]
category=citizen
[werewolf]
category=citizen
`);

const scripts: [string, string][] = [
    [
        'imp.rs2',
        `[ai_timer,imp]
if (random(2) = 0) {
    ~imp_teleport;
}

[proc,imp_teleport]
spotanim_map(smokepuff, npc_coord, 124, 0);
npc_tele(map_findsquare(npc_coord, 0, 20, ^map_findsquare_none));
`,
    ],
    [
        'citizen.rs2',
        `[ai_queue2,_citizen]
// npc_tele(npc_coord); a comment is no call
npc_changetype(npc_param(next_npc_type), 500);

[ai_queue2,werewolf]
.npc_tele(npc_coord);
`,
    ],
];

const constants = parseConstants('guard.constant', '^guard_corner = 0_50_50_8_22\n');
const read = () => npcMovements(configs, scripts, defaults, constants);
/** Reading a config `odd` of the one line `line`. */
const bad = (line: string) => () => npcMovements(parseConfigs(`[odd]\n${line}\n`), [], defaults);

describe('npcMovements', () => {
    test("wander is the engine's default range, or the config's own", () => {
        expect(read().get('man')!.wander).toBe(5);
        expect(read().get('knight')!.wander).toBe(15);
        // A move restriction other than nomove still lets it wander.
        expect(read().get('indoor')!.wander).toBe(2);
    });

    test('nomove, and a default mode that does not wander, are 0', () => {
        expect(read().get('statue')!.wander).toBe(0);
        expect(read().get('shopkeeper')!.wander).toBe(0);
    });

    test("a patrol is the box of its coords, a constant's too, and wanders 0", () => {
        expect(read().get('guard')).toEqual({
            wander: 0,
            patrol: { x1: 3208, z1: 3216, x2: 3214, z2: 3222, level: 0 },
            respawnTicks: 100,
        });
    });

    test("respawnTicks is the engine's default, or the config's respawnrate", () => {
        expect(read().get('man')!.respawnTicks).toBe(100);
        expect(read().get('knight')!.respawnTicks).toBe(50);
    });

    test('a wanderrange or respawnrate that is no whole number throws, naming the config', () => {
        expect(bad('wanderrange=far')).toThrow('Unreadable wanderrange far for npc odd');
        expect(bad('respawnrate=1.5')).toThrow('Unreadable respawnrate 1.5 for npc odd');
    });

    test('a teleport in a proc its own ai trigger calls, or a category trigger changing its type, is a move', () => {
        expect(read().get('imp')!.moves).toEqual({ how: 'teleports', source: 'imp.rs2:8' });
        expect(read().get('citizen')!.moves).toEqual({ how: 'changes-type', source: 'citizen.rs2:3' });
        // Its own trigger replaces the category's, and moves another npc (`.npc_tele`), not itself.
        expect(read().get('werewolf')!.moves).toBeUndefined();
        expect(read().get('man')!.moves).toBeUndefined();
    });

    test('a proc in a call cycle keeps the move of the member it was cut off from, entered from either end', () => {
        const cycle = parseConfigs('[first]\nname=First\n\n[second]\nname=Second\n');
        // first enters at ~cycle_a, which calls ~cycle_b back into it; second enters at ~cycle_b.
        const text = `[ai_timer,first]
~cycle_a;

[ai_timer,second]
~cycle_b;

[proc,cycle_a]
~cycle_b;
npc_tele(npc_coord);

[proc,cycle_b]
~cycle_a;
`;
        const moves = npcMovements(cycle, [['cycle.rs2', text]], defaults);
        expect(moves.get('first')!.moves).toEqual({ how: 'teleports', source: 'cycle.rs2:9' });
        expect(moves.get('second')!.moves).toEqual({ how: 'teleports', source: 'cycle.rs2:9' });
    });
});

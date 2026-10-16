import { describe, expect, test } from 'bun:test';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import {
    CROSS,
    gatedSets,
    placeGates,
    reviewGates,
    scanGates,
    type CuratedGate,
    type GateCandidate,
    type GateScanInput,
} from '../sources/gate-scan';
import { parseCallables, parseTriggers } from '../sources/triggers';
import type { Quest, Tile } from '../types';

// The door procs as doors/scripts/door_procs.rs2 and open_and_close_doors.rs2 have them, cut down: a call
// of one crosses the loc, and ~check_axis is true on the loc's own tile.
const DOORS = `[proc,check_axis](coord $coord, coord $loc_coord, int $angle)(boolean)
if (coordz($coord) = coordz($loc_coord)) {
    return(true);
}
return(false);

[proc,open_and_close_door](loc $replacement, boolean $entering, boolean $play_locked_synth)
p_teleport(loc_coord);
`;
const TELEPORT = `[proc,player_teleport_normal](coord $coord)
p_telejump($coord);
`;
// A random event moves the player, which is not passage (gate-scan.ts INCIDENTAL).
const MACRO = `[proc,macro_event_go]
p_teleport(0_30_30_0_0);
`;
const LOADOUT = `[proc,has_entrana_restricted_items]()(boolean)
if (inv_totalcat(inv, weapon_axe) > 0) {
    return(true);
}
return(false);

[proc,wearing_robes]()(boolean)
if (inv_total(worn, robe) > 0 & inv_total(worn, boots) > 0) {
    return(true);
}
return(false);
`;
// One door per condition form, in the shapes the game's doors use.
const QUESTS = `[oploc1,completedoor]
if (%cookquest < ^cook_complete) {
    mes("The door is locked.");
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,stagedoor]
if (%cookquest >= ^cook_started) {
    ~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);
    return;
}
mes("The door is locked.");

[oploc1,windowdoor]
if (%cookquest = ^cook_started) {
    ~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);
}

[oploc1,sidecave]
if (%cookquest = ^cook_started) {
    %cookquest = ^cook_found_cave;
}
p_telejump(0_50_50_1_1);

[oploc1,blockdoor]
if (%cookquest = ^cook_started) {
    mes("Not now.");
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,guilddoor]
if (stat(cooking) < 32) {
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,hatdoor]
def_boolean $inside = ~check_axis(coord, loc_coord, loc_angle);
if ($inside = false) {
    if (inv_total(worn, chefs_hat) < 1) {
        return;
    }
}
~open_and_close_door(next, $inside, false);

[oploc1,keydoor]
if (inv_total(inv, brasskey) = 0) {
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,tollgate]
if (inv_total(inv, coins) < 10) {
    return;
}
inv_del(inv, coins, 10);
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,ticketgate]
if (inv_total(inv, ticket) < 1) {
    return;
}
inv_del(inv, ticket, 1);
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,membergate]
if (map_members = ^false) {
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,monkgate]
if (~has_entrana_restricted_items = true) {
    return;
}
p_telejump(1_44_52_18_3);

[oploc1,westwall]
if (coordx(coord) < coordx(loc_coord)) {
    p_teleport(movecoord(loc_coord, 1, 0, 0));
    return;
}
if (stat(agility) < 5) {
    return;
}
p_teleport(movecoord(loc_coord, -1, 0, 0));

[oploc1,shed]
def_boolean $entering = ~check_axis(coord, loc_coord, loc_angle);
~open_and_close_door(next, $entering, false);
if ($entering = false) {
    if (inv_total(worn, staff) > 0 & map_members = ^true) {
        ~player_teleport_normal(0_50_149_20_56);
    }
}

[oploc1,barrier]
if (%cookquest = ^cook_after) {
    p_telejump(0_53_54_31_29);
}

[oploc1,robedoor]
if (~wearing_robes = false) {
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oplocu,usedoor]
if (last_useitem ! brasskey) {
    return;
}
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,altar]
if (stat(prayer) >= stat_base(prayer)) {
    mes("Full.");
} else {
    mes("Recharged.");
}
p_teleport(0_40_149_28_37);

[oploc1,gangdoor]
if (%phoenixgang = ^phoenix_complete) {
    ~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);
}

[oploc1,randomdoor]
if (%cookquest >= ^cook_started) {
    ~macro_event_go;
}

[oploc1,weirddoor] @weird(1);
[label,weird](int $side) {
    p_teleport(loc_coord);
}

[oploc1,plaindoor]
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);
`;
const FILES: [string, string][] = [
    ['doors/scripts/door_procs.rs2', DOORS],
    ['skill_magic/scripts/teleport.rs2', TELEPORT],
    ['macro events/scripts/event.rs2', MACRO],
    ['areas/loadout.rs2', LOADOUT],
    ['quests/test.rs2', QUESTS],
];
const constants = collectConstants([
    [
        'quest.constant',
        [
            '^cook_started = 1',
            '^cook_found_cave = 2',
            '^cook_complete = 3',
            '^cook_after = 4',
            '^phoenix_complete = 5',
            '^true = 1',
            '^false = 0',
        ].join('\n'),
    ],
]);
const quest = (id: string, varp: string, complete: number, or?: Quest['or']): Quest => ({
    id,
    varp,
    varpId: 1,
    complete,
    stages: {},
    source: '',
    ...(or ? { or } : {}),
});
const QUEST_TABLE = [
    quest('cook', 'cookquest', 3),
    quest('arrav', 'blackarmgang', 5, [{ varp: 'phoenixgang', varpId: 2, complete: 5 }]),
];
const INPUT: GateScanInput = {
    triggers: FILES.flatMap(([f, t]) => parseTriggers(f, t)),
    callables: FILES.flatMap(([f, t]) => parseCallables(f, t)),
    constants,
    quests: QUEST_TABLE,
    loadoutProcs: { entrana: '~has_entrana_restricted_items' },
    names: new Set(['next', 'brasskey', 'chefs_hat', 'coins', 'ticket', 'staff', 'robe', 'boots']),
};
const candidates = scanGates(INPUT);
/** The line of quests/test.rs2 a needle is first on, as a script cites it. */
const line = (needle: string): string => `quests/test.rs2:${QUESTS.split('\n').findIndex(l => l.includes(needle)) + 1}`;
const source = 'quests/test.rs2:2';
const at = (x: number, z: number, level = 0): Tile => ({ level, x, z });
const scanned = (trigger: string): GateCandidate => {
    const c = candidates.find(x => x.trigger === trigger);
    if (!c) throw new Error(`no candidate ${trigger}`);
    return c;
};
const move = (trigger: string, to = CROSS) => scanned(trigger).moves.find(m => m.to === to);

describe('scanGates: each condition form', () => {
    test('a quest done: quest:<id>', () => {
        expect(scanned('oploc1,completedoor').kind).toBe('gate');
        expect(gatedSets(move('oploc1,completedoor'))).toEqual([['quest:cook']]);
    });

    test('a quest stage, >=: quest:<id>>=<stage>, named by its constant', () => {
        expect(gatedSets(move('oploc1,stagedoor'))).toEqual([['quest:cook>=1']]);
        expect(scanned('oploc1,stagedoor').stages).toEqual({ 'quest:cook>=1': '^cook_started' });
    });

    test('one exact stage short of complete: a quest window, no move left', () => {
        expect(scanned('oploc1,windowdoor')).toMatchObject({ kind: 'quest-window', moves: [] });
        expect(scanned('oploc1,windowdoor').windows).toEqual([
            `cross: \`%cookquest = ^cook_started\` (${line('[oploc1,windowdoor]').replace(/\d+$/, n => `${Number(n) + 1}`)})`,
        ]);
    });

    test('a check that only advances the quest: a side effect, the jump free', () => {
        expect(scanned('oploc1,sidecave').kind).toBe('side-effect');
        expect(move('oploc1,sidecave', '0_50_50_1_1')?.options).toEqual([{ requires: [], sides: [] }]);
    });

    test('shut only during one stage: a temporary block', () => {
        expect(scanned('oploc1,blockdoor').kind).toBe('temporary-block');
        expect(gatedSets(move('oploc1,blockdoor'))).toEqual([]);
    });

    test('a level: skill:<skill>:<level>', () =>
        expect(gatedSets(move('oploc1,guilddoor'))).toEqual([['skill:cooking:32']]));

    test('an item worn, checked from one side only: the free side and the gated one', () =>
        expect(move('oploc1,hatdoor')?.options).toEqual([
            { requires: [], sides: ['loc'] },
            { requires: ['item:chefs_hat:worn'], sides: ['far'] },
        ]));

    test('an item held, and a use-item op: item:<obj>:held', () => {
        expect(gatedSets(move('oploc1,keydoor'))).toEqual([['item:brasskey:held']]);
        expect(gatedSets(move('oplocu,usedoor'))).toEqual([['item:brasskey:held']]);
    });

    test('coins checked and taken: coins:<n>, the check met by the toll', () =>
        expect(gatedSets(move('oploc1,tollgate'))).toEqual([['coins:10']]));

    test('an obj checked and taken: consume:<obj>:<n>, not held as well', () =>
        expect(gatedSets(move('oploc1,ticketgate'))).toEqual([['consume:ticket:1']]));

    test('a members check: members', () => expect(gatedSets(move('oploc1,membergate'))).toEqual([['members']]));

    test('a loadout proc returning false: loadout:<id>', () =>
        expect(gatedSets(move('oploc1,monkgate', '1_44_52_18_3'))).toEqual([['loadout:entrana']]));

    test('a compass side: the check applies east of the loc, the west side is free', () =>
        expect(move('oploc1,westwall')?.options).toEqual([
            { requires: [], sides: ['west'] },
            { requires: ['skill:agility:5'], sides: ['east'] },
        ]));

    test('a jump past a free door: the door crosses free, the jump needs the staff worn on a members world', () => {
        expect(move('oploc1,shed')?.options).toEqual([{ requires: [], sides: [] }]);
        expect(move('oploc1,shed', '0_50_149_20_56')?.options).toEqual([
            { requires: ['item:staff:worn', 'members'], sides: ['far'] },
        ]);
    });

    test('a stage past complete, compared exactly: quest:<id>>=<stage>, not a window', () => {
        expect(gatedSets(move('oploc1,barrier', '0_53_54_31_29'))).toEqual([['quest:cook>=4']]);
        expect(scanned('oploc1,barrier').stages).toEqual({ 'quest:cook>=4': '^cook_after' });
    });

    test('a parameterless condition proc reads as its condition', () =>
        expect(gatedSets(move('oploc1,robedoor'))).toEqual([['item:boots:worn', 'item:robe:worn']]));

    test('an unreadable check on a readable subject, taken both ways, needs nothing', () =>
        expect(scanned('oploc1,altar')).toMatchObject({
            kind: 'side-effect',
            moves: [{ to: '0_40_149_28_37', options: [{ requires: [], sides: [] }] }],
        }));

    test("done on one of a quest's `or` varps: other:<text>, as quest:<id> takes either", () =>
        expect(gatedSets(move('oploc1,gangdoor'))).toEqual([
            [`other:\`%phoenixgang = ^phoenix_complete\` (${line('%phoenixgang')})`],
        ]));

    test('not candidates: a move inside a random event, and a door with no condition', () => {
        expect(candidates.find(c => c.trigger === 'oploc1,randomdoor')).toBeUndefined();
        expect(candidates.find(c => c.trigger === 'oploc1,plaindoor')).toBeUndefined();
    });

    test('a construct the parser does not read: unclear, naming it', () =>
        expect(scanned('oploc1,weirddoor')).toMatchObject({
            kind: 'unclear',
            why: `\`(int $side) {\` (${line('[label,weird]')}) is not read`,
        }));
});

/** A curated gate entry, cited at `source`. */
const gate = (trigger: string, requires: string[][], more: Partial<CuratedGate> = {}): CuratedGate => ({
    trigger,
    kind: 'gate',
    requires,
    source,
    ...more,
});

describe('reviewGates', () => {
    const files = new Map(FILES);

    test('a candidate gates.ts does not review is listed (the build fails on any: failed() in build.test.ts)', () => {
        const review = reviewGates(candidates, [], files);
        expect(review.unreviewed).toContain('oploc1,completedoor (quests/test.rs2:1): gate');
        expect(review.unreviewed).toHaveLength(candidates.length);
    });

    test('an entry the scan agrees with passes; one the scan no longer finds is stale', () => {
        const review = reviewGates(
            candidates,
            [
                gate('oploc1,completedoor', [['quest:cook']]),
                gate('oploc1,hatdoor', [['item:chefs_hat:worn']], { from: 'far' }),
                gate('oploc1,shed', [['item:staff:worn', 'members']], { to: '0_50_149_20_56', from: 'far' }),
                gate('oploc1,gone', [['members']]),
            ],
            files,
        );
        expect(review.invalid).toEqual([]);
        expect(review.stale).toEqual(['oploc1,gone (quests/test.rs2:2)']);
    });

    test('an entry at odds with the scan needs a why; with one it passes', () => {
        const odd = gate('oploc1,guilddoor', [['skill:cooking:40']]);
        expect(reviewGates(candidates, [odd], files).invalid).toEqual([
            'oploc1,guilddoor (quests/test.rs2:2): the scan proposes gate, cross [["skill:cooking:32"]]: match it, or say in why what the scan misses',
        ]);
        expect(reviewGates(candidates, [{ ...odd, why: 'a test' }], files).invalid).toEqual([]);
        // The side counts too.
        expect(
            reviewGates(candidates, [gate('oploc1,hatdoor', [['item:chefs_hat:worn']])], files).invalid,
        ).toHaveLength(1);
    });

    test('a rejection needs its reason, and no requirements; a gate needs canonical sets and a real source line', () => {
        const review = reviewGates(
            candidates,
            [
                { trigger: 'oploc1,sidecave', kind: 'side-effect', source },
                { trigger: 'oploc1,blockdoor', kind: 'temporary-block', source, why: 'x', requires: [['members']] },
                gate('oploc1,tollgate', [['quest:cook', 'coins:10']], { why: 'unsorted' }),
                gate('oploc1,membergate', [['members']], { source: 'quests/test.rs2:999' }),
                gate('oploc1,keydoor', [['item:brasskey:held']], { source: 'quests/test.rs2' }),
            ],
            files,
        );
        expect(review.invalid).toEqual([
            'oploc1,sidecave (quests/test.rs2:2): a side-effect needs its reason in why',
            'oploc1,blockdoor (quests/test.rs2:2): a temporary-block has no requires, from, to, notes, byConfig, stages or at',
            'oploc1,tollgate (quests/test.rs2:2): write requires as [["coins:10","quest:cook"]]',
            'oploc1,membergate (quests/test.rs2:999): source quests/test.rs2:999 is not a line of code',
            'oploc1,keydoor (quests/test.rs2): source quests/test.rs2 is not file:line',
        ]);
    });
});

describe('placeGates', () => {
    // A category trigger covers its configs but one with a trigger of its own (as the engine runs it).
    const CATEGORY = `[oploc1,_tolldoor]
if (inv_total(inv, coins) < 10) {
    return;
}
inv_del(inv, coins, 10);
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);

[oploc1,tolldoor_b]
~open_and_close_door(next, ~check_axis(coord, loc_coord, loc_angle), false);
`;
    const triggers = [...INPUT.triggers, ...parseTriggers('quests/category.rs2', CATEGORY)];
    const scan = scanGates({ ...INPUT, triggers, callables: INPUT.callables });
    const locConfigs = parseConfigs(
        [
            '[tolldoor_a]\ncategory=tolldoor',
            '[tolldoor_b]\ncategory=tolldoor',
            '[tolldoor_c]\ncategory=tolldoor\nwidth=2',
            '[stagedoor]',
            '[shed]',
            '[windowdoor]',
        ].join('\n'),
    );
    const locs = [
        { config: 'tolldoor_a', tile: at(3268, 3227), shape: 0, rotation: 0 },
        { config: 'tolldoor_b', tile: at(3268, 3228), shape: 0, rotation: 0 },
        { config: 'tolldoor_c', tile: at(3268, 3229), shape: 0, rotation: 1 },
        { config: 'stagedoor', tile: at(3200, 3200), shape: 0, rotation: 2 },
        { config: 'shed', tile: at(3201, 3201), shape: 0, rotation: 3 },
        { config: 'windowdoor', tile: at(3202, 3202), shape: 0, rotation: 0 },
    ];
    const place = (curated: CuratedGate[]) =>
        placeGates({ curated, candidates: scan, triggers, locConfigs, locs, quests: QUEST_TABLE, constants });

    test("each placed loc of a gate's configs, with its tile, shape, angle and size", () => {
        const { gates, unplaced } = place([
            { trigger: 'oploc1,_tolldoor', kind: 'gate', requires: [['coins:10']], source: 'quests/category.rs2:2' },
        ]);
        expect(unplaced).toEqual([]);
        expect(gates).toEqual([
            {
                trigger: 'oploc1,_tolldoor',
                kind: 'gate',
                loc: 'tolldoor_a',
                tile: at(3268, 3227),
                shape: 0,
                angle: 0,
                requires: [['coins:10']],
                source: 'quests/category.rs2:2',
            },
            {
                trigger: 'oploc1,_tolldoor',
                kind: 'gate',
                loc: 'tolldoor_c',
                tile: at(3268, 3229),
                shape: 0,
                angle: 1,
                width: 2,
                length: 1,
                requires: [['coins:10']],
                source: 'quests/category.rs2:2',
            },
        ]);
    });

    test('byConfig: a config with its own sets, and one whose locs pass free', () => {
        const { gates } = place([
            {
                trigger: 'oploc1,_tolldoor',
                kind: 'gate',
                requires: [['coins:10']],
                source: 'quests/category.rs2:2',
                why: 'a test',
                byConfig: { tolldoor_a: [], tolldoor_c: [['coins:20']] },
            },
        ]);
        expect(gates.map(g => [g.loc, g.requires])).toEqual([['tolldoor_c', [['coins:20']]]]);
    });

    test('at: only the locs on those tiles are gates', () => {
        const { gates } = place([
            {
                trigger: 'oploc1,_tolldoor',
                kind: 'gate',
                requires: [['coins:10']],
                source: 'quests/category.rs2:2',
                why: 'a test',
                at: ['0_51_50_4_27'],
            },
        ]);
        expect(gates.map(g => [g.loc, g.tile])).toEqual([['tolldoor_a', at(3268, 3227)]]);
    });

    test('a jump by loc tile, a quest window with no sets, and the stage names the quest table gets', () => {
        const { gates, stages, unnamed } = place([
            { trigger: 'oploc1,stagedoor', kind: 'gate', requires: [['quest:cook>=1']], source, from: 'loc' },
            {
                trigger: 'oploc1,shed',
                kind: 'gate',
                requires: [['item:staff:worn', 'members']],
                source,
                from: 'far',
                to: { '0_50_50_1_1': '0_50_149_20_56' },
            },
            { trigger: 'oploc1,windowdoor', kind: 'quest-window', source, why: 'open only at ^cook_started' },
        ]);
        expect(unnamed).toEqual([]);
        expect(stages).toEqual(new Map([['cook', new Map([['^cook_started', 1]])]]));
        expect(gates.map(g => [g.loc, g.kind, g.requires, g.from, g.to, g.notes])).toEqual([
            ['stagedoor', 'gate', [['quest:cook>=1']], 'loc', undefined, undefined],
            ['shed', 'gate', [['item:staff:worn', 'members']], 'far', at(3220, 9592), undefined],
            ['windowdoor', 'quest-window', [], undefined, undefined, 'open only at ^cook_started'],
        ]);
    });

    test('a stage no constant names, a curated name that does not hold it, and a loc with no landing fail', () => {
        const { unnamed, unplaced } = place([
            { trigger: 'oploc1,stagedoor', kind: 'gate', requires: [['quest:cook>=2']], source, why: 'a test' },
            {
                trigger: 'oploc1,completedoor',
                kind: 'gate',
                requires: [['quest:cook>=1']],
                source,
                why: 'a test',
                stages: { 'quest:cook>=1': '^cook_complete' },
            },
            {
                trigger: 'oploc1,shed',
                kind: 'gate',
                requires: [['members']],
                source,
                why: 'a test',
                to: { '0_1_1_1_1': '0_50_149_20_56' },
            },
        ]);
        expect(unnamed).toEqual([
            'oploc1,stagedoor (quests/test.rs2:2): quest:cook>=2',
            'oploc1,completedoor (quests/test.rs2:2): quest:cook>=1 (^cook_complete does not hold it)',
        ]);
        expect(unplaced).toEqual([
            // completedoor has no placed loc here at all.
            'oploc1,completedoor (quests/test.rs2:2)',
            'oploc1,shed (quests/test.rs2:2): no landing in to for the loc at 0_50_50_1_1',
            'oploc1,shed (quests/test.rs2:2)',
        ]);
    });
});

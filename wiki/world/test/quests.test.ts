import { describe, expect, test } from 'bun:test';
import { parseConfigs } from '../sources/configs';
import { parseConstants } from '../sources/constants';
import { parsePack } from '../sources/packs';
import { deriveQuests, questVarpDecreases, scanQuestCalls, type QuestOverride } from '../sources/quests';
import type { Quest } from '../types';

// The forms the journal calls take (general/scripts/quests.rs2), one quest each.
const JOURNAL = `[proc,update_questlist]
~send_quest_progress_colour(questlist:zanaris, %zanaris, ^zanaris_complete);
~send_quest_progress_colour(questlist:horror, %horrorquest, ^horror_complete);
~send_quest_progress_colour(questlist:cog, ~get_cog_progress, ^quest_cog_complete);
~send_quest_progress_colour(questlist:elemental_workshop, %elemental_workshop_bits, sub(pow(2, ^elemental_workshop_complete), 1));
~send_quest_progress_colour(questlist:ikov, %ikov, ^ikov_completed_armadyl);
if (%phoenixgang > 0) {
    ~send_quest_progress_colour(questlist:blackarmgang, %phoenixgang, ^phoenixgang_complete);
} else {
    ~send_quest_progress_colour(questlist:blackarmgang, %blackarmgang, ^blackarmgang_complete);
}
// ~send_quest_progress_colour(questlist:commented, %zanaris, ^zanaris_complete);
~send_quest_progress_colour($component, $progress, $complete_progress);
`;
const VERONICA = `[opnpc1,veronica]
~send_quest_progress(questlist:haunted, %haunted, 3);
~send_quest_progress(questlist:zanaris, %zanaris, ^zanaris_complete);
`;
const FILES: [string, string][] = [
    ['general/scripts/quests.rs2', JOURNAL],
    ['areas/area_draynor/scripts/veronica.rs2', VERONICA],
];
const constants = parseConstants(
    'quest.constant',
    [
        '^zanaris_complete = 6',
        '^horror_complete = 10',
        '^quest_cog_complete = 8',
        '^elemental_workshop_complete = 20',
        '^ikov_completed_armadyl = 80',
        '^phoenixgang_complete = 10',
        '^blackarmgang_complete = 4',
        '^haunted_complete = 3',
        '^zanaris_started = 1 // a comment',
        '^zanaris_door = 3',
    ].join('\n'),
);
const varps = parsePack(
    [
        '147=zanaris',
        '10=cogquest',
        '299=elemental_workshop_bits',
        '145=blackarmgang',
        '146=phoenixgang',
        '351=deephorror',
        '4=haunted',
    ].join('\n'),
);
const varbits = parseConfigs('[horrorquest]\nbasevar=deephorror\nstartbit=0\nendbit=10\n[nobase]\nstartbit=0\n');

const OVERRIDES: QuestOverride[] = [
    { id: 'cog', varp: 'cogquest', bits: [0, 3], complete: '^quest_cog_complete', source: 'cog.rs2:12', notes: '' },
    {
        id: 'elemental_workshop',
        varp: 'elemental_workshop_bits',
        bits: ['^elemental_workshop_complete', '^elemental_workshop_complete'],
        complete: 1,
        source: 'quests.rs2:257',
        notes: '',
    },
    {
        id: 'blackarmgang',
        varp: 'blackarmgang',
        complete: '^blackarmgang_complete',
        or: [{ varp: 'phoenixgang', complete: '^phoenixgang_complete' }],
        source: 'quests.rs2:170',
        notes: '',
    },
    { id: 'haunted', varp: 'haunted', complete: '^haunted_complete', source: 'veronica.rs2:2', notes: '' },
];

describe('scanQuestCalls', () => {
    const { calls, unread } = scanQuestCalls(FILES);

    test('reads both journal procs, a nested argument whole, and skips comments and calls with no component', () => {
        expect(unread).toEqual([]);
        expect(calls.map(c => `${c.id} | ${c.progress} | ${c.complete} | ${c.at}`)).toEqual([
            'zanaris | %zanaris | ^zanaris_complete | general/scripts/quests.rs2:2',
            'horror | %horrorquest | ^horror_complete | general/scripts/quests.rs2:3',
            'cog | ~get_cog_progress | ^quest_cog_complete | general/scripts/quests.rs2:4',
            'elemental_workshop | %elemental_workshop_bits | sub(pow(2, ^elemental_workshop_complete), 1) | general/scripts/quests.rs2:5',
            'ikov | %ikov | ^ikov_completed_armadyl | general/scripts/quests.rs2:6',
            'blackarmgang | %phoenixgang | ^phoenixgang_complete | general/scripts/quests.rs2:8',
            'blackarmgang | %blackarmgang | ^blackarmgang_complete | general/scripts/quests.rs2:10',
            'haunted | %haunted | 3 | areas/area_draynor/scripts/veronica.rs2:2',
            'zanaris | %zanaris | ^zanaris_complete | areas/area_draynor/scripts/veronica.rs2:3',
        ]);
    });
});

describe('scanQuestCalls, on a call over several lines or with the wrong arguments', () => {
    const { calls, unread } = scanQuestCalls([
        [
            'q.rs2',
            `[proc,a]
~send_quest_progress(questlist:zanaris,
    %zanaris,
    ^zanaris_complete);
~send_quest_progress(questlist:haunted, %haunted);
~send_quest_progress_colour($component, $progress, $complete_progress);
`,
        ],
    ]);

    test('a call split across lines is read, at the line it starts on', () =>
        expect(calls).toEqual([{ id: 'zanaris', progress: '%zanaris', complete: '^zanaris_complete', at: 'q.rs2:2' }]));

    test('a call naming a quest that is not (questlist:<id>, <progress>, <complete>) is unread, and fails derive', () => {
        const why =
            '`~send_quest_progress(questlist:haunted, %haunted)` (q.rs2:5) is not ' +
            '~send_quest_progress(questlist:<id>, <progress>, <complete>)';
        expect(unread).toEqual([why]);
        const scan = { calls, unread };
        expect(deriveQuests({ scan, constants, varps, varbits, overrides: [], decreasing: {} }).unread).toEqual([why]);
    });
});

describe('deriveQuests', () => {
    const scan = scanQuestCalls(FILES);

    test('a quest whose calls agree on (%varp, ^x_complete) is read from them, citing the first call', () => {
        const { quests } = deriveQuests({ scan, constants, varps, varbits, overrides: [], decreasing: {} });
        expect(quests.find(q => q.id === 'zanaris')).toEqual({
            id: 'zanaris',
            varp: 'zanaris',
            varpId: 147,
            complete: 6,
            stages: {},
            source: 'areas/area_draynor/scripts/veronica.rs2:3',
        });
    });

    test('a varbit is read as bits of its base varp', () => {
        const { quests } = deriveQuests({ scan, constants, varps, varbits, overrides: [], decreasing: {} });
        expect(quests.find(q => q.id === 'horror')).toMatchObject({
            varp: 'deephorror',
            varpId: 351,
            bits: [0, 10],
            varbit: 'horrorquest',
            complete: 10,
        });
    });

    test('each form the scan can not read is unread without an override, with what stopped it', () => {
        const { quests, unread } = deriveQuests({ scan, constants, varps, varbits, overrides: [], decreasing: {} });
        expect(quests.map(q => q.id)).toEqual(['horror', 'zanaris']);
        expect(unread.map(u => u.split(':')[0])).toEqual([
            'blackarmgang',
            'cog',
            'elemental_workshop',
            'haunted',
            'ikov',
        ]);
        const why = (id: string) => unread.find(u => u.startsWith(`${id}:`))!;
        // Two varps on one entry.
        expect(why('blackarmgang')).toContain('its calls pass different varps or values');
        // A computed progress.
        expect(why('cog')).toContain('`~get_cog_progress` is not a varp');
        // Bit-packed, against a computed value.
        expect(why('elemental_workshop')).toContain('is not a ^<x>_complete constant');
        // A literal threshold.
        expect(why('haunted')).toContain(
            '`3` is not a ^<x>_complete constant (areas/area_draynor/scripts/veronica.rs2:2)',
        );
        // Two endings, neither a _complete constant (and %ikov is not in this pack).
        expect(why('ikov')).toContain('%ikov is neither in pack/varp.pack nor a varbit');
    });

    test('an override reads its varp, bits from constants, and the other varps that complete it', () => {
        const { quests, unread, stale } = deriveQuests({
            scan,
            constants,
            varps,
            varbits,
            overrides: OVERRIDES,
            decreasing: {},
        });
        expect(unread.map(u => u.split(':')[0])).toEqual(['ikov']);
        expect(stale).toEqual([]);
        const q = (id: string) => quests.find(x => x.id === id);
        expect(q('cog')).toEqual({
            id: 'cog',
            varp: 'cogquest',
            varpId: 10,
            bits: [0, 3],
            complete: 8,
            stages: {},
            source: 'cog.rs2:12',
        });
        expect(q('elemental_workshop')).toMatchObject({ bits: [20, 20], complete: 1 });
        expect(q('blackarmgang')).toMatchObject({
            varp: 'blackarmgang',
            complete: 4,
            or: [{ varp: 'phoenixgang', varpId: 146, complete: 10 }],
        });
        expect(q('haunted')).toMatchObject({ complete: 3, source: 'veronica.rs2:2' });
    });

    test('an override the calls no longer need, or for a quest no call names, is stale', () => {
        const extra: QuestOverride[] = [
            { id: 'zanaris', varp: 'zanaris', complete: 6, source: 'x.rs2:1', notes: '' },
            { id: 'gone', varp: 'zanaris', complete: 6, source: 'x.rs2:1', notes: '' },
        ];
        const { stale } = deriveQuests({
            scan,
            constants,
            varps,
            varbits,
            overrides: [...OVERRIDES, ...extra],
            decreasing: {},
        });
        expect(stale).toEqual([
            'gone: no journal call names questlist:gone',
            'zanaris: its calls read as %zanaris >= 6 without the override',
        ]);
    });

    test('a quest listed as decreasing carries why on its row; one not in the table is stale', () => {
        const { quests, stale } = deriveQuests({
            scan,
            constants,
            varps,
            varbits,
            overrides: [],
            decreasing: { zanaris: 'q.rs2:9: set back', gone: 'q.rs2:1: no such quest' },
        });
        expect(quests.find(q => q.id === 'zanaris')?.varpDecreases).toBe('q.rs2:9: set back');
        expect(quests.find(q => q.id === 'horror')).not.toHaveProperty('varpDecreases');
        expect(stale).toEqual(['gone: listed as decreasing, but no journal call names questlist:gone']);
    });

    const bad = (o: Partial<QuestOverride>) => () =>
        deriveQuests({ scan, constants, varps, varbits, overrides: [{ ...OVERRIDES[0]!, ...o }], decreasing: {} });

    test('an override naming a varp or constant that does not exist throws', () => {
        expect(bad({ varp: 'nope' })).toThrow('quest override cog: %nope is not in pack/varp.pack');
        expect(bad({ complete: '^nope' })).toThrow('quest override cog: ^nope is not a number in any .constant file');
    });
});

describe('questVarpDecreases', () => {
    const quests: Quest[] = [
        { id: 'zanaris', varp: 'zanaris', varpId: 147, complete: 6, stages: {}, source: '' },
        {
            id: 'horror',
            varp: 'deephorror',
            varpId: 351,
            bits: [0, 10],
            varbit: 'horrorquest',
            complete: 10,
            stages: {},
            source: '',
        },
        { id: 'cog', varp: 'cogquest', varpId: 10, bits: [0, 3], complete: 8, stages: {}, source: '' },
    ];
    const check = (text: string) => questVarpDecreases([['q.rs2', text]], quests, constants);

    test('an assignment above every stage shown is no decrease', () =>
        expect(
            check(`[opnpc1,a]
if (%zanaris = ^zanaris_started) {
    %zanaris = ^zanaris_door;
}
%zanaris = ^zanaris_complete;
`).decreases,
        ).toEqual([]));

    test('an assignment below the stage an if shows is a decrease', () =>
        expect(
            check(`[opnpc1,a]
if (%zanaris >= ^zanaris_door) {
    %zanaris = ^zanaris_started;
}
`).decreases,
        ).toEqual([{ quest: 'zanaris', varp: 'zanaris', from: 3, to: 1, at: 'q.rs2:3' }]));

    test('the else of a `<` test, a switch case, an earlier assignment and a loop all show a stage', () => {
        const { decreases } = check(`[opnpc1,a]
if (%zanaris < 4) {
    mes("early");
} else {
    %zanaris = 2;
}
switch_int (%zanaris) {
    case ^zanaris_door, 5 : %zanaris = 1;
    case default : %zanaris = 0;
}
%zanaris = 5;
%zanaris = 4;
while (%zanaris > 5) {
    %zanaris = 5;
}
`);
        expect(decreases.map(d => `${d.from}->${d.to} ${d.at}`)).toEqual([
            '4->2 q.rs2:5',
            '3->1 q.rs2:8',
            '5->4 q.rs2:12',
            '6->5 q.rs2:14',
        ]);
    });

    test('a computed assignment is not checked, and forgets the stage shown', () =>
        expect(
            check(`[opnpc1,a]
if (%zanaris >= 5) {
    %zanaris = calc(%zanaris - 4);
    %zanaris = 2;
}
`).decreases,
        ).toEqual([]));

    test('a varbit quest is checked by the varbit name, a computed one not at all', () => {
        const { decreases } = check(`[proc,b]
if (%horrorquest = 5) %horrorquest = 2;
if (%cogquest = 5) %cogquest = 2;
`);
        expect(decreases).toEqual([{ quest: 'horror', varp: 'horrorquest', from: 5, to: 2, at: 'q.rs2:2' }]);
    });

    test('a script that assigns a quest varp and does not parse is listed; one that only tests it is not read', () => {
        const { unread } = check(`[opnpc1,a]
%zanaris = ^zanaris_door; @@@
[opnpc1,b]
if (%zanaris = 1) { @@@ }
`);
        expect(unread).toEqual(['[opnpc1,a] `@` (q.rs2:2) is not read']);
    });
});

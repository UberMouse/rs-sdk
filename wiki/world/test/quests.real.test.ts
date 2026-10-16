// The quest table read from the real scripts (sources/quests.ts), and the check that quest varps only grow.
import { describe, expect, test } from 'bun:test';
import { QUEST_OVERRIDES, QUEST_VARP_EXCEPTIONS } from '../gates';
import { readConfigs } from '../sources/configs';
import { readConstants } from '../sources/constants';
import { readPack } from '../sources/packs';
import { deriveQuests, questVarpDecreases, scanQuestCalls } from '../sources/quests';
import { readScripts } from '../sources/triggers';

const scripts = readScripts();
const constants = readConstants();
const { quests, unread, stale } = deriveQuests({
    calls: scanQuestCalls(scripts),
    constants,
    varps: readPack('varp'),
    varbits: readConfigs('varbit'),
    overrides: QUEST_OVERRIDES,
});
const quest = (id: string) => quests.find(q => q.id === id);

describe('the quest table', () => {
    test('every quest a journal call names is read, from its calls or an override, and no override is stale', () => {
        expect(unread).toEqual([]);
        expect(stale).toEqual([]);
        expect(quests).toHaveLength(68);
    });

    test('the overrides are the forms the scan can not read', () =>
        expect(QUEST_OVERRIDES.map(o => o.id).sort()).toEqual([
            'blackarmgang',
            'cog',
            'elemental_workshop',
            'haunted',
            'ikov',
            'itexam',
            'upass',
        ]));

    test('quests read from the journal calls (varp ids from pack/varp.pack, 147=zanaris)', () => {
        expect(quest('zanaris')).toMatchObject({ varp: 'zanaris', varpId: 147, complete: 6 });
        expect(quest('runemysteries')).toMatchObject({ varp: 'runemysteries', varpId: 63, complete: 6 });
        expect(quest('dragon')).toMatchObject({ varp: 'dragonquest', complete: 10 });
        expect(quest('zombiequeen')).toMatchObject({ varp: 'zombiequeen', complete: 15 });
        // %horrorquest is a varbit: bits 0-10 of deephorror (quests/quest_horror/configs/quest_horror.varbit).
        expect(quest('horror')).toMatchObject({
            varp: 'deephorror',
            varpId: 351,
            bits: [0, 10],
            varbit: 'horrorquest',
            complete: 10,
        });
    });

    test('quests read from the overrides', () => {
        expect(quest('blackarmgang')).toMatchObject({
            varp: 'blackarmgang',
            varpId: 145,
            complete: 4,
            or: [{ varp: 'phoenixgang', varpId: 146, complete: 10 }],
        });
        expect(quest('cog')).toMatchObject({ varp: 'cogquest', varpId: 10, bits: [0, 3], complete: 8 });
        expect(quest('elemental_workshop')).toMatchObject({
            varp: 'elemental_workshop_bits',
            bits: [20, 20],
            complete: 1,
        });
        expect(quest('haunted')).toMatchObject({ varp: 'haunted', complete: 3 });
        expect(quest('ikov')).toMatchObject({ varp: 'ikov', complete: 80 });
        expect(quest('itexam')).toMatchObject({ varp: 'itexamlevel', varpId: 131, bits: [0, 3], complete: 9 });
        expect(quest('upass')).toMatchObject({ varp: 'upass', complete: 10 });
    });

    test('each override cites a script line that names its quest or varp', () => {
        const text = new Map(scripts);
        for (const o of QUEST_OVERRIDES) {
            const [file, line] = o.source.split(':');
            const cited = text.get(file!)?.split('\n')[Number(line) - 1] ?? '';
            expect(
                [o.id, o.varp].some(name => cited.includes(name)),
                `${o.id}: ${o.source} is \`${cited}\``,
            ).toBe(true);
        }
    });
});

describe('quest varps only grow', () => {
    const { decreases, unread: unparsed } = questVarpDecreases(scripts, quests, constants);

    test('every script that assigns a quest varp is read', () => expect(unparsed).toEqual([]));

    test('the only decreases are of the quests gates.ts lists as exceptions, and each exception has one', () => {
        expect([...new Set(decreases.map(d => d.quest))].sort()).toEqual(Object.keys(QUEST_VARP_EXCEPTIONS).sort());
        // Witch's House: caught by the witch at ^ball_unlocked_mousedoor, back to ^ball_started.
        expect(decreases).toEqual([
            { quest: 'ball', varp: 'ballquest', from: 3, to: 1, at: 'quests/quest_ball/scripts/witch.rs2:25' },
        ]);
    });
});

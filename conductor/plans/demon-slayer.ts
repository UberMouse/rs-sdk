// Demon Slayer (server/content/scripts/quests/quest_demon, quest id demon, varp demonstart 0..30; areas/area_varrock/scripts/
// gypsy.rs2, sir_prysin.rs2, captain_rovin.rs2, areas/area_draynor/scripts/traiborn.rs2), start to done.
//  - Gypsy Aris (Varrock square 3203,3424) takes 1 coin (stage 1); Sir Prysin (palace 3204,3473) names the three keys (stage 2);
//  - key 1 (obj 2399): Wizard Traiborn (Wizards' Tower, level 1, 3112,3162) for 25 Bones (stage 3..28, one per bone);
//  - key 2 (obj 2400): Captain Rovin (palace top floor, 3204,3496 L2) once told of the demon;
//  - key 3 (obj 2401): a Bucket of water used on the Drain (3225,3495, outside the palace kitchen) washes the key down to
//    the Varrock Sewers, where it lies on the floor at (3225,9897) for about 300 ticks; the sewer manhole is at (3237,3458);
//  - Sir Prysin takes the keys and gives Silverlight (obj 2402, stage 29). Wield it: Delrith (stone circle 3229,3369) cannot be
//    attacked otherwise. At low HP he turns into Weakened Delrith and the bot is asked for the incantation, which is FIXED
//    (delrith.rs2:19-31): Carlem Aber Camerinthum Purchai Gabindo (option 4 of 4).
// The bones are carried from the start (25 slots), so the bucket and the swordfish wait in the bank (Varrock West) until they are
// delivered. Start save: lib:demon-slayer-start.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import bank from '@conductor/tasks/bank';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';

const ID = 'demon';
const KEY1 = 2399;
const KEY2 = 2400;
const KEY3 = 2401;
const SILVERLIGHT = 2402;
const BUCKET = 1925;
const BUCKET_WATER = 1929;
const has = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);
const worn = (v: PlanView, id: number) => v.state.equipment.some(i => i.id === id);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const started = (v: PlanView) => v.quest(ID) === 'started';
const py = (v: PlanView) => v.state.player?.worldZ ?? 0;
const underground = (v: PlanView) => py(v) >= 6000;
const armed = (v: PlanView) => worn(v, SILVERLIGHT);

export default definePlan({
    name: 'demon-slayer',
    description:
        'Demon Slayer: the Gypsy, Sir Prysin, Traiborn (25 bones), Captain Rovin, the kitchen drain key in the sewers, Silverlight, Delrith.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        // The incantation page (and the story pages after it) once Delrith has been brought low.
        phase(
            talk,
            { continue: true, choices: ['Carlem Aber Camerinthum Purchai Gabindo'] },
            {
                name: 'incantation',
                when: v => armed(v) && v.state.dialog.isOpen && v.last?.phase === 'delrith',
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            combat,
            {
                target: 'Delrith',
                skill: 'Strength',
                area: { x: 3229, z: 3369, radius: 10 },
                food: ['Swordfish'],
                eatBelow: 0.5,
                maxLevelGap: 30,
                stopOnDialog: true,
            },
            { name: 'delrith', when: v => armed(v) && started(v), maxFails: 3 },
        ),
        phase(
            items,
            { equip: ['^Silverlight$'] },
            { name: 'wield', when: v => has(v, SILVERLIGHT) && !armed(v), maxFails: 3 },
        ),
        // The Silverlight arrives about 4 ticks after Sir Prysin's dialog closes (p_delay 2 twice): a talk with no dialog
        // open waits a few ticks and fails, which keeps the plan from ending on "no phase applies".
        phase(
            talk,
            { continue: true },
            {
                name: 'sword-wait',
                when: v =>
                    !armed(v) &&
                    !has(v, SILVERLIGHT) &&
                    (v.last?.phase === 'prysin-sword' || v.last?.phase === 'sword-wait'),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        // All three keys: Sir Prysin gives Silverlight (the sewers are left by the walk to him).
        phase(
            talk,
            { npc: '^Sir Prysin$', at: { x: 3204, z: 3473, tolerance: 3 } },
            {
                name: 'prysin-sword',
                when: v =>
                    started(v) && has(v, KEY1) && has(v, KEY2) && has(v, KEY3) && !has(v, SILVERLIGHT) && !armed(v),
                maxFails: 3,
            },
        ),
        // The key washed down the drain lies in the sewers for a few minutes: take it at once.
        phase(
            pickup,
            { area: { x: 3225, z: 9897, radius: 3 }, items: [{ item: 'Key', count: 3 }], maxWaitSeconds: 20 },
            {
                name: 'sewer-key',
                when: v => started(v) && has(v, KEY1) && has(v, KEY2) && !has(v, KEY3) && heard(v, /washed the key/i),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Drain$',
                use: { item: { id: BUCKET_WATER } },
                at: { x: 3225, z: 3496, level: 0, tolerance: 2 },
                expect: 'washed the key',
            },
            {
                name: 'drain',
                when: v =>
                    started(v) &&
                    has(v, KEY1) &&
                    has(v, KEY2) &&
                    !has(v, KEY3) &&
                    has(v, BUCKET_WATER) &&
                    !underground(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Sink$',
                use: { item: { id: BUCKET } },
                at: { x: 3224, z: 3493, level: 0, tolerance: 2 },
                expect: 'fill',
            },
            {
                name: 'fill',
                when: v =>
                    started(v) &&
                    has(v, KEY1) &&
                    has(v, KEY2) &&
                    !has(v, KEY3) &&
                    has(v, BUCKET) &&
                    !has(v, BUCKET_WATER),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Captain Rovin$',
                at: { x: 3204, z: 3496, level: 2, tolerance: 3 },
                choices: ['this is important', 'demon who wants'],
            },
            { name: 'rovin', when: v => started(v) && has(v, KEY1) && !has(v, KEY2) && has(v, BUCKET), maxFails: 3 },
        ),
        // Bones are gone: fetch the bucket and the food from the bank.
        phase(
            bank,
            {
                area: { x: 3185, z: 3436, radius: 6 },
                withdraw: [
                    { item: 'Bucket', count: 1 },
                    { item: 'Swordfish', count: 15 },
                ],
            },
            {
                name: 'bank',
                when: v => started(v) && has(v, KEY1) && !has(v, BUCKET) && !has(v, BUCKET_WATER) && !has(v, KEY2),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            { npc: '^Traiborn$', at: { x: 3112, z: 3162, level: 1, tolerance: 3 } },
            {
                name: 'traiborn-bones',
                when: v => started(v) && v.runs('traiborn-ask') > 0 && v.inv('Bones') > 0 && !has(v, KEY1),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Traiborn$',
                at: { x: 3112, z: 3162, level: 1, tolerance: 3 },
                choices: ['need to get a key', 'any keys', 'get the bones'],
            },
            {
                name: 'traiborn-ask',
                when: v =>
                    started(v) && v.runs('prysin-keys') > 0 && v.runs('traiborn-ask') === 0 && v.inv('Bones') > 0,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Sir Prysin$',
                at: { x: 3204, z: 3473, tolerance: 3 },
                choices: [
                    'Gypsy Aris said',
                    'find Silverlight',
                    'crystal ball',
                    'give me the keys',
                    'Captain Rovin',
                    'key hunting',
                ],
            },
            {
                name: 'prysin-keys',
                when: v =>
                    started(v) &&
                    v.runs('prysin-keys') === 0 &&
                    v.runs('prysin-sword') === 0 &&
                    !has(v, KEY1) &&
                    !has(v, KEY2) &&
                    !has(v, SILVERLIGHT),
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Gypsy$',
                at: { x: 3203, z: 3424, tolerance: 3 },
                choices: [
                    'here you go',
                    'Very interesting',
                    'Who.s Delrith',
                    'How am I meant',
                    'Where can I find Silverlight',
                    'Okay, thanks',
                ],
            },
            { name: 'gypsy', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
});

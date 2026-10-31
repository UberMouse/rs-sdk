// Tribal Totem (server/content/scripts/quests/quest_totem, quest id totem, varp totemquest 0-5). Kangai Mau (Brimhaven pub,
// ~(2791,3182)) starts it; the ship to Ardougne (Customs officer, 30 coins). At the RPDT depot (east Ardougne, ~(2650,3272))
// the horn crate (2650,3273) gives a label (Investigate), the label is used on the teleport crate (2650,3271), the RPDT
// employee is asked when the crate is delivered, and Wizard Cromperty (2683,3326) teleports the player to the crate's
// delivery address: inside Handelmort Mansion (2638,3321). The mansion's combination door (2634,3323) takes the fixed word
// KURT (combolock task); the stairs (2631,3322) are trapped unless Investigated first (Thieving 21), then Climb-up; the
// chest upstairs (2638,3324, level 1) is Opened then Searched for the totem; Kangai Mau takes it (ship back first).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combolock from '@conductor/tasks/combolock';
import interact from '@conductor/tasks/interact';
import travel from '@conductor/tasks/travel';
import talk from '@conductor/tasks/talk';

const ID = 'totem';
const TOTEM = 1857;
const LABEL = 1858;
const has = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const brimhaven = (v: PlanView) => px(v) >= 2740;
const ardougne = (v: PlanView) => px(v) < 2740;
/** On a ship's deck (level 1 at a quay), not upstairs in the mansion (x 2631). */
const onDeck = (v: PlanView) => lvl(v) === 1 && px(v) >= 2670;
const inMansion = (v: PlanView) =>
    lvl(v) === 0 && px(v) >= 2625 && px(v) <= 2645 && (v.state.player?.worldZ ?? 0) >= 3315;
const upstairs = (v: PlanView) => lvl(v) === 1 && px(v) >= 2625 && px(v) <= 2645;
const started = (v: PlanView) => v.quest(ID) === 'started';
const R = { onFail: 'continue', maxFails: 6 } as const;

const KANGAI = { npc: '^Kangai Mau$', at: { x: 2791, z: 3182, tolerance: 3 } };

export default definePlan({
    name: 'tribal-totem',
    description:
        'Tribal Totem: Kangai Mau, ship to Ardougne, RPDT crate label swapped, Cromperty teleport into Handelmort Mansion, KURT door, trapped stairs searched, chest, ship back, Kangai Mau.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            talk,
            { ...KANGAI },
            {
                name: 'finish',
                when: v => has(v, TOTEM) && brimhaven(v) && lvl(v) === 0,
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gangplank$', option: 'Cross', tile: { x: 2774, z: 3234, level: 1 } },
            { name: 'disembark-brimhaven', when: v => onDeck(v) && brimhaven(v), maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stair', option: '^Climb-down$', tile: { x: 2631, z: 3322, level: 1 } },
            { name: 'down', when: v => has(v, TOTEM) && upstairs(v), maxFails: 3 },
        ),
        phase(
            travel,
            { to: { x: 2679, z: 3275, level: 0 }, tolerance: 3, minFood: 0 },
            {
                name: 'leave',
                when: v => has(v, TOTEM) && px(v) >= 2625 && px(v) <= 2645 && (v.state.player?.worldZ ?? 0) >= 3315,
                maxFails: 3,
            },
        ),
        phase(
            talk,
            {
                npc: '^Captain Barnaby$',
                at: { x: 2679, z: 3275, tolerance: 3 },
                choices: ['Yes please'],
                travels: true,
            },
            { name: 'sail-home', when: v => has(v, TOTEM) && ardougne(v) && lvl(v) === 0, maxFails: 4 },
        ),
        phase(
            travel,
            { to: { x: 2638, z: 3323, level: 1 }, tolerance: 1, minFood: 0 },
            { name: 'to-chest', when: v => upstairs(v) && v.runs('to-chest') === 0 && !has(v, TOTEM), maxFails: 3 },
        ),
        // The chest: Open turns it into the open chest, whose Search lags the Open (a failing Search first).
        phase(
            interact,
            { target: 'loc', name: '^Chest$', option: '^Search$' },
            {
                name: 'search-chest',
                when: v => v.runs('step-back') > 0 && !has(v, TOTEM),
                ...R,
            },
        ),
        // A step away and back lets the open chest's Search show (it lags the Open by more than 10 s standing still).
        phase(
            travel,
            { to: { x: 2638, z: 3321, level: 1 }, tolerance: 1, minFood: 0 },
            {
                name: 'step-back',
                when: v => v.runs('open-chest') > 0 && v.runs('step-back') === 0 && !has(v, TOTEM),
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Chest$', option: '^Open$' },
            {
                name: 'open-chest',
                when: v => v.runs('to-chest') > 0 && v.runs('open-chest') === 0 && !has(v, TOTEM),
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stairs$', option: '^Climb-up$', at: { x: 2631, z: 3325, level: 0, tolerance: 1 } },
            {
                name: 'climb',
                when: v => v.runs('trap') > 0 && v.runs('climb') === 0 && lvl(v) === 0 && !has(v, TOTEM),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Stairs$',
                option: '^Investigate$',
                at: { x: 2631, z: 3325, level: 0, tolerance: 1 },
            },
            { name: 'trap', when: v => v.runs('door') > 0 && v.runs('trap') === 0, maxFails: 3 },
        ),
        phase(
            combolock,
            { door: 'tribal' },
            {
                name: 'door',
                when: v => inMansion(v) && v.runs('approach') > 0 && v.runs('door') === 0,
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 2634, z: 3322, level: 0 }, tolerance: 1, minFood: 0 },
            { name: 'approach', when: v => inMansion(v) && v.runs('approach') === 0, maxFails: 3 },
        ),
        phase(
            talk,
            {
                npc: '^Wizard Cromperty$',
                at: { x: 2683, z: 3326, tolerance: 3 },
                choices: ['So what have you invented', 'Can I be teleported', 'Yes, that sounds good'],
            },
            { name: 'teleport', when: v => v.runs('employee') > 0 && v.runs('teleport') === 0, maxFails: 3 },
        ),
        phase(
            talk,
            {
                npc: '^RPDT employee$',
                at: { x: 2645, z: 3274, tolerance: 4 },
                choices: ['when are you going to deliver'],
            },
            { name: 'employee', when: v => v.runs('mark') > 0 && v.runs('employee') === 0, maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                use: { item: { id: LABEL } },
                tile: { x: 2650, z: 3271, level: 0 },
            },
            {
                name: 'mark',
                when: v => has(v, LABEL) && v.runs('mark') === 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crate$',
                option: '^Investigate$',
                tile: { x: 2650, z: 3273, level: 0 },
                at: { x: 2649, z: 3273, tolerance: 2 },
            },
            {
                name: 'label',
                when: v => started(v) && ardougne(v) && lvl(v) === 0 && !has(v, LABEL) && v.runs('mark') === 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Gangplank$', option: 'Cross', tile: { x: 2683, z: 3269, level: 1 } },
            { name: 'disembark-ardougne', when: v => onDeck(v) && ardougne(v), maxFails: 3 },
        ),
        phase(
            talk,
            {
                npc: '^Customs officer$',
                at: { x: 2772, z: 3228, tolerance: 3 },
                choices: ['Can I journey', 'Search away', '^Ok'],
                travels: true,
            },
            { name: 'sail-out', when: v => started(v) && brimhaven(v) && lvl(v) === 0 && !has(v, TOTEM), maxFails: 4 },
        ),
        phase(
            talk,
            { ...KANGAI, choices: ["I'm in search of adventure", 'Ok, I will get it back'] },
            { name: 'start', when: v => v.quest(ID) === 'none', maxFails: 3 },
        ),
    ],
});

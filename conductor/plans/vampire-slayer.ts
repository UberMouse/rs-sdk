// Vampire Slayer (server scripts: areas/area_draynor/scripts/morgan.rs2, areas/area_varrock/scripts/harlow.rs2 and
// bartender.rs2, general_use/scripts/cupboards.rs2, quests/quest_vampire/scripts/):
//   Morgan (Draynor, start) -> garlic: open then search the Cupboard upstairs in his house -> Hammer from the Lumbridge
//   General Store -> Beer from the Jolly Boar Inn bartender (2 gp) -> Dr Harlow (same inn): the first talk sets the
//   stage, the second takes the beer and gives the Stake -> Draynor Manor, stairs down (3115,3357) to the crypt ->
//   open the Coffin: Count Draynor (level 34) appears; at low health the stake and hammer in the pack finish him.
// Restart-safe: gates read held items, position and the nearby coffin/Count. Start: any weapon, food, ~10 coins.
// Harlow's first talk offers a choice the second does not: the `harlow` phase answers it, and on the second visit the
// task fails after the beer and stake changed hands (held stake ends the gate), so it is onFail 'continue'.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'vampire';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const inCrypt = (v: PlanView) => pz(v) > 9700 && px(v) > 3060 && px(v) < 3100;
const nearManor = (v: PlanView) => Math.abs(px(v) - 3110) <= 30 && Math.abs(pz(v) - 3355) <= 30;
const haveAll = (v: PlanView) => v.inv('Garlic') > 0 && v.inv('Stake') > 0 && v.inv('Hammer') > 0;
const countNear = (v: PlanView) => v.state.nearbyNpcs.some(n => n.name === 'Count Draynor');
const coffinOpen = (v: PlanView) =>
    v.state.nearbyLocs.some(l => l.name === 'Coffin' && l.options.some(o => /search/i.test(o)));
const cupboardOpen = (v: PlanView) =>
    v.state.nearbyLocs.some(l => l.name === 'Cupboard' && l.options.some(o => /search/i.test(o)));
// The client's loc list lags the cupboard's change for a while: its open message says it opened.
const cupboardMsg = (v: PlanView) =>
    v.state.gameMessages.filter(m => /open the cupboard|clove of garlic/i.test(m.text)).at(-1)?.text ?? '';
const opened = (v: PlanView) => /open the cupboard/i.test(cupboardMsg(v));
const CUP = { target: 'loc' as const, name: '^Cupboard$', at: { x: 3097, z: 3268, level: 1, tolerance: 3 } };
const SEARCH = { ...CUP, option: '^Search$', expect: 'garlic' };
const OPEN = { ...CUP, option: '^Open$', expect: 'open the cupboard' };
const started = (v: PlanView) => v.quest(ID) === 'started';

export default definePlan({
    name: 'vampire-slayer',
    description:
        'Vampire Slayer: Morgan, garlic (his cupboard), hammer (Lumbridge), beer (Jolly Boar), Dr Harlow (stake), Count Draynor in the manor crypt.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        // ---- the end: the crypt ----
        phase(
            combat,
            {
                target: 'Count Draynor',
                skill: 'Strength',
                area: { x: 3078, z: 9772, radius: 12 },
                food: ['Swordfish'],
                eatBelow: 0.4,
                maxLevelGap: 20,
                stopOnDialog: true,
                respawnWaitTicks: 30,
            },
            {
                name: 'count',
                when: v => inCrypt(v) && haveAll(v) && (countNear(v) || coffinOpen(v)),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Coffin$', option: '^Open$', at: { x: 3077, z: 9772, level: 0, tolerance: 4 } },
            {
                name: 'coffin',
                when: v => inCrypt(v) && haveAll(v) && !countNear(v) && !coffinOpen(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Stairs$',
                option: 'Walk-down',
                at: { x: 3115, z: 3359, level: 0, tolerance: 2 },
            },
            { name: 'stairs-down', when: v => haveAll(v) && !inCrypt(v) && nearManor(v), maxFails: 4 },
        ),
        phase(
            travel,
            { to: { x: 3108, z: 3345 }, tolerance: 3 },
            { name: 'to-manor', when: v => haveAll(v) && !inCrypt(v) && !nearManor(v), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: 'Climb-down',
                at: { x: 3099, z: 3267, level: 1, tolerance: 2 },
            },
            { name: 'house-down', when: v => lvl(v) === 1 && v.inv('Garlic') > 0, maxFails: 4 },
        ),
        // ---- Dr Harlow: beer, then the stake ----
        phase(
            talk,
            { npc: '^Dr Harlow$', at: { x: 3277, z: 3492, tolerance: 5 }, choices: ['Morgan needs your help'] },
            {
                name: 'harlow',
                when: v => v.inv('Stake') === 0 && v.inv('Beer') > 0 && v.inv('Garlic') > 0 && v.inv('Hammer') > 0,
                onFail: 'continue',
                maxFails: 5,
            },
        ),
        phase(
            talk,
            { npc: '^Bartender$', at: { x: 3279, z: 3490, tolerance: 5 }, choices: ['beer please'] },
            {
                name: 'beer',
                when: v =>
                    started(v) &&
                    v.inv('Stake') === 0 &&
                    v.inv('Beer') === 0 &&
                    v.inv('Garlic') > 0 &&
                    v.inv('Hammer') > 0,
                maxFails: 4,
            },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 3212, z: 3247 }, buy: [{ item: 'Hammer', count: 1 }] },
            { name: 'hammer', when: v => started(v) && v.inv('Hammer') === 0 && v.inv('Garlic') > 0, maxFails: 4 },
        ),
        // ---- Morgan's house ----
        phase(interact, SEARCH, {
            name: 'garlic-search',
            when: v => started(v) && v.inv('Garlic') === 0 && (cupboardOpen(v) || opened(v)),
            onFail: 'continue',
            maxFails: 8,
        }),
        // The client's loc list shows the opened cupboard ~10 s late: the first Search can fail "offers: Open", the
        // second, one wait later, finds it.
        phase(interact, SEARCH, {
            name: 'garlic-search-again',
            when: v => started(v) && v.inv('Garlic') === 0 && (cupboardOpen(v) || opened(v)),
            onFail: 'continue',
            maxFails: 8,
        }),
        phase(interact, OPEN, {
            name: 'garlic-open',
            when: v => started(v) && v.inv('Garlic') === 0 && !opened(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        // After the cupboard shut again (300 ticks) the open message is stale: open it anyway.
        phase(interact, OPEN, {
            name: 'garlic-reopen',
            when: v => started(v) && v.inv('Garlic') === 0,
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(
            talk,
            { npc: '^Morgan$', at: { x: 3098, z: 3268, tolerance: 4 }, choices: ['up for an adventure'] },
            { name: 'morgan', when: v => v.quest(ID) === 'none' },
        ),
    ],
    until: v => v.questDone(ID),
});

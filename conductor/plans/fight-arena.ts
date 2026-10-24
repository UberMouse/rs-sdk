// Fight Arena (quest id arena; wiki/quests/fight-arena.md; script server/content/scripts/quests/quest_arena): Lady Servil
// (2566,3199) -> Khazard armour from the chest (2613,3189) -> wear it, talk to the drunk guard (~2615,3141) -> Khali brew
// from the Khazard barman (2566,3140) -> brew to the guard for the cell keys -> keys on Jeremy's cell door (2617,3167)
// -> the arena: Khazard Ogre, then General Khazard sends you to the cells (Hengrad's talk) -> Khazard Scorpion ->
// Bouncer -> General Khazard himself -> out by the arena door -> Lady Servil.
// The quest tab shows none/started/done only, so the stage rides on items (armour, brew, keys), position and the dialog
// history. Start: lib:fight-arena-start.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'arena';

const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const seen = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => re.test(d.text.join(' ')));
const near = (v: PlanView, name: string, d = 14) => v.state.nearbyNpcs.some(n => n.name === name && n.distance <= d);
const chestOpt = (v: PlanView, o: string) =>
    v.state.nearbyLocs.some(l => l.name === 'Chest' && l.x === 2613 && l.z === 3189 && l.options.includes(o));
const worn = (v: PlanView, name: string) => v.state.equipment.some(i => i.name === name);

const started = (v: PlanView) => v.quest(ID) === 'started';
const armourWorn = (v: PlanView) => worn(v, 'Khazard armour') && worn(v, 'Khazard helmet');
const brew = (v: PlanView) => v.inv('Khali brew');
const keys = (v: PlanView) => v.inv('Khazard cell keys');
// The arena floor (quest_arena.constant arena_lower/upper_coord), and the cells under the guard house.
const inArena = (v: PlanView) => px(v) >= 2581 && px(v) <= 2607 && pz(v) >= 3152 && pz(v) <= 3171;
const inJail = (v: PlanView) => px(v) >= 2584 && px(v) <= 2606 && pz(v) >= 3138 && pz(v) <= 3145;

// The cell block's west door (2585,3141) is a scripted one: the walk cannot open it, an Open does (guard 1 outside lets
// a Khazard-armoured player in) and the script walks the player through. Inside is east of it, south of the arena.
const inBlock = (v: PlanView) => px(v) >= 2585 && pz(v) >= 3141 && pz(v) <= 3150;
const sawDrunk = (v: PlanView) => seen(v, /decent drink/i);
const ogreDown = (v: PlanView) => seen(v, /saved my life|well done, well done/i);
const jailed = (v: PlanView) => seen(v, /liking to you|take him to the cells/i);
const scorpionDown = (v: PlanView) => seen(v, /tougher challenge|your puppy|Bring on Bouncer/i);
const bouncerDown = (v: PlanView) => seen(v, /only friend|Nooooo/i);

const FOOD = ['Swordfish'];
// Protect from Melee lasts about 6 ticks a point: only the Bouncer and the General need it
const PROTECT = ['Protect from Melee'];
const fight = (target: string, prayers: string[] = []) => ({
    target,
    skill: 'Strength' as const,
    area: { x: 2595, z: 3161, radius: 20 },
    food: FOOD,
    eatBelow: 0.5,
    prayers,
    maxLevelGap: 100,
    stopOnDialog: true,
});

const servil = { npc: '^Lady Servil$', at: { x: 2566, z: 3199, tolerance: 3 } };
const guard = { npc: '^Khazard Guard$', at: { x: 2615, z: 3141, tolerance: 4 } };

export default definePlan({
    name: 'fight-arena',
    description:
        'Fight Arena: armour from the chest, Khali brew for the drunk guard, Jeremy, then the ogre, scorpion, Bouncer and General Khazard.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(
            talk,
            { continue: true },
            { name: 'dismiss', when: v => v.state.dialog?.isOpen === true, onFail: 'continue' },
        ),
        // --- the end ---
        phase(talk, servil, {
            name: 'finish',
            when: v => started(v) && bouncerDown(v) && !inArena(v),
            onFail: 'continue',
            maxFails: 6,
        }),
        // The General turns on the player once the Bouncer is dead (the quest is then at its last stage); the door out
        // of the arena cannot be used under attack.
        phase(combat, fight('General Khazard'), {
            name: 'khazard',
            when: v => bouncerDown(v) && inArena(v) && v.state.player?.combat.inCombat === true,
            onFail: 'continue',
            maxFails: 8,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2606, z: 3152 },
                at: { x: 2604, z: 3153, tolerance: 1 },
            },
            {
                name: 'arena-exit',
                when: v => bouncerDown(v) && inArena(v) && v.last?.phase !== 'arena-exit',
                maxFails: 4,
            },
        ),
        phase(combat, fight('Bouncer', PROTECT), {
            name: 'bouncer',
            when: v => inArena(v) && scorpionDown(v) && !bouncerDown(v) && near(v, 'Bouncer'),
            onFail: 'continue',
            maxFails: 8,
        }),
        phase(combat, fight('Khazard Scorpion'), {
            name: 'scorpion',
            when: v => inArena(v) && jailed(v) && !scorpionDown(v) && near(v, 'Khazard Scorpion'),
            onFail: 'continue',
            maxFails: 8,
        }),
        phase(
            talk,
            { npc: '^Hengrad$', at: { x: 2598, z: 3142, tolerance: 2 } },
            {
                name: 'hengrad',
                until: v => !inJail(v),
                when: v => inJail(v) && jailed(v) && !scorpionDown(v) && v.last?.phase !== 'hengrad',
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // Hengrad's talk ends before the guard has walked the player to the arena (a forced move of about 10 ticks)
        phase(
            travel,
            { to: { x: 2603, z: 3155, level: 0 }, tolerance: 1 },
            {
                name: 'cell-settle',
                when: v =>
                    jailed(v) &&
                    !scorpionDown(v) &&
                    !inArena(v) &&
                    (v.last?.phase === 'hengrad' || v.last?.phase === 'cell-settle'),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // The cutscene that frees the next beast runs when Jeremy (in the arena) is talked to, in every stage up to the Bouncer
        phase(
            talk,
            { npc: '^Jeremy Servil$', at: { x: 2602, z: 3154, tolerance: 2 } },
            {
                name: 'nudge',
                when: v =>
                    inArena(v) &&
                    !bouncerDown(v) &&
                    v.last?.phase !== 'nudge' &&
                    ((!ogreDown(v) && !near(v, 'Khazard Ogre')) ||
                        (jailed(v) && !scorpionDown(v) && !near(v, 'Khazard Scorpion')) ||
                        (scorpionDown(v) && !near(v, 'Bouncer'))),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(combat, fight('Khazard Ogre'), {
            name: 'ogre',
            when: v => inArena(v) && near(v, 'Khazard Ogre') && !ogreDown(v),
            onFail: 'continue',
            maxFails: 8,
        }),
        // --- Jeremy ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Prison Door$',
                use: { item: 'Khazard cell keys' },
                tile: { x: 2617, z: 3167 },
                at: { x: 2615, z: 3167, tolerance: 2 },
            },
            {
                name: 'free-jeremy',
                when: v => keys(v) > 0 && !inArena(v) && !inJail(v) && !ogreDown(v),
                maxFails: 4,
            },
        ),
        // --- the keys ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2585, z: 3141 },
                at: { x: 2584, z: 3141, tolerance: 1 },
            },
            {
                name: 'block-door',
                when: v =>
                    started(v) &&
                    armourWorn(v) &&
                    keys(v) === 0 &&
                    !inBlock(v) &&
                    !inArena(v) &&
                    (brew(v) > 0 || sawDrunk(v) === false),
                maxFails: 4,
            },
        ),
        phase(talk, guard, {
            name: 'give-brew',
            when: v => started(v) && armourWorn(v) && brew(v) > 0 && keys(v) === 0,
            onFail: 'continue',
            maxFails: 6,
        }),
        phase(
            talk,
            { npc: '^Khazard barman$', at: { x: 2566, z: 3140, tolerance: 3 }, choices: ['Khali brew'] },
            {
                name: 'buy-brew',
                when: v => started(v) && sawDrunk(v) && brew(v) === 0 && keys(v) === 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(talk, guard, {
            name: 'drunk-guard',
            when: v => started(v) && armourWorn(v) && !sawDrunk(v) && brew(v) === 0 && keys(v) === 0,
            onFail: 'continue',
            maxFails: 6,
        }),
        // --- the armour ---
        phase(
            interact,
            { target: 'item', name: '^Khazard armour$', option: '^Wear$' },
            { name: 'wear-armour', when: v => v.inv('Khazard armour') > 0, maxFails: 3 },
        ),
        phase(
            interact,
            { target: 'item', name: '^Khazard helmet$', option: '^Wear$' },
            { name: 'wear-helmet', when: v => v.inv('Khazard helmet') > 0, maxFails: 3 },
        ),
        // the chest's loc swap reaches the view a few ticks after the Open message: a Search that finds only "Open" is
        // retried (a phase skipped by onFail comes back after the next one)
        ...['chest-search', 'chest-search2', 'chest-search3'].map((name, i, all) =>
            phase(
                interact,
                {
                    target: 'loc',
                    name: '^Chest$',
                    option: '^Search$',
                    tile: { x: 2613, z: 3189 },
                    at: { x: 2613, z: 3190, tolerance: 1 },
                },
                {
                    name,
                    when: v =>
                        started(v) &&
                        !armourWorn(v) &&
                        v.inv('Khazard armour') === 0 &&
                        (i === 0
                            ? chestOpt(v, 'Search') || v.last?.phase === 'chest-open'
                            : v.last?.phase === all[i - 1]),
                    onFail: 'continue',
                    maxFails: 4,
                },
            ),
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chest$',
                option: '^Open$',
                expect: 'open the chest',
                tile: { x: 2613, z: 3189 },
                at: { x: 2613, z: 3190, tolerance: 1 },
            },
            {
                name: 'chest-open',
                when: v =>
                    started(v) &&
                    !armourWorn(v) &&
                    v.inv('Khazard armour') === 0 &&
                    !chestOpt(v, 'Search') &&
                    v.last?.phase !== 'chest-open',
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { ...servil, choices: ['Can I help you'] },
            { name: 'start', when: v => v.quest(ID) === 'none', onFail: 'continue', maxFails: 6 },
        ),
    ],
    until: v => v.questDone(ID),
});

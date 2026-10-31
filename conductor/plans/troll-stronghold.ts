// Troll Stronghold (server/content/scripts/quests/quest_troll; id troll, varp troll_quest 0/10/20/30/40/50).
// Start save: lib:troll-stronghold-start (Burthorpe, Death Plateau done).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import prayer from '@conductor/tasks/prayer';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'troll';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => re.test(d.text.join(' ')));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const inArena = (v: PlanView) => lvl(v) === 0 && px(v) >= 2897 && px(v) <= 2920 && pz(v) >= 3604 && pz(v) <= 3628;
const dadBeaten = (v: PlanView) => heard(v, /Not hurt Dad|You win/i) || v.runs('dad') >= 2 || v.runs('dialog') >= 2;
const trollOnMe = (v: PlanView) =>
    v.state.nearbyNpcs.some(n => /^Mountain Troll$|^Thrower Troll$/.test(n.name) && n.inCombat && n.distance <= 8);
const hasKey = (v: PlanView) => v.inv('Prison key') > 0;
const keyOnGround = (v: PlanView) => v.state.groundItems.some(g => /^Prison key$/i.test(g.name));
const inGeneralRoom = (v: PlanView) =>
    lvl(v) === 2 && px(v) >= 2818 && px(v) <= 2840 && pz(v) >= 10065 && pz(v) <= 10110;
const hasCellKey = (v: PlanView) => v.inv('Cell key 1') > 0;
const freedGodric = (v: PlanView) => heard(v, /Thank you, my friend|You unlock the cell door/i);
const inDungeon = (v: PlanView) => px(v) >= 2800 && px(v) <= 2900 && pz(v) >= 10000;
const generalOnMe = (v: PlanView) =>
    v.state.nearbyNpcs.some(n => /^Troll General$/.test(n.name) && n.inCombat && n.distance <= 8);
const dadWon = (v: PlanView) => v.last?.phase === 'dad' && /Not hurt Dad|You win/i.test(v.last.reason ?? '');
const started = (v: PlanView) => v.quest(ID) === 'started';

// The Death Plateau secret path from the stile (2817,3562) to the foot of the rocks at (2856,3612).
const SECRET_PATH = [
    { x: 2817, z: 3566 },
    { x: 2817, z: 3578 },
    { x: 2817, z: 3584 },
    { x: 2821, z: 3589 },
    { x: 2827, z: 3591 },
    { x: 2831, z: 3597 },
    { x: 2836, z: 3601 },
    { x: 2842, z: 3605 },
    { x: 2847, z: 3608 },
    { x: 2853, z: 3609 },
    { x: 2857, z: 3609 },
];
const northSide = (v: PlanView) => lvl(v) === 0 && px(v) <= 2822 && pz(v) >= 3563 && pz(v) <= 3612;

export default definePlan({
    name: 'troll-stronghold',
    description:
        'Troll Stronghold: Denulth, the secret path, the rocks, Dad, the stronghold, the keys, Godric, Dunstan.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            prayer,
            { off: ['Protect from Melee'] },
            { name: 'prayer-off', when: v => lvl(v) <= 1 && inDungeon(v) && v.runs('prayer-off') === 0 },
        ),
        phase(
            talk,
            { continue: true, choices: ['going now'] },
            {
                name: 'dad-end',
                when: v => v.state.dialog.isOpen && (dadWon(v) || (dadBeaten(v) && inArena(v))),
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Mountain Troll',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2916, z: 3632, radius: 8 },
                food: ['Swordfish'],
                eatBelow: 0.6,
                maxLevelGap: 30,
            },
            {
                name: 'troll-defend',
                when: v => lvl(v) === 0 && px(v) > 2890 && trollOnMe(v) && !v.state.dialog.isOpen,
                until: v => !trollOnMe(v),
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Mountain Troll',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2835, z: 10091, radius: 6, level: 2 },
                food: ['Swordfish'],
                eatBelow: 0.6,
                maxLevelGap: 30,
            },
            {
                name: 'troll-defend-room',
                when: v => lvl(v) === 2 && trollOnMe(v) && !v.state.dialog.isOpen,
                until: v => !trollOnMe(v),
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { continue: true },
            {
                name: 'dialog',
                when: v => v.state.dialog.isOpen && !dadWon(v) && !(inArena(v) && dadBeaten(v)),
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Dad',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2910, z: 3614, radius: 10 },
                food: ['Swordfish'],
                eatBelow: 0.6,
                maxLevelGap: 30,
                stopOnDialog: true,
            },
            { name: 'dad', when: v => started(v) && inArena(v) && !dadBeaten(v), maxFails: 2 },
        ),
        phase(
            talk,
            { npc: '^Dunstan$', at: { x: 2919, z: 3573, tolerance: 2 } },
            {
                name: 'dunstan',
                when: v => started(v) && freedGodric(v) && lvl(v) === 0 && px(v) >= 2878 && pz(v) < 3600,
            },
        ),
        phase(
            travel,
            {
                to: { x: 2880, z: 3556 },
                waypoints: [
                    { x: 2833, z: 3567 },
                    { x: 2833, z: 3583 },
                    { x: 2857, z: 3576 },
                ],
                tolerance: 2,
            },
            {
                name: 'to-burthorpe',
                when: v => started(v) && freedGodric(v) && lvl(v) === 0 && px(v) < 2878 && pz(v) < 3566 && px(v) > 2822,
            },
        ),
        phase(
            travel,
            { to: { x: 2825, z: 3555 }, tolerance: 1 },
            {
                name: 'hut-back',
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) <= 2822 &&
                    (pz(v) < 3563 || (v.last?.phase === 'stile-back' && v.last.status === 'done' && pz(v) < 3568)),
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stile$', option: '^Climb-over$', at: { x: 2817, z: 3564, tolerance: 1 } },
            {
                name: 'stile-back',
                when: v =>
                    !(v.last?.phase === 'stile-back' && v.last.status === 'done') &&
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) <= 2822 &&
                    pz(v) >= 3563 &&
                    pz(v) < 3568,
            },
        ),
        phase(
            travel,
            { to: { x: 2817, z: 3566 }, waypoints: SECRET_PATH.toReversed().slice(1), tolerance: 1 },
            {
                name: 'path-back',
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) <= 2890 &&
                    pz(v) >= 3568 &&
                    (pz(v) <= 3611 || ((v.last?.phase ?? '').startsWith('rocks-back') && v.last?.status === 'done')),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2857, z: 3612 },
                at: { x: 2857, z: 3613, tolerance: 1 },
                expect: 'step down the other side',
            },
            {
                name: 'rocks-back',
                onFail: 'continue',
                maxFails: 8,
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) >= 2850 &&
                    px(v) <= 2862 &&
                    pz(v) >= 3612 &&
                    pz(v) <= 3614 &&
                    !((v.last?.phase === 'rocks-back' || v.last?.phase === 'rocks-back-b') && v.last.status === 'done'),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2857, z: 3612 },
                at: { x: 2857, z: 3613, tolerance: 1 },
                expect: 'step down the other side',
            },
            {
                name: 'rocks-back-b',
                onFail: 'continue',
                maxFails: 8,
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) >= 2850 &&
                    px(v) <= 2862 &&
                    pz(v) >= 3612 &&
                    pz(v) <= 3614 &&
                    !((v.last?.phase === 'rocks-back' || v.last?.phase === 'rocks-back-b') && v.last.status === 'done'),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2834, z: 3628 },
                expect: 'step down the other side',
            },
            {
                name: 'rocks-south',
                onFail: 'continue',
                maxFails: 8,
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) >= 2826 &&
                    px(v) <= 2842 &&
                    pz(v) >= 3629 &&
                    pz(v) <= 3633 &&
                    !(
                        (v.last?.phase === 'rocks-south' || v.last?.phase === 'rocks-south-b') &&
                        v.last.status === 'done'
                    ),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2834, z: 3628 },
                expect: 'step down the other side',
            },
            {
                name: 'rocks-south-b',
                onFail: 'continue',
                maxFails: 8,
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) >= 2826 &&
                    px(v) <= 2842 &&
                    pz(v) >= 3629 &&
                    pz(v) <= 3633 &&
                    !(
                        (v.last?.phase === 'rocks-south' || v.last?.phase === 'rocks-south-b') &&
                        v.last.status === 'done'
                    ),
            },
        ),
        phase(
            travel,
            { to: { x: 2834, z: 3629 }, tolerance: 1 },
            {
                name: 'to-rocks-south',
                when: v =>
                    started(v) && freedGodric(v) && lvl(v) === 0 && px(v) < 2850 && pz(v) >= 3634 && pz(v) < 3660,
            },
        ),
        phase(
            travel,
            {
                to: { x: 2857, z: 3613 },
                tolerance: 1,
            },
            {
                name: 'to-rocks-back',
                when: v =>
                    started(v) &&
                    freedGodric(v) &&
                    lvl(v) === 0 &&
                    px(v) < 2870 &&
                    pz(v) >= 3614 &&
                    (pz(v) < 3628 ||
                        ((v.last?.phase ?? '').startsWith('rocks-south') && v.last?.status === 'done' && pz(v) < 3634)),
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Exit$',
                option: '^Open$',
                tile: { x: 2823, z: 10048 },
                at: { x: 2824, z: 10051, tolerance: 2 },
            },
            { name: 'leave-stronghold', when: v => started(v) && freedGodric(v) && lvl(v) === 0 && inDungeon(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cell Door$',
                option: '^Unlock$',
                tile: { x: 2832, z: 10078 },
                at: { x: 2833, z: 10078, tolerance: 1 },
            },
            {
                name: 'cell-godric',
                when: v =>
                    lvl(v) === 0 &&
                    inDungeon(v) &&
                    (hasCellKey(v) || (v.last?.phase === 'guard-key' && v.last.status === 'done')) &&
                    !freedGodric(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Twig$',
                option: '^Pickpocket$',
                expect: 'find a key',
                at: { x: 2834, z: 10080, tolerance: 2 },
            },
            {
                name: 'guard-key',
                when: v =>
                    !(v.last?.phase === 'guard-key' && v.last.status === 'done') &&
                    lvl(v) === 0 &&
                    inDungeon(v) &&
                    !hasCellKey(v) &&
                    !freedGodric(v),
                maxFails: 6,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stone Staircase$', option: '^Climb-down$', tile: { x: 2852, z: 10107 } },
            { name: 'stairs-prison', when: v => lvl(v) === 1 && px(v) >= 2848 && pz(v) >= 10100 && pz(v) <= 10112 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Prison Door$', option: '^Unlock$', tile: { x: 2848, z: 10107 } },
            { name: 'prison-door', when: v => lvl(v) === 1 && px(v) < 2848 && hasKey(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Stone Staircase$',
                option: '^Climb-down$',
                tile: { x: 2843, z: 10108 },
                at: { x: 2841, z: 10106, level: 2, tolerance: 2 },
            },
            { name: 'stairs-down', when: v => lvl(v) === 2 && hasKey(v) },
        ),
        phase(
            combat,
            {
                target: 'Troll General',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2831, z: 10090, radius: 12, level: 2 },
                food: ['Swordfish'],
                eatBelow: 0.6,
                prayers: ['Protect from Melee'],
                keepPrayersOn: true,
                maxLevelGap: 30,
            },
            {
                name: 'general-defend',
                when: v => lvl(v) === 2 && generalOnMe(v) && !v.state.dialog.isOpen,
                until: v => !generalOnMe(v),
                onFail: 'continue',
            },
        ),
        phase(
            pickup,
            { area: { x: 2831, z: 10090, radius: 14, level: 2 }, items: [{ item: 'Prison key', count: 1 }] },
            {
                name: 'key-pickup',
                when: v => inGeneralRoom(v) && keyOnGround(v) && !hasKey(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            pickup,
            { area: { x: 2831, z: 10090, radius: 14, level: 2 }, items: [{ item: 'Prison key', count: 1 }] },
            {
                name: 'key-pickup-b',
                when: v => inGeneralRoom(v) && keyOnGround(v) && !hasKey(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            travel,
            { to: { x: 2831, z: 10088, level: 2 }, tolerance: 3 },
            {
                name: 'to-generals',
                when: v => inGeneralRoom(v) && px(v) > 2834 && !hasKey(v) && !keyOnGround(v),
                maxFails: 3,
            },
        ),
        phase(
            combat,
            {
                target: 'Troll General',
                skill: 'Strength',
                allowMaxed: true,
                area: { x: 2831, z: 10090, radius: 12, level: 2 },
                food: ['Swordfish'],
                eatBelow: 0.6,
                prayers: ['Protect from Melee'],
                keepPrayersOn: true,
                maxLevelGap: 30,
            },
            {
                name: 'general',
                until: v => keyOnGround(v) || hasKey(v),
                when: v => inGeneralRoom(v) && !hasKey(v) && !keyOnGround(v),
                maxFails: 2,
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^Swordfish$', option: '^Eat$' },
            {
                name: 'eat',
                when: v =>
                    (v.hp.current < 48 || (v.last?.phase === 'to-door' && v.inv('Swordfish') > 18)) &&
                    v.last?.phase !== 'eat' &&
                    v.inv('Swordfish') > 0 &&
                    !v.state.dialog.isOpen,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cave Exit$',
                option: '^Exit$',
                tile: { x: 2906, z: 10036 },
                at: { x: 2906, z: 10034, tolerance: 1 },
            },
            {
                name: 'pass-through',
                when: v => lvl(v) === 0 && px(v) >= 2900 && px(v) <= 2925 && pz(v) >= 10010 && pz(v) <= 10040,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cave Entrance$', option: '^Enter$', tile: { x: 2903, z: 3644 } },
            {
                name: 'pass-in',
                when: v =>
                    started(v) && lvl(v) === 0 && px(v) >= 2895 && px(v) <= 2912 && pz(v) >= 3636 && pz(v) <= 3646,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stronghold$', option: '^Enter$', tile: { x: 2839, z: 3689 } },
            {
                name: 'stronghold-door',
                when: v =>
                    started(v) && lvl(v) === 0 && px(v) >= 2830 && px(v) <= 2852 && pz(v) >= 3650 && pz(v) <= 3700,
            },
        ),
        phase(
            travel,
            { to: { x: 2846, z: 3688 }, tolerance: 2 },
            {
                name: 'to-door',
                when: v => started(v) && lvl(v) === 0 && px(v) > 2852 && pz(v) >= 3650 && pz(v) <= 3700,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Arena Exit$',
                option: '^Open$',
                tile: { x: 2916, z: 3629 },
                at: { x: 2916, z: 3627, tolerance: 1 },
            },
            { name: 'arena-exit', when: v => started(v) && dadBeaten(v) && inArena(v) },
        ),
        phase(
            travel,
            { to: { x: 2905, z: 3643 }, tolerance: 2 },
            {
                name: 'after-arena',
                when: v => started(v) && lvl(v) === 0 && pz(v) >= 3629 && pz(v) < 3645 && px(v) > 2895,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Arena Entrance$', option: '^Open$', tile: { x: 2897, z: 3618 } },
            {
                name: 'arena-gate',
                when: v =>
                    started(v) &&
                    !dadBeaten(v) &&
                    lvl(v) === 0 &&
                    px(v) >= 2890 &&
                    px(v) < 2897 &&
                    pz(v) >= 3612 &&
                    pz(v) <= 3625,
            },
        ),
        phase(
            travel,
            { to: { x: 2897, z: 3617 }, tolerance: 2 },
            {
                name: 'to-arena',
                when: v =>
                    !freedGodric(v) &&
                    started(v) &&
                    lvl(v) === 0 &&
                    px(v) < 2895 &&
                    (pz(v) >= 3612 ||
                        (pz(v) === 3611 && (v.last?.phase ?? '').startsWith('rocks-1') && v.last?.status === 'done')) &&
                    pz(v) < 3660,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2857, z: 3612 },
                at: { x: 2857, z: 3610, tolerance: 1 },
                expect: 'step down the other side',
            },
            {
                name: 'rocks-1',
                onFail: 'continue',
                maxFails: 8,
                when: v =>
                    started(v) &&
                    !((v.last?.phase === 'rocks-1' || v.last?.phase === 'rocks-1-b') && v.last.status === 'done') &&
                    lvl(v) === 0 &&
                    pz(v) >= 3606 &&
                    pz(v) <= 3611 &&
                    px(v) >= 2850,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Climb$',
                tile: { x: 2857, z: 3612 },
                at: { x: 2857, z: 3610, tolerance: 1 },
                expect: 'step down the other side',
            },
            {
                name: 'rocks-1-b',
                onFail: 'continue',
                maxFails: 8,
                when: v =>
                    started(v) &&
                    !((v.last?.phase === 'rocks-1' || v.last?.phase === 'rocks-1-b') && v.last.status === 'done') &&
                    lvl(v) === 0 &&
                    pz(v) >= 3606 &&
                    pz(v) <= 3611 &&
                    px(v) >= 2850,
            },
        ),
        phase(
            travel,
            { to: { x: 2857, z: 3609 }, waypoints: SECRET_PATH.slice(1), tolerance: 1 },
            { name: 'path-forth', when: v => !freedGodric(v) && started(v) && northSide(v) && pz(v) < 3606 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                tile: { x: 2822, z: 3555 },
                option: '^Open$',
                at: { x: 2824, z: 3555, tolerance: 1 },
            },
            {
                name: 'hut-door',
                when: v =>
                    started(v) && lvl(v) === 0 && px(v) >= 2823 && px(v) <= 2828 && pz(v) >= 3550 && pz(v) <= 3560,
            },
        ),
        phase(
            travel,
            { to: { x: 2817, z: 3561 }, tolerance: 1 },
            {
                name: 'through-hut',
                when: v =>
                    started(v) && lvl(v) === 0 && px(v) >= 2815 && px(v) <= 2822 && pz(v) >= 3552 && pz(v) <= 3559,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stile$', option: '^Climb-over$', at: { x: 2817, z: 3561, tolerance: 1 } },
            { name: 'stile', when: v => started(v) && !northSide(v) && lvl(v) === 0 && px(v) < 2830 && pz(v) < 3563 },
        ),
        phase(
            travel,
            {
                to: { x: 2817, z: 3561 },
                waypoints: [
                    { x: 2857, z: 3576 },
                    { x: 2833, z: 3583 },
                    { x: 2833, z: 3567 },
                ],
                tolerance: 1,
            },
            { name: 'to-stile', when: v => started(v) && lvl(v) === 0 && px(v) >= 2830 && pz(v) < 3580 },
        ),
        phase(
            talk,
            {
                npc: '^Denulth$',
                at: { x: 2896, z: 3526, tolerance: 2 },
                choices: ['fight with the trolls', 'anything I can do', 'get Godric back'],
            },
            { name: 'start', when: v => v.quest(ID) === 'none' },
        ),
    ],
});

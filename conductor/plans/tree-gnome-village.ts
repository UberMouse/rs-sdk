// Tree Gnome Village (server/content/scripts/quests/quest_tree, areas/area_gnome/scripts, quest id tree, varp treequest 0-9),
// start to done, from the quest tab, held items, position and the dialog history.
// Stages (treequest): 0 none; 1 started (Bolren); 2 Montai asked for six logs; 3 logs given; 4 trackers (coordinates only
// matter at the ballista, the gnomes need not be talked to); 5 ballista fired (4 height, 3 x, 5 y); 6 orb of protection
// taken from the chest upstairs in the Khazard stronghold; 7 Bolren took it, the warlord holds the other two; 8 Khazard
// warlord dead (orbs of protection held); 9 Bolren done.
// The quest tab shows only none/started/done, so stages ride on these markers:
//   * six Logs held = stages 1-2 (Montai takes them at stage 2); "as quick as you can" = stage 2 reached;
//   * "braver than most" = stage 4, "reduced to rubble" = stage 5 (ballista fired), the Orb of protection = stage 6,
//     "safeguard this orb" (Bolren) = stage 7, the Orb*s* of protection = stage 8.
// Needs: melee able to kill the Khazard warlord (level 112: Att/Str/Def 80, rune set), swordfish, six Logs.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';

const ID = 'tree';
const ORB = 587;
const ORBS = 588;
const FOOD = ['Swordfish'];

const idCount = (v: PlanView, n: number) => v.state.inventory.filter(i => i.id === n).reduce((a, i) => a + i.count, 0);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const pos = (v: PlanView) => v.state.player;
const px = (v: PlanView) => pos(v)?.worldX ?? 0;
const pz = (v: PlanView) => pos(v)?.worldZ ?? 0;
const level = (v: PlanView) => pos(v)?.level ?? 0;
const done = (v: PlanView) => v.questDone(ID);
const started = (v: PlanView) => v.quest(ID) === 'started';
const orb = (v: PlanView) => idCount(v, ORB);
const orbs = (v: PlanView) => idCount(v, ORBS);
const logs = (v: PlanView) => v.inv('Logs');
const quick = (v: PlanView) => heard(v, /as quick as you can/i);
const braver = (v: PlanView) => heard(v, /braver than most/i);
const rubble = (v: PlanView) => heard(v, /reduced to rubble/i);
const safeguard = (v: PlanView) => heard(v, /safeguard this orb/i);
const fighting = (v: PlanView) => v.state.player?.combat.inCombat === true;
// The stronghold compound lies around (2496-2516, 3250-3262); level 1 is the cannon deck with the chest.
const inKeep = (v: PlanView) =>
    (px(v) >= 2496 && px(v) <= 2520 && pz(v) >= 3254 && pz(v) <= 3264) ||
    (px(v) >= 2500 && px(v) <= 2505 && pz(v) >= 3251 && pz(v) <= 3253);
const nearLoc = (v: PlanView, re: RegExp) => v.state.nearbyLocs.some(l => re.test(l.name));
const nearNpc = (v: PlanView, re: RegExp) => v.state.nearbyNpcs.some(n => re.test(n.name));

const MONTAI = { npc: '^Commander Montai$', at: { x: 2523, z: 3209, tolerance: 2 } };
const BOLREN = { npc: '^King Bolren$', at: { x: 2542, z: 3171, tolerance: 1 } };

export default definePlan({
    name: 'tree-gnome-village',
    description:
        'Tree Gnome Village: Bolren, six logs and the plan to Montai, ballista (4,3,5), wall, ladder, chest orb, Bolren, the Khazard warlord, Bolren.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // Troopers and commanders in the stronghold and on the battlefield attack: whatever hits is fought first.
        phase(
            combat,
            { target: 'Khazard commander', area: { x: 2506, z: 3256, radius: 14 }, food: FOOD, maxLevelGap: 80 },
            {
                name: 'defend-commander',
                when: v => !done(v) && fighting(v) && nearNpc(v, /^khazard commander$/i) && v.inv('Swordfish') > 0,
                until: v => !fighting(v),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        phase(
            combat,
            { target: 'Khazard trooper', area: { x: 2515, z: 3235, radius: 40 }, food: FOOD, maxLevelGap: 80 },
            {
                name: 'defend-trooper',
                when: v => !done(v) && fighting(v) && nearNpc(v, /^khazard trooper$/i) && v.inv('Swordfish') > 0,
                until: v => !fighting(v),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 2503, z: 3253, level: 1, tolerance: 1 },
            },
            { name: 'ladder-down', when: v => level(v) === 1 && orb(v) > 0, maxFails: 4 },
        ),
        // --- the finish: both orbs to Bolren ---
        phase(talk, BOLREN, { name: 'finish', when: v => !done(v) && orbs(v) > 0, maxFails: 3 }),
        // --- stage 7: the warlord (north of the stronghold) drops the two orbs ---
        phase(
            combat,
            {
                target: 'Khazard warlord',
                area: { x: 2457, z: 3302, radius: 14 },
                food: FOOD,
                maxLevelGap: 80,
                stopOnDialog: false,
            },
            {
                name: 'warlord',
                when: v => started(v) && orbs(v) === 0 && orb(v) === 0 && safeguard(v),
                until: v => orbs(v) > 0,
                maxFails: 4,
            },
        ),
        // --- stage 6: the orb to Bolren ---
        phase(
            talk,
            { ...BOLREN, choices: ['I will find the warlord'] },
            {
                name: 'give-orb',
                when: v => started(v) && orb(v) > 0,
                maxFails: 3,
            },
        ),
        // --- stage 5: into the keep and the chest on the cannon deck ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Closed chest$',
                option: '^Open$',
                at: { x: 2506, z: 3258, level: 1, tolerance: 1 },
            },
            {
                name: 'open-chest',
                when: v => started(v) && level(v) === 1 && orb(v) === 0 && nearLoc(v, /^closed chest$/i),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Open chest$',
                option: '^Search$',
                at: { x: 2506, z: 3258, level: 1, tolerance: 1 },
            },
            {
                name: 'search-chest',
                when: v => started(v) && level(v) === 1 && orb(v) === 0 && nearLoc(v, /^open chest$/i),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 2503, z: 3253, tolerance: 1 } },
            {
                name: 'ladder-up',
                when: v => started(v) && level(v) === 0 && inKeep(v) && orb(v) === 0 && rubble(v) && !safeguard(v),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Crumbled wall$',
                option: '^Climb-over$',
                at: { x: 2509, z: 3251, tolerance: 1 },
            },
            {
                name: 'wall',
                when: v =>
                    started(v) &&
                    level(v) === 0 &&
                    !inKeep(v) &&
                    orb(v) === 0 &&
                    orbs(v) === 0 &&
                    rubble(v) &&
                    !safeguard(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // --- stage 4: the ballista ---
        phase(
            talk,
            { continue: true, choices: ['^0004$', '^0003$', '^0005$'] },
            {
                name: 'fire-set',
                when: v => started(v) && v.state.dialog.isOpen && braver(v) && !rubble(v),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ballista$', option: '^Fire$', at: { x: 2509, z: 3208, tolerance: 1 } },
            { name: 'fire', when: v => started(v) && braver(v) && !rubble(v) && orb(v) === 0, maxFails: 3 },
        ),
        // --- stages 1-3: Montai ---
        phase(
            talk,
            { ...MONTAI, choices: ['try my best'] },
            {
                name: 'montai-plan',
                when: v => started(v) && logs(v) < 6 && !braver(v) && quick(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(talk, MONTAI, {
            name: 'montai-logs',
            when: v => started(v) && logs(v) >= 6 && quick(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(
            talk,
            { ...MONTAI, choices: ['gather some wood'] },
            {
                name: 'montai-start',
                when: v => started(v) && logs(v) >= 6 && !quick(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // --- the start ---
        phase(
            talk,
            { ...BOLREN, choices: ['Can I help at all', 'I would be glad'] },
            {
                name: 'bolren',
                when: v => v.quest(ID) === 'none',
                maxFails: 3,
            },
        ),
    ],
    until: done,
});

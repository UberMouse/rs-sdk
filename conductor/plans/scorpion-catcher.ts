// Scorpion Catcher (server/content/scripts/quests/quest_scorpcatcher, id scorpcatcher, varp 0-?; areas/area_seers/thormac.rs2, seer.rs2),
// start to done. Thormac (Sorcerer's Tower top floor, 2702,3405 L3) starts it and hands the empty Scorpion cage; a Seer (Seers' Village)
// gives the first hint (scorpion near the spiders: Taverley Dungeon, behind a secret wall) which the wall needs. The three
// Kharid scorpions (npcs questscorpiona/b/c, 'Use' the cage on them) are in: A Taverley Dungeon (2877,9796), B Barbarian Outpost
// (2552,3570) (gate needs the Barcrawl: varp barcrawl = 2), C Edgeville Monastery upstairs (3058,3488 L1) (ladder needs Prayer 31
// base and Abbot Langley's invitation: varp prayer_guild). The second Seer hint is not needed. The full cage goes back to Thormac.
// The cage items differ per scorpion held (ids 456 empty, 457 a, 458 ab, 459 ac, 460 b, 461 bc, 462 c, 463 full), so the gates read ids.
// Start save: lib:scorpion-catcher-start (Barcrawl done, Prayer 35, rune melee set, 15 swordfish, 2 antipoison).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'scorpcatcher';
const idCount = (v: PlanView, ids: number[]) =>
    v.state.inventory.filter(i => ids.includes(i.id)).reduce((a, i) => a + i.count, 0);
const hasA = (v: PlanView) => idCount(v, [457, 458, 459, 463]) > 0;
const hasB = (v: PlanView) => idCount(v, [458, 460, 461, 463]) > 0;
const hasC = (v: PlanView) => idCount(v, [459, 461, 462, 463]) > 0;
const hasCage = (v: PlanView) => idCount(v, [456, 457, 458, 459, 460, 461, 462, 463]) > 0;
const full = (v: PlanView) => idCount(v, [463]) > 0;
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const started = (v: PlanView) => v.quest(ID) === 'started';
const none = (v: PlanView) => v.quest(ID) === 'none';
// The Seer's last page; the hint varp is set once the page before it is clicked through.
// The history can miss the page when seer-continue clicks through several at once, so a finished seer-continue counts too.
const hinted = (v: PlanView) =>
    said(v, /see if you can find that scorpion/i) || v.runs('seer-continue') > 0 || hasB(v) || hasA(v) || hasC(v);
const glass = (v: PlanView) => said(v, /looking glass/i);
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const dusty = (v: PlanView) => v.inv('Dusty key');
const jail = (v: PlanView) => v.inv('Jail key');
const onC = (v: PlanView) => lvl(v) === 1 && pz(v) < 6000 && started(v) && hasA(v) && hasB(v) && !hasC(v) && joined(v);
const wantA = (v: PlanView) => started(v) && hasB(v) && !hasA(v) && hinted(v);
const gateOpened = (v: PlanView) => heard(v, /You unlock the gate/i);
const foundWall = (v: PlanView) => heard(v, /found a secret door/i);
// Velrak's cell door message; the Jailer's own cell door says the same, so also require no Dusty key yet.
const cellOpen = (v: PlanView) => heard(v, /You unlock the door/i);
const near = (v: PlanView, x: number, z: number, r: number) => Math.abs(px(v) - x) <= r && Math.abs(pz(v) - z) <= r;
const inTower = (v: PlanView) => px(v) >= 2694 && px(v) <= 2708 && pz(v) >= 3396 && pz(v) <= 3412;
// Thormac is wanted to start the quest and to hand the full cage back.
const needThormac = (v: PlanView) => none(v) || (started(v) && full(v));
const joined = (v: PlanView) => heard(v, /you may join|someone suitable/i);

export default definePlan({
    name: 'scorpion-catcher',
    description:
        'Scorpion Catcher: Thormac, a Seer, the scorpions in the Outpost, Taverley Dungeon and the Monastery upstairs, Thormac again.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        phase(
            travel,
            { to: { x: 2705, z: 3398, level: 0 }, tolerance: 2 },
            {
                name: 'tower-exit',
                when: v => !needThormac(v) && inTower(v) && (lvl(v) === 1 || lvl(v) === 2),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2699, z: 3405, level: 3 },
                at: { x: 2698, z: 3405, level: 3, tolerance: 2 },
            },
            { name: 'tower-down', when: v => !needThormac(v) && lvl(v) === 3, maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Thormac$' },
            { name: 'thormac-finish', when: v => started(v) && full(v) && lvl(v) === 3, maxFails: 3 },
        ),
        // The walk planner finds no connector onto the monastery's first floor: climb the ladder by hand.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 3057, z: 3483 },
                at: { x: 3057, z: 3484, tolerance: 1 },
            },
            {
                name: 'monastery-up',
                when: v =>
                    lvl(v) === 0 &&
                    pz(v) < 6000 &&
                    near(v, 3057, 3484, 12) &&
                    started(v) &&
                    hasA(v) &&
                    hasB(v) &&
                    !hasC(v) &&
                    joined(v),
                maxFails: 3,
            },
        ),
        // Eating a spare fish between failed attempts changes the inventory, so the idle rail (which fails a plan after
        // three phases that ended where they started) reads the wait for the scorpion to wander as progress.
        phase(
            interact,
            { target: 'item', name: '^Swordfish$', option: '^Eat$' },
            {
                name: 'wait-eat',
                when: v =>
                    onC(v) &&
                    v.last?.status === 'failed' &&
                    v.last.phase.startsWith('catch-c') &&
                    v.inv('Swordfish') > 6,
                maxFails: 3,
            },
        ),
        // The scorpion wanders about its table (3059,3486) and the server only lets the cage reach it from some stands:
        // the doorway (3058,3486) or the room beside it (3058,3488). Each attempt that finds it out of reach fails fast
        // ("Cannot reach"), so two stands take turns (a failed one is skipped for the next pick)
        // until the scorpion has moved to a tile one of them reaches (seen: 1 to 4 attempts).
        ...[
            { stand: { x: 3058, z: 3486 }, parity: 0 },
            { stand: { x: 3058, z: 3488 }, parity: 1 },
        ].map(({ stand, parity }) =>
            phase(
                interact,
                {
                    target: 'npc',
                    name: '^Kharid Scorpion$',
                    use: { item: '^Scorpion cage$' },
                    unreachable: true,
                    at: { ...stand, level: 1, tolerance: 1 },
                    expect: 'catch a scorpion',
                },
                {
                    name: `catch-c-${parity}`,
                    when: v => onC(v),
                    onFail: 'continue',
                    maxFails: 20,
                },
            ),
        ),
        phase(
            talk,
            {
                npc: '^Abbot Langley$',
                at: { x: 3058, z: 3484, tolerance: 3 },
                choices: ['further into the monastery', 'can I join'],
            },
            {
                name: 'join',
                when: v => pz(v) < 6000 && started(v) && hasA(v) && hasB(v) && !hasC(v) && !joined(v),
                maxFails: 3,
            },
        ),
        // A far walk does not chain across the dungeon ladder either: climb out first.
        phase(
            interact,
            { target: 'item', name: '^Antipoison', option: '^Drink$' },
            {
                name: 'anti-post',
                when: v => hasA(v) && pz(v) >= 6000 && v.inv(/^Antipoison/) > 0 && v.runs('anti-post') === 0,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        // The pocket's wall is searched again from inside to get out.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Old wall$',
                option: '^Search$',
                unreachable: true,
                at: { x: 2877, z: 9797, tolerance: 1 },
            },
            {
                name: 'wall-out',
                when: v => started(v) && hasA(v) && pz(v) >= 6000 && pz(v) <= 9798 && near(v, 2877, 9797, 3),
                maxFails: 3,
            },
        ),
        phase(
            travel,
            { to: { x: 2884, z: 3399, level: 0 }, tolerance: 2, waypoints: [{ x: 2884, z: 9798 }] },
            { name: 'dungeon-exit', when: v => started(v) && hasA(v) && pz(v) >= 6000, maxFails: 3 },
        ),
        // A far walk does not chain onto the dungeon ladder in one plan: stand at the ladder first.
        phase(
            travel,
            { to: { x: 2884, z: 3399, level: 0 }, tolerance: 2 },
            {
                name: 'to-taverley',
                when: v => started(v) && hasB(v) && !hasA(v) && hinted(v) && pz(v) < 6000 && !near(v, 2884, 3399, 6),
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Kharid Scorpion$',
                use: { item: '^Scorpion cage$' },
                at: { x: 2876, z: 9797, tolerance: 3 },
                expect: 'catch a scorpion',
            },
            { name: 'catch-a', when: v => wantA(v) && foundWall(v), maxFails: 3 },
        ),
        // The scorpion sits in a pocket behind the Old wall (2875,9799), itself in a part of the dungeon behind the
        // Dusty key gate (2924,9803); Velrak (jail cell 2931,9685) hands the key once a Jailer's Jail key opens his door.
        phase(
            interact,
            { target: 'item', name: '^Antipoison', option: '^Drink$' },
            {
                name: 'anti-pre',
                when: v =>
                    wantA(v) && gateOpened(v) && !foundWall(v) && v.inv(/^Antipoison/) > 0 && v.runs('anti-pre') === 0,
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Old wall$',
                option: '^Search$',
                unreachable: true,
                at: { x: 2876, z: 9799, tolerance: 1 },
            },
            { name: 'wall', when: v => wantA(v) && !foundWall(v) && gateOpened(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^(Gate|Door)$',
                tile: { x: 2924, z: 9803 },
                use: { item: '^Dusty key$' },
                at: { x: 2925, z: 9803, tolerance: 1 },
            },
            { name: 'gate', when: v => wantA(v) && dusty(v) > 0 && !gateOpened(v), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Velrak the explorer$', choices: ['know anywhere good', 'Yes please'] },
            { name: 'velrak', when: v => wantA(v) && dusty(v) === 0 && jail(v) > 0 && cellOpen(v), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                tile: { x: 2931, z: 9690 },
                use: { item: '^Jail key$' },
                at: { x: 2930, z: 9690, tolerance: 1 },
            },
            { name: 'cell', when: v => wantA(v) && dusty(v) === 0 && jail(v) > 0 && !cellOpen(v), maxFails: 3 },
        ),
        phase(
            combat,
            {
                target: 'Jailer',
                area: { x: 2933, z: 9693, radius: 6 },
                food: ['Swordfish'],
                loot: ['Jail key'],
            },
            {
                name: 'jailer',
                when: v => wantA(v) && dusty(v) === 0 && jail(v) === 0 && !gateOpened(v),
                until: v => jail(v) > 0,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Kharid Scorpion$',
                use: { item: '^Scorpion cage$' },
                at: { x: 2552, z: 3570, tolerance: 3 },
                expect: 'catch a scorpion',
            },
            { name: 'catch-b', when: v => started(v) && hinted(v) && !hasB(v), maxFails: 3 },
        ),
        phase(
            talk,
            {
                npc: '^Seer$',
                at: { x: 2716, z: 3485, tolerance: 4 },
                choices: ['locate some scorpions|Where did you say'],
            },
            { name: 'seer', when: v => started(v) && hasCage(v) && !glass(v), maxFails: 3 },
        ),
        // The Seer's scene closes its dialog while he gazes into the mirror (9 ticks): wait for the next page, then click on.
        phase(
            talk,
            { continue: true },
            {
                name: 'seer-continue',
                when: v =>
                    started(v) && glass(v) && !hinted(v) && v.state.dialog.isOpen && v.state.dialog.options.length <= 1,
                onFail: 'continue',
                maxFails: 12,
            },
        ),
        ...[0, 1].map(parity =>
            phase(
                talk,
                { continue: true },
                {
                    name: `seer-gap-${parity}`,
                    when: v =>
                        started(v) &&
                        glass(v) &&
                        !hinted(v) &&
                        !v.state.dialog.isOpen &&
                        Math.floor(v.state.tick / 4) % 2 === parity,
                    onFail: 'continue',
                    maxFails: 20,
                },
            ),
        ),
        phase(
            talk,
            { npc: '^Thormac$', choices: ['What do you need', 'in it for me', 'Ok, I will'] },
            { name: 'thormac-start', when: v => none(v) && lvl(v) === 3, maxFails: 3 },
        ),
        // The walk planner finds no connector onto level 3 of the Sorcerer's Tower (its ladder is the only way up),
        // so the last climb is a plain interact; the first two floors are walked.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2699, z: 3405, level: 2 },
                at: { x: 2698, z: 3405, level: 2, tolerance: 1 },
            },
            { name: 'tower-up', when: v => needThormac(v) && lvl(v) === 2 && inTower(v), maxFails: 3 },
        ),
        phase(
            travel,
            { to: { x: 2698, z: 3405, level: 2 }, tolerance: 1 },
            { name: 'to-tower', when: v => needThormac(v) && lvl(v) < 3 && !(lvl(v) === 2 && inTower(v)), maxFails: 3 },
        ),
    ],
});

// Death Plateau (server/content/scripts/quests/quest_death, id death; varps death_equiproom 0-70 and death_map).
// The quest tab shows none/started/done only, so stages ride on held items, position and the dialog history.
//   Denulth (2896,3528) starts it -> Eohric (castle, upstairs 2902,3565) -> Harold's bedroom (upstairs in the Toad and
//   Chicken inn, door 2906,3543 knocks) -> Eohric again -> Asgarnian ale (the inn bar) -> Harold: the ale and the dice
//   game (bet 1000; a win over Harold's gold gives the IOU) -> read the IOU (Combination) -> five Stone balls (ground
//   at 2893,3561-3565) used on the Stone mechanisms, blue/yellow/red/purple/green in the order the Combination gives.
//   Saba (cave, entrance 2857,3578) -> Tenzing (hut 2820,3556, front door knocks) -> Dunstan (2919,3574) -> Denulth
//   (certificate) -> Dunstan (certificate + Iron bar + Climbing boots = Spiked boots) -> Tenzing (boots, 10 Bread,
//   10 Trout) -> Secret way map -> walk the secret path north-east of the hut -> Denulth (map + Combination).
// Start save: lib:death-plateau-start (Burthorpe, 5000 coins, 10 Bread, 10 Trout, 1 Iron bar, scimitar worn).
// Restart-safe within reason: gates read held items, position and the dialog and message history, never run counts.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import pickup from '@conductor/tasks/pickup';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'death';
const n = (v: PlanView, name: string) => v.inv(name);
const hasId = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);
const said = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => re.test(d.text.join(' ')));
const heard = (v: PlanView, re: RegExp) => said(v, re) || v.state.gameMessages.some(m => re.test(m.text));
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const box = (v: PlanView, x0: number, x1: number, z0: number, z1: number, l = 0) =>
    lvl(v) === l && px(v) >= x0 && px(v) <= x1 && pz(v) >= z0 && pz(v) <= z1;

const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);

// Places.
const inRoom = (v: PlanView) => box(v, 2905, 2906, 3535, 3543, 1);
const placedAt = (v: PlanView, b: { id: number; x: number; z: number }) =>
    v.state.groundItems.some(g => g.id === b.id && g.x === b.x && g.z === b.z);
type Ball = { id: number; x: number; z: number; spawnZ: number };
const needBall = (v: PlanView, b: Ball) =>
    started(v) && combo(v) > 0 && !unlocked(v) && !hasId(v, b.id) && !placedAt(v, b);
// The secret path from the stile (2817,3562): waypoints picked from the map data (a route through walkable tiles
// that stays 7+ tiles from every troll spawn), not walked before.
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
    { x: 2859, z: 3609 },
];
const northSide = (v: PlanView) =>
    lvl(v) === 0 &&
    ((px(v) <= 2822 && pz(v) >= 3564 && pz(v) <= 3612) ||
        (px(v) >= 2812 && px(v) <= 2872 && pz(v) >= 3585 && pz(v) <= 3612));
const nearBar = (v: PlanView) => box(v, 2902, 2910, 3534, 3541, 0);
const inHut = (v: PlanView) => box(v, 2815, 2822, 3552, 3559);
const inCave = (v: PlanView) => px(v) < 2400 && pz(v) > 4000;

// Held items.
const iou = (v: PlanView) => n(v, 'Iou');
const combo = (v: PlanView) => n(v, 'Combination');
const ale = (v: PlanView) => n(v, 'Asgarnian ale');
const cboots = (v: PlanView) => n(v, 'Climbing boots');
const sboots = (v: PlanView) => n(v, 'Spiked boots');
const cert = (v: PlanView) => n(v, 'Certificate');
const map = (v: PlanView) => n(v, 'Secret way map');

// Dialog and message markers (stages only go up).
// The early talks chain (each marker implies the earlier ones, so a marker that slid out of the ~20-page dialog
// history is still known). The ale is handed over in the first game's conversation; later games follow a lost bet
// (coins below the 4998 left after the ale).
const aleGiven = (v: PlanView) =>
    ale(v) > 0 || iou(v) + combo(v) > 0 || heard(v, /hit the spot/i) || v.inv('Coins') < 4998;
const eohricB = (v: PlanView) => heard(v, /open up after a drink|got in trouble a few times/i) || aleGiven(v);
const haroldDuty = (v: PlanView) => heard(v, /don't want to talk about it/i) || eohricB(v);
const eohricA = (v: PlanView) => heard(v, /Harold is staying at the/i) || haroldDuty(v);
const needAle = (v: PlanView) => eohricB(v) && !inRoom(v) && iou(v) + combo(v) === 0;
const unlocked = (v: PlanView) => heard(v, /equipment room door has unlocked/i);
const sabaDone = (v: PlanView) =>
    heard(v, /Where does this Sherpa live|it can't be far as he used/i) || cboots(v) + sboots(v) + cert(v) + map(v) > 0;
const smithyDeal = (v: PlanView) => heard(v, /on one condition|have a deal/i) || cert(v) + sboots(v) + map(v) > 0;
const scouted = (v: PlanView) => heard(v, /no trolls on the secret path|trolls haven't found the path/i);

const tenzing1 = (v: PlanView) =>
    started(v) && sabaDone(v) && cboots(v) + sboots(v) + cert(v) + map(v) === 0 && !smithyDeal(v);
const tenzing2 = (v: PlanView) =>
    started(v) && sboots(v) > 0 && n(v, 'Bread') >= 10 && n(v, 'Trout') >= 10 && map(v) === 0 && !scouted(v);
const needSaba = (v: PlanView) => started(v) && combo(v) > 0 && unlocked(v) && !sabaDone(v);

const DENULTH = { npc: '^Denulth$', at: { x: 2896, z: 3526, tolerance: 2 } };
const EOHRIC = { npc: '^Eohric$', at: { x: 2902, z: 3565, level: 1, tolerance: 2 } };
const HAROLD = { npc: '^Harold$', at: { x: 2905, z: 3539, level: 1, tolerance: 2 } };
const DUNSTAN = { npc: '^Dunstan$', at: { x: 2919, z: 3573, tolerance: 2 } };
// no `at`: the door closes behind the bot and a walk into the hut knocks again; the talk starts from the door tile
const TENZING = { npc: '^Tenzing$' };

const HAROLD_DOOR = {
    target: 'loc',
    name: '^Door$',
    tile: { x: 2906, z: 3543, level: 1 },
    option: '^Open$',
    // the 1-wide hall north of the bedroom doors (z 3544); the stairs up land in the room at (2914,3542)
    at: { x: 2906, z: 3544, level: 1, tolerance: 1 },
} as const;

// Bets by coins held (Harold's gold g = 100 + START_COINS - coins; bet g+1 or more wins the IOU on a win).
// START_COINS: the 5000 of the start save less the 2 gp ale.
const START_COINS = 4998;
const GAMBLE_BANDS = [
    { bet: 101, min: START_COINS, max: START_COINS },
    { bet: 202, min: START_COINS - 101, max: START_COINS - 1 },
    { bet: 404, min: START_COINS - 303, max: START_COINS - 102 },
    { bet: 808, min: START_COINS - 707, max: START_COINS - 304 },
    { bet: 1000, min: 0, max: START_COINS - 708 },
    { bet: 1000, min: START_COINS + 1, max: 1e9 },
].filter((b, i, all) => all.findIndex(o => o.bet === b.bet && o.min === b.min) === i);

// Stone balls by id (red 3109, blue 3110, yellow 3111, purple 3112, green 3113) on their mechanism tiles.
const BALLS = [
    { colour: 'blue', id: 3110, x: 2894, z: 3562, spawnZ: 3564 },
    { colour: 'yellow', id: 3111, x: 2895, z: 3562, spawnZ: 3561 },
    { colour: 'red', id: 3109, x: 2894, z: 3563, spawnZ: 3565 },
    { colour: 'purple', id: 3112, x: 2895, z: 3563, spawnZ: 3563 },
    { colour: 'green', id: 3113, x: 2895, z: 3564, spawnZ: 3562 },
];

export default definePlan({
    name: 'death-plateau',
    description:
        'Death Plateau: Denulth, Eohric, Harold (ale, dice for the IOU), the stone-ball door puzzle, Saba, Tenzing, Dunstan (spiked boots), the secret path, Denulth.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => done(v),
    phases: [
        phase(talk, { continue: true }, { name: 'dialog', when: v => v.state.dialog.isOpen, onFail: 'continue' }),
        // --- the end ---
        phase(
            talk,
            { ...DENULTH },
            {
                name: 'finish',
                when: v => started(v) && map(v) > 0 && combo(v) > 0 && scouted(v) && !northSide(v) && px(v) >= 2878,
            },
        ),
        // The way between the hut and Burthorpe that is known to work (cave loop): a talk walking it direct sticks at (2864,3567).
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
                when: v => started(v) && scouted(v) && !northSide(v) && lvl(v) === 0 && px(v) < 2878 && pz(v) < 3600,
            },
        ),
        // --- the secret path (see SECRET_PATH): out by the stile, north along the corridor x=2817 and the cliff edge to the
        //     zone at (2864..2871,3608..3615), and straight back. The troll camp (z<=3600, x 2851-2876) lies south of
        //     the path behind cliffs; a plain travel to the zone could route through it, so every leg has waypoints.
        phase(
            interact,
            { target: 'loc', name: '^Stile$', option: '^Climb-over$', at: { x: 2817, z: 3564, tolerance: 1 } },
            { name: 'stile-out', when: v => started(v) && scouted(v) && northSide(v) && pz(v) < 3568 },
        ),
        phase(
            travel,
            { to: { x: 2817, z: 3566 }, waypoints: SECRET_PATH.toReversed().slice(1), tolerance: 1 },
            { name: 'path-back', when: v => started(v) && scouted(v) && northSide(v) && pz(v) >= 3568 },
        ),
        phase(
            travel,
            { to: { x: 2865, z: 3609 }, waypoints: SECRET_PATH.slice(1), tolerance: 1 },
            { name: 'path-forth', when: v => started(v) && map(v) > 0 && !scouted(v) && northSide(v) },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Stile$', option: '^Climb-over$', at: { x: 2817, z: 3561, tolerance: 1 } },
            { name: 'stile-in', when: v => started(v) && map(v) > 0 && !scouted(v) && !northSide(v) && !tenzing2(v) },
        ),
        phase(talk, { ...TENZING }, { name: 'tenzing-give', when: v => tenzing2(v) && inHut(v) }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                tile: { x: 2822, z: 3555 },
                option: '^Open$',
                at: { x: 2824, z: 3555, tolerance: 1 },
            },
            { name: 'hut-door', when: v => (tenzing1(v) || tenzing2(v)) && !inHut(v) && !inCave(v) },
        ),
        phase(talk, { ...DUNSTAN }, { name: 'dunstan-spikes', when: v => started(v) && cert(v) > 0 && cboots(v) > 0 }),
        phase(
            talk,
            { ...DENULTH },
            {
                name: 'denulth-cert',
                when: v => started(v) && smithyDeal(v) && cert(v) === 0 && cboots(v) > 0 && sboots(v) === 0,
            },
        ),
        phase(
            talk,
            { ...DUNSTAN },
            { name: 'dunstan-deal', when: v => started(v) && cboots(v) > 0 && !smithyDeal(v) && cert(v) === 0 },
        ),
        phase(
            talk,
            { ...TENZING, choices: ['get those for you'] },
            { name: 'tenzing-start', when: v => tenzing1(v) && inHut(v) },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Cave Exit$',
                option: '^Enter$|^Exit$|^Leave$',
                at: { x: 2268, z: 4752, tolerance: 2 },
            },
            { name: 'cave-out', when: v => inCave(v) && sabaDone(v) },
        ),
        phase(
            talk,
            { npc: '^Saba$', at: { x: 2270, z: 4758, tolerance: 2 }, choices: ['another way up Death Plateau'] },
            { name: 'saba', when: v => inCave(v) && !sabaDone(v) },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cave Entrance$', option: '^Enter$', at: { x: 2857, z: 3576, tolerance: 1 } },
            { name: 'cave-in', when: v => needSaba(v) && !inCave(v) },
        ),

        // --- the stone-ball puzzle ---
        ...BALLS.map(b =>
            phase(
                interact,
                {
                    target: 'loc',
                    name: '^Stone Mechanism$',
                    tile: { x: b.x, z: b.z },
                    use: { item: { id: b.id } },
                    at: { x: 2896, z: b.z, tolerance: 1 },
                },
                {
                    name: `place-${b.colour}`,
                    when: v => hasId(v, b.id) && !placedAt(v, b),
                    onFail: 'continue',
                    maxFails: 6,
                },
            ),
        ),
        // Each colour is taken from its own spawn tile (x=2893, z below): a circle of radius 2 around (2891, z) holds
        // that ball alone (the next spawn is 2.2 away, the placed balls at x>=2894 are out). A ball respawns at
        // once, so a pick by count could return a colour already placed.
        ...BALLS.map(b =>
            phase(
                pickup,
                { area: { x: 2891, z: b.spawnZ, radius: 2, level: 0 }, items: [{ item: 'Stone ball', count: 1 }] },
                { name: `ball-${b.colour}`, when: v => needBall(v, b) },
            ),
        ),
        phase(
            interact,
            { target: 'item', name: '^Iou$', option: '^Read$', expect: 'found the combination' },
            { name: 'read-iou', when: v => iou(v) > 0 },
        ),

        // --- Harold ---
        // One band per bet size: Harold's gold is 100 plus what he has won, i.e. 100 + (START_COINS - coins), and a win
        // beats it for the IOU only with a bet above it. More than START_COINS held: the plain 1000 bet.
        ...GAMBLE_BANDS.map((b, i) =>
            phase(
                talk,
                {
                    ...HAROLD,
                    choices: ['gamble'],
                    amount: b.bet,
                    press: { component: 'death_dice:com_28', ready: 'Your roll', until: 'You (win|lose)' },
                },
                {
                    name: `gamble-${i}`,
                    when: v =>
                        inRoom(v) &&
                        eohricB(v) &&
                        iou(v) + combo(v) === 0 &&
                        v.inv('Coins') >= b.bet &&
                        v.inv('Coins') >= b.min &&
                        v.inv('Coins') <= b.max,
                    maxFails: 5,
                },
            ),
        ),
        phase(interact, HAROLD_DOOR, {
            name: 'door-gamble',
            when: v => eohricB(v) && aleGiven(v) && !inRoom(v) && iou(v) + combo(v) === 0,
        }),
        phase(
            travel,
            { to: { x: 2906, z: 3539, level: 0 }, tolerance: 2 },
            { name: 'to-bar', when: v => ale(v) === 0 && !aleGiven(v) && needAle(v) && !nearBar(v) },
        ),
        phase(
            shop,
            { npc: 'Tostig', buy: [{ item: 'Asgarnian ale', count: 1 }] },
            { name: 'ale', when: v => ale(v) === 0 && !aleGiven(v) && needAle(v) && nearBar(v) },
        ),
        phase(talk, { ...EOHRIC }, { name: 'eohric-2', when: v => started(v) && haroldDuty(v) && !eohricB(v) }),
        phase(interact, HAROLD_DOOR, {
            name: 'door-duty',
            when: v => started(v) && eohricA(v) && !haroldDuty(v) && !inRoom(v),
        }),
        phase(
            talk,
            { ...HAROLD, choices: ['on duty last night'] },
            { name: 'harold-duty', when: v => started(v) && eohricA(v) && !haroldDuty(v) && inRoom(v) },
        ),
        phase(
            talk,
            { ...EOHRIC, choices: ['guard that was on'] },
            { name: 'eohric-1', when: v => started(v) && !eohricA(v) },
        ),
        phase(
            talk,
            { ...DENULTH, choices: ['quests for me', 'perhaps I could try'] },
            { name: 'start', when: v => v.quest(ID) === 'none' },
        ),
    ],
});

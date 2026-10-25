// Holy Grail (quest id grail; wiki/quests/holy-grail.md, learnings/ships.md): Arthur, Merlin, Entrana (High Priest ->
// Crone), Galahad (napkin), gear from the Seers bank, Draynor Manor whistles, ship to Karamja, the six heads, whistle
// into the blighted Fisher Realm, Black Knight Titan (Excalibur worn, Protect from Melee), Fisherman -> Grail bell,
// ring -> castle, Fisher King, whistle out, ship back, Percival in the Goblin Village sacks (takes a whistle), ship
// to Karamja again, whistle into the restored realm, Holy grail, whistle out, ship to Ardougne, Arthur.
// The quest tab shows none/started/done only, so progress rides on markers that survive a restart:
//   * Holy table napkin held = Galahad done; Excalibur (pack or worn) = gear fetched; Magic whistles held (2, then 1
//     once Percival has taken one); a Holy grail held; Grail bell held.
//   * Coins count the fares paid (start with 290-300, a fare is 30): the sailing out leaves 270 and the customs fare
//     back 240, so "two whistles and coins >= 260" = the first trip is still to come (or under way) and "two whistles,
//     fewer coins" = Percival is next. The
//     blow-in at the heads is told apart from the blow-out return by the Fisher King dialog in the history.
//   * Entrana and the Fisher Realm are told apart by place; the quay at Port Sarim (3048,3234) is where the Entrana
//     boat returns (Galahad next). The 10-page dialog history tells the talk steps apart inside one run; after a restart
//     those steps are repeated, which is harmless.
// Needs: Merlin's Crystal done with Excalibur banked (Seers Village) with rune armour (chainbody: the platebody needs Dragon Slayer) + boots + 20 lobsters, Attack
// 70+, Prayer 43+ (Protect from Melee), 290-300 coins and nothing else in the pack (the Entrana boat refuses gear).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'grail';
const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const box = (v: PlanView, x0: number, x1: number, z0: number, z1: number) =>
    px(v) >= x0 && px(v) <= x1 && pz(v) >= z0 && pz(v) <= z1;
const seen = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const dlg = (v: PlanView) => v.state.dialog.isOpen;

const started = (v: PlanView) => v.quest(ID) === 'started';
const done = (v: PlanView) => v.questDone(ID);
const napkin = (v: PlanView) => v.inv('Holy table napkin');
const whistles = (v: PlanView) => v.inv('Magic whistle');
const bell = (v: PlanView) => v.inv('Grail bell');
const grail = (v: PlanView) => v.inv('Holy grail');
const coins = (v: PlanView) => v.inv('Coins');
const excTotal = (v: PlanView) =>
    v.inv('Excalibur') + v.state.equipment.filter(i => /^excalibur$/i.test(i.name)).length;
const excWorn = (v: PlanView) => v.state.equipment.some(i => /^excalibur$/i.test(i.name));

const merlinSeen = (v: PlanView) => seen(v, /Holy Grail is likely to reside|powerful artefact indeed/i);
const croneSeen = (v: PlanView) => seen(v, /six heads face|Good luck with that/i);
const fishSeen = (v: PlanView) => seen(v, /Just ring one of the bells|ALWAYS bells/i);
const ringSeen = (v: PlanView) => seen(v, /Somehow you are now inside|Welcome to the Grail castle/i);
const fkSeen = (v: PlanView) => seen(v, /knight of the round table|waiting for my son/i);

// Places.
const realm = (v: PlanView) => pz(v) > 4600 && px(v) >= 2600 && px(v) <= 2850;
const blighted = (v: PlanView) => realm(v) && px(v) >= 2730;
const restored = (v: PlanView) => realm(v) && px(v) < 2730;
const west = (v: PlanView) => px(v) < 2791;
const island = (v: PlanView) => lvl(v) === 0 && box(v, 2815, 2870, 3320, 3365);
const karamja = (v: PlanView) => lvl(v) === 0 && box(v, 2700, 2990, 3100, 3265);
const atHeads = (v: PlanView) => lvl(v) === 0 && box(v, 2740, 2743, 3234, 3237);
const mainland = (v: PlanView) => !realm(v) && !karamja(v) && !island(v);
const quayEntrana = (v: PlanView) => lvl(v) === 0 && box(v, 3046, 3050, 3233, 3235);
const nearSacks = (v: PlanView) => lvl(v) === 0 && box(v, 2950, 2970, 3498, 3516);
const topManor = (v: PlanView) => lvl(v) === 2 && box(v, 3095, 3115, 3350, 3375);

// The first trip is still to come: two whistles and the fares unpaid (or no fare yet seen), or a single whistle (Percival
// has taken one) and the grail not yet taken.
const firstTrip = (v: PlanView) => whistles(v) >= 2 && coins(v) >= 260;
const secondTrip = (v: PlanView) => whistles(v) === 1 && grail(v) === 0;
const wantIn = (v: PlanView) => firstTrip(v) || secondTrip(v);
const prayerPoints = (v: PlanView) => v.state.skills.find(k => k.name === 'Prayer')?.level ?? 0;
const titanReady = (v: PlanView) => blighted(v) && bell(v) === 0 && !west(v) && !fishSeen(v) && excWorn(v);
const hasGear = (v: PlanView) => excWorn(v) && v.state.equipment.length >= 4;

const arthur = { npc: '^King Arthur$', at: { x: 2764, z: 3515, tolerance: 3 } };
const gang = (x: number, z: number) => ({
    target: 'loc' as const,
    name: '^Gangplank$',
    option: 'Cross',
    tile: { x, z, level: 1 },
});
const customsChoices = ['Can I journey', 'Search away', '^Ok'];
const whistle = { target: 'item' as const, name: '^Magic whistle$', option: '^Blow$' };
const doorTile = { x: 3106, z: 3361, level: 2 };
const manorDoor = {
    target: 'loc' as const,
    name: '^Door$',
    option: '^Open$',
    at: { ...doorTile, tolerance: 1 },
    tile: doorTile,
};
const manorPickup = { area: { x: 3107, z: 3359, level: 2, radius: 2 }, items: [{ item: 'Magic whistle', count: 2 }] };

export default definePlan({
    name: 'holy-grail',
    description:
        'Holy Grail to done: Arthur, Merlin, Entrana High Priest, Galahad napkin, Seers gear, Draynor Manor whistles, ships to Karamja, six heads, Black Knight Titan, Fisherman bell, Fisher King, Percival, restored realm grail, Arthur.',
    requires: {
        ...QUEST_TAB_REQUIRED,
        'coins for the four fares (120+) unless the quest is far on': v => coins(v) >= 30 || done(v) || grail(v) > 0,
    },
    until: v => done(v),
    phases: [
        // The whistle room (south of the door) has no walk out: pass back through the door, which swings the player north.
        phase(
            interact,
            { target: 'loc', name: '^Door$', option: '^Open$', tile: doorTile },
            {
                name: 'leave-whistle-room',
                when: v => topManor(v) && pz(v) <= 3360 && whistles(v) >= 2,
                maxFails: 3,
            },
        ),
        // The walk down from the manor's top floor is not planned: take the stairs by hand.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Climb-down$',
                at: { x: 3106, z: 3363, level: 2, tolerance: 2 },
            },
            { name: 'manor-down', when: v => topManor(v) && pz(v) >= 3361 && whistles(v) >= 2, maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Staircase$',
                option: '^Walk-down$',
                at: { x: 3108, z: 3365, level: 1, tolerance: 2 },
            },
            {
                name: 'manor-down-1',
                when: v => lvl(v) === 1 && box(v, 3095, 3125, 3352, 3377) && whistles(v) >= 2,
                maxFails: 3,
            },
        ),
        // The workshop door only lets the walk out with the quest token (talk's own walk does not carry it).
        phase(
            travel,
            { to: { x: 2760, z: 3512, level: 0 }, met: ['quest:grail>=1'], tolerance: 3 },
            { name: 'leave-workshop', when: v => lvl(v) === 1 && box(v, 2762, 2772, 3494, 3503), maxFails: 3 },
        ),
        // --- decks: step off the ship ---
        phase(interact, gang(2834, 3333), {
            name: 'off-entrana-deck',
            when: v => lvl(v) === 1 && box(v, 2830, 2840, 3327, 3335),
            maxFails: 4,
        }),
        phase(interact, gang(3048, 3232), {
            name: 'off-sarim-deck-a',
            when: v => lvl(v) === 1 && box(v, 3044, 3052, 3228, 3234),
            maxFails: 4,
        }),
        phase(interact, gang(3031, 3217), {
            name: 'off-sarim-deck-b',
            when: v => lvl(v) === 1 && box(v, 3030, 3036, 3213, 3220),
            maxFails: 4,
        }),
        phase(interact, gang(2956, 3144), {
            name: 'off-musa-deck',
            when: v => lvl(v) === 1 && box(v, 2950, 2960, 3138, 3146),
            maxFails: 4,
        }),
        phase(interact, gang(2774, 3234), {
            name: 'off-brimhaven-deck',
            when: v => lvl(v) === 1 && box(v, 2770, 2780, 3230, 3238),
            maxFails: 4,
        }),
        phase(interact, gang(2683, 3269), {
            name: 'off-ardougne-deck',
            when: v => lvl(v) === 1 && box(v, 2679, 2688, 3264, 3272),
            maxFails: 4,
        }),

        // --- finish: the grail to Arthur ---
        phase(talk, arthur, { name: 'arthur-finish', when: v => grail(v) > 0 && mainland(v), maxFails: 4 }),
        phase(
            talk,
            {
                npc: '^Customs officer$',
                at: { x: 2772, z: 3228, tolerance: 3 },
                choices: customsChoices,
                travels: true,
            },
            { name: 'ship-ardougne', when: v => grail(v) > 0 && karamja(v), maxFails: 4 },
        ),
        phase(interact, whistle, { name: 'blow-out-grail', when: v => grail(v) > 0 && restored(v), maxFails: 4 }),

        // --- the restored realm: the grail on the castle's top floor ---
        phase(
            pickup,
            { area: { x: 2649, z: 4684, level: 2, radius: 2 }, items: [{ item: 'Holy grail', count: 1 }] },
            { name: 'take-grail', when: v => restored(v) && grail(v) === 0 && lvl(v) === 2, maxFails: 4 },
        ),
        phase(
            travel,
            { to: { x: 2650, z: 4684, level: 2 }, tolerance: 1 },
            { name: 'to-grail', when: v => restored(v) && grail(v) === 0 && lvl(v) !== 2, maxFails: 4 },
        ),

        // --- the blighted realm ---
        phase(interact, whistle, {
            name: 'blow-out-realm',
            when: v => blighted(v) && fkSeen(v) && ringSeen(v),
            maxFails: 4,
        }),
        phase(
            talk,
            {
                npc: '^The Fisher King$',
                at: { x: 2762, z: 4687, level: 1, tolerance: 2 },
                choices: ["You don't look too well"],
            },
            { name: 'fisher-king', when: v => blighted(v) && bell(v) > 0 && ringSeen(v) && !fkSeen(v), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'item',
                name: '^Grail bell$',
                option: '^Ring$',
                at: { x: 2762, z: 4694, tolerance: 2 },
                expect: 'inside the castle|Welcome to the Grail castle',
            },
            { name: 'ring', when: v => blighted(v) && bell(v) > 0 && !ringSeen(v), maxFails: 4 },
        ),
        phase(
            pickup,
            { area: { x: 2762, z: 4694, radius: 2 }, items: [{ item: 'Grail bell', count: 1 }] },
            { name: 'bell', when: v => blighted(v) && bell(v) === 0 && fishSeen(v), maxFails: 3 },
        ),
        phase(
            talk,
            { npc: '^Fisherman$', at: { x: 2802, z: 4706, tolerance: 2 }, choices: ['get into the castle'] },
            {
                name: 'fisherman',
                when: v =>
                    blighted(v) &&
                    bell(v) === 0 &&
                    west(v) &&
                    (!fishSeen(v) || (v.last?.phase === 'bell' && v.last.status !== 'done')),
                maxFails: 4,
            },
        ),
        // Protect from Melee while the Prayer points last (43 points last about 100 s), then plain melee with food.
        phase(
            combat,
            {
                target: 'Black Knight Titan',
                area: { x: 2791, z: 4722, radius: 6 },
                weapon: 'Excalibur',
                food: ['Swordfish', 'Lobster'],
                maxLevelGap: 40,
                prayers: ['Protect from Melee'],
            },
            {
                name: 'titan',
                when: v => titanReady(v) && prayerPoints(v) > 0,
                until: v => blighted(v) && west(v),
                onFail: 'continue',
                maxFails: 3,
            },
        ),
        phase(
            combat,
            {
                target: 'Black Knight Titan',
                area: { x: 2791, z: 4722, radius: 6 },
                weapon: 'Excalibur',
                food: ['Swordfish', 'Lobster'],
                maxLevelGap: 40,
            },
            {
                name: 'titan-melee',
                when: v => titanReady(v),
                until: v => blighted(v) && west(v),
                maxFails: 3,
            },
        ),

        // --- the heads on Karamja ---
        phase(interact, whistle, { name: 'blow-in', when: v => atHeads(v) && wantIn(v) && !fkSeen(v), maxFails: 4 }),
        phase(
            travel,
            { to: { x: 2741, z: 3235 }, tolerance: 1 },
            {
                name: 'to-heads',
                when: v => karamja(v) && !atHeads(v) && wantIn(v) && !fkSeen(v) && hasGear(v),
                maxFails: 4,
            },
        ),
        // Back from the realm with two whistles: ship to Port Sarim from Musa Point, then Percival.
        phase(
            talk,
            {
                npc: '^Customs officer$',
                at: { x: 2954, z: 3147, tolerance: 3 },
                choices: customsChoices,
                travels: true,
            },
            {
                name: 'ship-musa-back',
                when: v => karamja(v) && grail(v) === 0 && whistles(v) >= 2 && fkSeen(v),
                maxFails: 4,
            },
        ),

        // --- Percival in the Goblin Village sacks ---
        phase(
            talk,
            { continue: true, choices: ['Your father wishes to speak to you'] },
            { name: 'percival', when: v => dlg(v) && nearSacks(v), maxFails: 4 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Sacks$', option: '^Open$', at: { x: 2960, z: 3509, tolerance: 2 } },
            {
                name: 'sacks',
                when: v => mainland(v) && !dlg(v) && whistles(v) >= 2 && coins(v) < 260 && napkin(v) > 0,
                maxFails: 4,
            },
        ),

        // --- ships out from Port Sarim ---
        phase(
            talk,
            { npc: '^Captain Tobias$', at: { x: 3028, z: 3216, tolerance: 3 }, choices: ['Yes please'], travels: true },
            { name: 'ship-karamja', when: v => mainland(v) && hasGear(v) && wantIn(v) && coins(v) >= 30, maxFails: 4 },
        ),

        // --- whistles from Draynor Manor ---
        phase(pickup, manorPickup, {
            name: 'whistle-pickup',
            when: v => topManor(v) && whistles(v) < 2 && napkin(v) > 0,
            onFail: 'continue',
            maxFails: 3,
        }),
        phase(interact, manorDoor, {
            name: 'whistle-door',
            when: v =>
                napkin(v) > 0 &&
                whistles(v) === 0 &&
                hasGear(v) &&
                (!topManor(v) || v.last?.phase === 'whistle-pickup'),
            maxFails: 4,
        }),

        // --- gear from the Seers bank, then wear it ---
        phase(
            items,
            {
                equip: [
                    'Excalibur',
                    'Rune full helm',
                    'Rune chainbody',
                    'Rune platelegs',
                    'Rune kiteshield',
                    'Leather boots',
                ],
            },
            { name: 'wear', when: v => v.inv('Excalibur') > 0, maxFails: 3 },
        ),
        phase(
            bank,
            {
                area: { x: 2726, z: 3492, radius: 5 },
                withdraw: [
                    { item: 'Excalibur', count: 1 },
                    { item: 'Rune full helm', count: 1 },
                    { item: 'Rune chainbody', count: 1 },
                    { item: 'Rune platelegs', count: 1 },
                    { item: 'Rune kiteshield', count: 1 },
                    { item: 'Leather boots', count: 1 },
                    { item: 'Lobster', count: 20 },
                ],
            },
            { name: 'gear', when: v => napkin(v) > 0 && excTotal(v) === 0 && mainland(v), maxFails: 3 },
        ),

        // --- Entrana: High Priest (Crone), then back and Galahad ---
        phase(
            talk,
            { npc: 'Galahad', at: { x: 2612, z: 3474, tolerance: 2 }, choices: ['I seek an item from the realm'] },
            {
                name: 'galahad',
                when: v =>
                    started(v) &&
                    napkin(v) === 0 &&
                    mainland(v) &&
                    excTotal(v) === 0 &&
                    (croneSeen(v) || quayEntrana(v)),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            {
                npc: '^Monk of Entrana$',
                at: { x: 2835, z: 3336, tolerance: 2 },
                choices: ["Yes, I'm ready"],
                travels: true,
            },
            { name: 'entrana-back', when: v => island(v) && croneSeen(v), maxFails: 4 },
        ),
        phase(
            talk,
            { npc: '^High Priest$', at: { x: 2851, z: 3349, tolerance: 2 }, choices: ['Ok, I will go searching'] },
            { name: 'high-priest', when: v => island(v) && !croneSeen(v), maxFails: 4 },
        ),
        phase(
            talk,
            { npc: '^Monk of Entrana$', at: { x: 3047, z: 3236, tolerance: 2 }, choices: ['Yes, okay'], travels: true },
            {
                name: 'entrana-out',
                when: v =>
                    started(v) &&
                    napkin(v) === 0 &&
                    mainland(v) &&
                    merlinSeen(v) &&
                    !croneSeen(v) &&
                    !quayEntrana(v) &&
                    excTotal(v) === 0,
                maxFails: 4,
            },
        ),

        // --- start: Arthur, Merlin ---
        phase(
            talk,
            {
                npc: '^Merlin$',
                at: { x: 2767, z: 3500, level: 1, tolerance: 2 },
                choices: ['Thank you for the advice'],
            },
            {
                name: 'merlin',
                when: v =>
                    started(v) &&
                    napkin(v) === 0 &&
                    mainland(v) &&
                    !merlinSeen(v) &&
                    !croneSeen(v) &&
                    !quayEntrana(v) &&
                    excTotal(v) === 0,
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { ...arthur, choices: ['Tell me of this quest', "I'd enjoy trying that"] },
            { name: 'arthur-start', when: v => v.quest(ID) === 'none', maxFails: 4 },
        ),
    ],
});

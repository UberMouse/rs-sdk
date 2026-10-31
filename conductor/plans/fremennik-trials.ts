// The Fremennik Trials (quest id viking; server/content/scripts/quests/quest_viking). Seven trials give one council vote
// each (Brundt wants 7): Swensen's maze, Manni's drinking contest (cheat route), Olaf's lyre, Thorvald's Koschei (unarmed,
// the fourth form's killing blow is a fake death that still counts), Peer's riddle house, Sigmund's trading chain and
// Sigli's Draugen (stub: needs the locate task).
// The client sees no stage numbers, and most trial dialogs leave no item behind, so progress rides on a LEDGER: a stack
// of Bones in the pack, one dropped at each finished step (the count is the stage; a restart reads it back). Phase 1
// (Rellekka, empty hands, because Thorvald's arena and Peer's house refuse weapons, armour, logs and, for Peer, any
// item) carries 10 Bones and 12 Lobster; Peer's deposit spell banks the whole pack, so phase 2 starts at the Seers'
// bank, which hands out the tools and a fresh ledger.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import combolock from '@conductor/tasks/combolock';
import bank from '@conductor/tasks/bank';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import locate from '@conductor/tasks/locate';
import pickup from '@conductor/tasks/pickup';
import travel from '@conductor/tasks/travel';
import talk from '@conductor/tasks/talk';

const ID = 'viking';

const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const box = (v: PlanView, x0: number, x1: number, z0: number, z1: number, level = 0) =>
    lvl(v) === level && px(v) >= x0 && px(v) <= x1 && pz(v) >= z0 && pz(v) <= z1;
const near = (v: PlanView, x: number, z: number, r: number, level = 0) =>
    lvl(v) === level && Math.max(Math.abs(px(v) - x), Math.abs(pz(v) - z)) <= r;
const heard = (v: PlanView, re: RegExp) =>
    v.state.gameMessages.some(m => re.test(m.text)) || v.state.recentDialogs.some(d => re.test(d.text.join(' ')));

const started = (v: PlanView) => v.quest(ID) !== 'none';
const done = (v: PlanView) => v.questDone(ID);
const bones = (v: PlanView) => v.inv('Bones');
const lead = (v: PlanView) => v.inv('Big bones');
const inMaze = (v: PlanView) => pz(v) > 9900 && pz(v) < 10060 && px(v) > 2620 && px(v) < 2690;
const inArena = (v: PlanView) => lvl(v) === 2 && pz(v) > 10000;

const brundt = { npc: '^Brundt the Chieftain$', at: { x: 2659, z: 3669, tolerance: 3 } };
const manni = { npc: '^Manni the Reveller$', at: { x: 2660, z: 3673, tolerance: 3 } };
const olaf = { npc: '^Olaf the Bard$', at: { x: 2673, z: 3683, tolerance: 3 } };
const swensen = { npc: '^Swensen the Navigator$', at: { x: 2646, z: 3660, tolerance: 3 } };
const thorvald = { npc: '^Thorvald the Warrior$', at: { x: 2666, z: 3693, tolerance: 3 } };
const peer = { npc: '^Peer the Seer$', at: { x: 2634, z: 3668, tolerance: 3 } };

// ---- Peer's house (levels 0 and 2 of the footprint x 2628..2639, z 3659..3667), told apart by what the pack holds ----
const n = (v: PlanView, re: RegExp) => v.state.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const noItems = (v: PlanView) => v.state.inventory.length === 0;
const inHouse = (v: PlanView, level: number) => box(v, 2628, 2639, 3659, 3666, level);
const wantEast = (v: PlanView) => seerKey(v) > 0 || (disk(v) >= 2 && lid(v) === 0);
const east0 = (v: PlanView) => inHouse(v, 0) && px(v) >= 2635;
const nearPeerDoor = (v: PlanView) => box(v, 2625, 2641, 3667, 3674);
const peerDone = (v: PlanView) => heard(v, /solved my puzzle so quickly|unlock the door with your key/i);
const disk = (v: PlanView) => n(v, /^Red disk$/);
const wood = (v: PlanView) => n(v, /^Wooden disk$/);
const herring = (v: PlanView) => n(v, /^Red herring$/);
const goop = (v: PlanView) => n(v, /^Sticky red goop$/);
const lid = (v: PlanView) => n(v, /^Vase lid$/);
const vase = (v: PlanView) => n(v, /^Vase$/);
const vaseWater = (v: PlanView) => n(v, /^Vase of water$/);
const sealed = (v: PlanView) => n(v, /^Sealed vase$/);
const iceKey = (v: PlanView) => n(v, /^Frozen key$/);
const seerKey = (v: PlanView) => n(v, /^Seers' key$/);
const afterLid = (v: PlanView) => lid(v) + sealed(v) + iceKey(v) + seerKey(v) > 0;
const bucket = (v: PlanView, re: RegExp) => n(v, re);
const emptyBucket = (v: PlanView) => bucket(v, /^Empty bucket$/);
const fullBucket = (v: PlanView) => bucket(v, /^Full bucket$/);
const bucket2 = (v: PlanView) => bucket(v, /^2\/5ths full bucket$/);
const bucket4 = (v: PlanView) => bucket(v, /^4\/5ths full bucket$/);
const emptyJug = (v: PlanView) => n(v, /^Empty jug$/);
const fullJug = (v: PlanView) => n(v, /^Full jug$/);
const jug2 = (v: PlanView) => n(v, /^2\/3rds full jug$/);
const anyJug = (v: PlanView) => n(v, / jug$/);
const anyBucket = (v: PlanView) => n(v, / bucket$/);
// The water leg is finished once the vase exists (or anything after it).
const waterDone = (v: PlanView) => vase(v) + vaseWater(v) + sealed(v) + iceKey(v) + seerKey(v) > 0;
// A visible loc at that tile that offers Open and nothing else of an opened one (Search, Shut, Close): a closed
// cupboard or chest. Stale copies of the loc at the same tile are tolerated.
const isClosed = (v: PlanView, x: number, z: number) => {
    const here = v.state.nearbyLocs.filter(l => l.x === x && l.z === z && l.level === lvl(v));
    return (
        here.some(l => l.options.some(o => /^Open$/i.test(o))) &&
        !here.some(l => l.options.some(o => /^(Search|Shut|Close)$/i.test(o)))
    );
};
// L2 items, by the loc they come from.
const up2 = (x: number, z: number) => ({ x, z, level: 2, tolerance: 1 });
const loc2 = (name: string, option: string, x: number, z: number, sx: number, sz: number) => ({
    target: 'loc' as const,
    name,
    option,
    tile: { x, z, level: 2 },
    at: up2(sx, sz),
});
const use2 = (item: string, name: string, x: number, z: number, sx: number, sz: number) => ({
    target: 'loc' as const,
    name,
    use: { item },
    tile: { x, z, level: 2 },
    at: up2(sx, sz),
});

// ---- phase 2 (after Peer): the Seers' kit, Manni's cheat, Olaf's lyre, Sigmund's chain, Sigli ----
const has = (v: PlanView, name: string) => v.inv(name) > 0;
const SEERS_BANK = { x: 2727, z: 3493, radius: 4 };
const npcAt = (
    npc: string,
    x: number,
    z: number,
    tolerance = 3,
): { npc: string; at: { x: number; z: number; tolerance: number }; option?: string } => ({
    npc,
    at: { x, z, tolerance },
});
const sigmund = npcAt('^Sigmund The Merchant$', 2641, 3680);
const sailor = npcAt('^Sailor$', 2629, 3693);
const yrsa = npcAt('^Yrsa$', 2625, 3675);
const skul = npcAt('^Skulgrimen$', 2663, 3694);
const fisher = npcAt('^Fisherman$', 2641, 3699);
const thora = { ...npcAt('^Thora the Barkeep$', 2662, 3673), option: '^talk[ -]?to$' };
const askeladden = npcAt('^Askeladden$', 2658, 3660);
const sigli = npcAt('^Sigli the Huntsman$', 2660, 3653);
const lalli = npcAt('^Lalli$', 2770, 3622);
const MERCHANT = ['Merchant'];
const veg = (v: PlanView) => (has(v, 'Cabbage') ? 1 : 0) + (has(v, 'Potato') ? 1 : 0) + (has(v, 'Onion') ? 1 : 0);
const lyreAny = (v: PlanView) => n(v, /^(Unstrung lyre|Lyre|Enchanted lyre)$/);
const absorbed = (v: PlanView) => heard(v, /absorb the Draugen's essence/i);
// An item swap with an NPC that shows in the pack: no ledger needed.
const swap = (name: string, who: ReturnType<typeof npcAt>, holds: string) =>
    phase(talk, { ...who, choices: MERCHANT }, { name, when: v => has(v, holds), onFail: 'continue', maxFails: 6 });

// The loc list lags the game by a selection: after an Open, wait out one cheap failing phase so the open is not
// picked a second time (a done phase picked twice in a row ends the plan).
const settle = (name: string, when: (v: PlanView) => boolean) =>
    phase(talk, { continue: true }, { name, when, onFail: 'continue', maxFails: 8 });

// One Bones dropped: the ledger steps down.
const tick = (name: string, when: (v: PlanView) => boolean) =>
    phase(items, { drop: [{ item: '^Bones$', count: 1 }] }, { name, when, maxFails: 4 });

const tick1 = (name: string, when: (v: PlanView) => boolean) =>
    phase(items, { drop: [{ item: '^Big bones$', count: 1 }] }, { name, when, maxFails: 4 });
const talkStep1 = (
    name: string,
    ledger: number,
    who: { npc: string; at: { x: number; z: number; tolerance: number } },
    choices: string[],
    marker: RegExp,
) => [
    tick1(`tick-${name}`, v => lead(v) === ledger && heard(v, marker)),
    phase(talk, { ...who, choices }, { name, when: v => lead(v) === ledger && !heard(v, marker), maxFails: 4 }),
];
// A talk that changes no item: the talk runs while its closing line is not in the dialog history, the tick follows
// once it is (the ledger is the memory across a restart; the history only bridges the two phases).
const talkStep = (
    name: string,
    ledger: number,
    who: { npc: string; at: { x: number; z: number; tolerance: number }; option?: string },
    choices: string[],
    marker: RegExp,
) => [
    tick(`tick-${name}`, v => bones(v) === ledger && heard(v, marker)),
    phase(
        talk,
        { ...who, choices },
        { name, when: v => bones(v) === ledger && !heard(v, marker), onFail: 'continue', maxFails: 6 },
    ),
];

// The maze: a portal chain. Local tile (x,z) in map square 41_156 is world (2624+x, 9984+z); `from` is where the
// previous portal lands.
const portal = (name: string, tx: number, tz: number, from: [number, number]) =>
    phase(
        interact,
        {
            target: 'loc' as const,
            name: '^Portal$',
            option: '^Use$',
            tile: { x: tx, z: tz },
            at: { x: tx, z: tz + 1, tolerance: 2 },
        },
        { name, when: v => lead(v) === 6 && inMaze(v) && near(v, from[0], from[1], 7), maxFails: 4 },
    );

const prayer = (v: PlanView) => v.state.skills.find(x => x.name === 'Prayer')?.level ?? 0;
// Hallifred only credits the maze when he stands within 5 tiles of the exit: his line proves it, else go round again.
const mazeDone = (v: PlanView) => heard(v, /finished my maze|genuinely impressed/i);
const koscheiDone = (v: PlanView) => heard(v, /warrior'?s trial|warriors trial/i);

export default definePlan({
    name: 'fremennik-trials',
    description:
        'The Fremennik Trials: Brundt, then Manni/Olaf/Swensen starts, the maze, Thorvald and Koschei unarmed, Peer (bank, riddle, house), then the Seers kit for the drinking contest, lyre and trading chain.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // The walker cannot plan from an upper floor: climb down the wheel house's ladder first.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 2715, z: 3470, level: 1, tolerance: 1 },
            },
            { name: 'seers-down', when: v => lvl(v) === 1 && near(v, 2712, 3471, 8, 1), maxFails: 4 },
        ),
        // Yrsa's shop door (2627,3675) is not one the walker opens: open it once she shows but cannot be reached.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2627, z: 3675 },
                at: { x: 2628, z: 3675, tolerance: 1 },
            },
            {
                name: 'yrsa-door',
                when: v =>
                    (bones(v) === 17 || has(v, 'Fiscal statement')) &&
                    v.state.nearbyNpcs.some(x => x.name === 'Yrsa' && x.reachable === false) &&
                    near(v, 2627, 3675, 6),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        // ---- Sigli, then Brundt ----
        phase(
            talk,
            { npc: '^Brundt the Chieftain$', at: { x: 2659, z: 3669, tolerance: 3 } },
            { name: 'brundt-finish', when: v => bones(v) === 4 && started(v), maxFails: 6 },
        ),
        // White wolves in the forest hunt: finish whatever has hold of the bot before the next talk.
        phase(
            combat,
            {
                target: 'Wolf',
                area: { x: 2640, z: 3630, radius: 60 },
                food: ['Lobster'],
                eatBelow: 0.5,
                maxLevelGap: 20,
            },
            {
                name: 'wolf-fight',
                when: v => bones(v) === 5 && v.state.nearbyNpcs.some(x => x.name === 'Wolf' && x.distance <= 8),
                onFail: 'continue',
                maxFails: 10,
            },
        ),
        tick('tick-sigli-finish', v => bones(v) === 5 && heard(v, /honoured to speak out for you/i)),
        phase(
            talk,
            { ...sigli },
            {
                name: 'sigli-finish',
                when: v => bones(v) === 5 && absorbed(v) && !heard(v, /honoured to speak out for you/i),
                maxFails: 4,
            },
        ),
        // The Draugen can stand idle beside the bot (flagged in combat, so `combat` will not pick it): walk off so it follows and attacks.
        phase(
            travel,
            { to: { x: 2660, z: 3640 }, tolerance: 3 },
            {
                name: 'draugen-lure',
                when: v =>
                    bones(v) === 5 &&
                    !absorbed(v) &&
                    v.state.player?.combat.inCombat !== true &&
                    v.state.nearbyNpcs.some(x => x.name === 'The Draugen' && x.distance <= 3) &&
                    !near(v, 2660, 3640, 6),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            travel,
            { to: { x: 2690, z: 3630 }, tolerance: 3 },
            {
                name: 'draugen-lure-b',
                when: v =>
                    bones(v) === 5 &&
                    !absorbed(v) &&
                    v.state.player?.combat.inCombat !== true &&
                    v.state.nearbyNpcs.some(x => x.name === 'The Draugen' && x.distance <= 3) &&
                    near(v, 2660, 3640, 6),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            combat,
            {
                target: 'The Draugen',
                skill: 'Attack',
                area: { x: 2695, z: 3620, radius: 40 },
                food: ['Lobster'],
                eatBelow: 0.5,
            },
            {
                name: 'draugen-fight',
                when: v => bones(v) === 5 && !absorbed(v) && v.state.nearbyNpcs.some(x => x.name === 'The Draugen'),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            combat,
            {
                target: 'The Draugen',
                skill: 'Attack',
                area: { x: 2695, z: 3620, radius: 80 },
                food: ['Lobster'],
                eatBelow: 0.5,
            },
            {
                name: 'draugen-fight-b',
                when: v => bones(v) === 5 && !absorbed(v) && v.state.nearbyNpcs.some(x => x.name === 'The Draugen'),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            talk,
            { continue: true },
            {
                name: 'draugen-wait',
                when: v => bones(v) === 5 && !absorbed(v) && v.state.nearbyNpcs.some(x => x.name === 'The Draugen'),
                onFail: 'continue',
                maxFails: 60,
            },
        ),
        // A hint can point across a cliff or river (the ledge south of Rellekka): go back to the west side and wait out the
        // butterfly's timer (at most 1000 ticks), after which the talisman re-spawns it somewhere else.
        phase(
            pickup,
            { area: { x: 2640, z: 3640, radius: 3 }, items: [{ item: 'Wait token' }], maxWaitSeconds: 240 },
            {
                name: 'draugen-wait-timer',
                when: v =>
                    bones(v) === 5 &&
                    !absorbed(v) &&
                    !v.state.nearbyNpcs.some(x => x.name === 'The Draugen') &&
                    near(v, 2640, 3640, 5),
                onFail: 'continue',
                maxFails: 20,
            },
        ),
        phase(
            travel,
            { to: { x: 2640, z: 3640 }, tolerance: 3 },
            {
                name: 'draugen-reset',
                when: v =>
                    bones(v) === 5 &&
                    !absorbed(v) &&
                    !v.state.nearbyNpcs.some(x => x.name === 'The Draugen') &&
                    box(v, 2660, 2705, 3575, 3614),
                maxFails: 4,
            },
        ),
        phase(
            locate,
            {
                item: "^Hunters' talisman$",
                option: '^Locate$',
                stop: 'Draugen is here',
                target: 'The Draugen',
                area: { x: 2695, z: 3620, radius: 75 },
            },
            {
                name: 'draugen-locate',
                when: v => bones(v) === 5 && !absorbed(v) && !v.state.nearbyNpcs.some(x => x.name === 'The Draugen'),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            locate,
            {
                item: "^Hunters' talisman$",
                option: '^Locate$',
                stop: 'Draugen is here',
                target: 'The Draugen',
                area: { x: 2695, z: 3620, radius: 75 },
            },
            {
                name: 'draugen-locate-b',
                when: v => bones(v) === 5 && !absorbed(v) && !v.state.nearbyNpcs.some(x => x.name === 'The Draugen'),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            locate,
            {
                item: "^Hunters' talisman$",
                option: '^Locate$',
                stop: 'Draugen is here',
                target: 'The Draugen',
                area: { x: 2695, z: 3620, radius: 75 },
            },
            {
                name: 'draugen-locate-c',
                when: v => bones(v) === 5 && !absorbed(v) && !v.state.nearbyNpcs.some(x => x.name === 'The Draugen'),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            items,
            { equip: ['Rune scimitar'] },
            { name: 'equip-scimitar', when: v => has(v, 'Rune scimitar'), maxFails: 3 },
        ),
        ...talkStep('sigli-start', 6, sigli, ['Draugen', '^Yes$'], /Take care of the talisman/i),
        tick('tick-sigmund-done', v => bones(v) === 7 && heard(v, /merchanting skills might even match my own/i)),
        // ---- Sigmund's chain, back: each NPC swaps the item for the next ----
        phase(talk, { ...sigmund }, { name: 'chain-sigmund', when: v => has(v, 'Exotic flower'), maxFails: 4 }),
        swap('chain-sailor', sailor, 'Fremennik ballad'),
        swap('chain-olaf', npcAt('^Olaf the Bard$', 2673, 3683), 'Sturdy boots'),
        swap('chain-yrsa', yrsa, 'Fiscal statement'),
        swap('chain-brundt', npcAt('^Brundt the Chieftain$', 2659, 3669), 'Hunters map'),
        swap('chain-sigli', sigli, 'Custom bow string'),
        swap('chain-skul', skul, 'Unusual fish'),
        swap('chain-fisher', fisher, 'Sea fishing map'),
        swap('chain-swensen', npcAt('^Swensen the Navigator$', 2646, 3660), 'Weather forecast'),
        swap('chain-peer', npcAt('^Peer the Seer$', 2634, 3668), "Warriors' contract"),
        swap('chain-thorvald', npcAt('^Thorvald the Warrior$', 2666, 3693), 'Champions token'),
        swap('chain-manni', npcAt('^Manni the Reveller$', 2660, 3673), 'Legendary cocktail'),
        swap('chain-thora', thora, 'Promissory note'),
        phase(
            talk,
            { ...askeladden, choices: [...MERCHANT, '^Yes$'] },
            {
                name: 'chain-askeladden',
                when: v =>
                    bones(v) === 7 &&
                    v.inv('Coins') >= 5000 &&
                    !has(v, 'Promissory note') &&
                    !has(v, 'Legendary cocktail'),
                maxFails: 4,
            },
        ),
        // ---- Sigmund's chain, forward: thirteen dialogs that leave no item (ledger 18 -> 5) ----
        ...talkStep(
            'chain-thora-ask',
            8,
            thora,
            MERCHANT,
            /nothing but a pest|exchange for some cash|reminder of a life/i,
        ),
        ...talkStep(
            'chain-manni-ask',
            9,
            npcAt('^Manni the Reveller$', 2660, 3673),
            MERCHANT,
            /5000 battles|let another drop of alcohol|give up my token/i,
        ),
        ...talkStep(
            'chain-thorvald-ask',
            10,
            npcAt('^Thorvald the Warrior$', 2666, 3693),
            MERCHANT,
            /babysit|Champions Table|Know you not who I am/i,
        ),
        ...talkStep(
            'chain-peer-ask',
            11,
            npcAt('^Peer the Seer$', 2634, 3668),
            MERCHANT,
            /divination of the weather|require a bodyguard/i,
        ),
        ...talkStep(
            'chain-swensen-ask',
            12,
            npcAt('^Swensen the Navigator$', 2646, 3660),
            MERCHANT,
            /always too busy|weather forecast from our Seer|maps secure/i,
        ),
        ...talkStep(
            'chain-fisher-ask',
            13,
            fisher,
            MERCHANT,
            /bad eating|best fishing spots that the navigator|self sufficient/i,
        ),
        ...talkStep(
            'chain-skul-ask',
            14,
            skul,
            MERCHANT,
            /weird looking fish|rumour that one of the fishermen|good trophy|got a deal|give you the bowstring/i,
        ),
        ...talkStep(
            'chain-sigli-ask',
            15,
            sigli,
            MERCHANT,
            /custom bowstring|end of my livelihood|new string for my hunting bow/i,
        ),
        ...talkStep(
            'chain-brundt-ask',
            16,
            npcAt('^Brundt the Chieftain$', 2659, 3669),
            MERCHANT,
            /reduction on sales taxes|tax break|shortfall/i,
        ),
        ...talkStep(
            'chain-yrsa-ask',
            17,
            yrsa,
            MERCHANT,
            /foolish bard|ear of the chieftain|sales tax placed|pair of sturdy boots for Olaf/i,
        ),
        ...talkStep(
            'chain-olaf-ask',
            18,
            npcAt('^Olaf the Bard$', 2673, 3683),
            MERCHANT,
            /worn out shoes|sturdy boots|wander the lands|seductively/i,
        ),
        ...talkStep('chain-sailor-ask', 19, sailor, MERCHANT, /mysterious flower|musical bone|fair deal/i),
        ...talkStep(
            'chain-sigmund-start',
            20,
            sigmund,
            ['^Yes$'],
            /insular clan|simply require a flower|extremely rare flower/i,
        ),
        // ---- Olaf's bard trial, end ----
        phase(
            talk,
            { continue: true },
            {
                name: 'olaf-after',
                when: v => bones(v) === 21 && v.state.dialog.isOpen,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        tick('tick-olaf', v => bones(v) === 21 && heard(v, /completed the Bard's Trial/i)),
        phase(
            interact,
            {
                target: 'item',
                name: '^Enchanted lyre$',
                option: '^Play$',
                expect: "completed the Bard's Trial",
                at: { x: 2658, z: 3683, tolerance: 1 },
            },
            {
                name: 'olaf-play',
                when: v => has(v, 'Enchanted lyre') && !heard(v, /completed the Bard's Trial/i),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2667, z: 3683 },
                at: { x: 2668, z: 3683, tolerance: 1 },
            },
            {
                name: 'olaf-door',
                when: v => has(v, 'Enchanted lyre') && !box(v, 2655, 2666, 3680, 3686),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            items,
            { drop: [{ item: '^Rune axe$' }, { item: '^Knife$' }, { item: '^Tinderbox$' }] },
            {
                name: 'drop-tools',
                when: v =>
                    (bones(v) <= 2 || bones(v) >= 19) &&
                    lyreAny(v) > 0 &&
                    (has(v, 'Rune axe') || has(v, 'Knife') || has(v, 'Tinderbox')),
                maxFails: 3,
            },
        ),
        // Second Seers visit: the wheel is upstairs next to the bank; the bank gives the Sigmund / Sigli ledger.
        phase(
            bank,
            {
                area: SEERS_BANK,
                deposit: [{ item: 'Bones' }],
                withdraw: [
                    { item: 'Bones', count: 21 },
                    { item: 'Rune scimitar', count: 1 },
                    { item: 'Lobster', count: 2 },
                ],
            },
            {
                name: 'bank-2',
                when: v =>
                    bones(v) === 1 &&
                    (has(v, 'Golden wool') || has(v, 'Lyre') || has(v, 'Enchanted lyre')) &&
                    lvl(v) === 0,
                maxFails: 3,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Strange altar$',
                use: { item: '^Raw shark$' },
                at: { x: 2626, z: 3597, tolerance: 2 },
            },
            { name: 'olaf-altar', when: v => has(v, 'Lyre') && has(v, 'Raw shark'), maxFails: 4 },
        ),
        phase(
            items,
            { combine: { use: '^Golden wool$', on: '^Unstrung lyre$', product: '^Lyre$' } },
            { name: 'olaf-string', when: v => has(v, 'Golden wool') && has(v, 'Unstrung lyre'), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Spinning wheel$',
                use: { item: '^Golden fleece$' },
                at: { x: 2712, z: 3471, level: 1, tolerance: 1 },
            },
            { name: 'olaf-spin', when: v => has(v, 'Golden fleece'), maxFails: 4 },
        ),
        phase(
            talk,
            { ...lalli },
            {
                name: 'olaf-fleece',
                when: v =>
                    bones(v) === 1 &&
                    veg(v) === 0 &&
                    v.inv('Pet rock') === 0 &&
                    lyreAny(v) > 0 &&
                    !has(v, 'Golden fleece') &&
                    !has(v, 'Golden wool'),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: "^Lalli's Stew$",
                use: { item: '^Pet rock$' },
                at: { x: 2771, z: 3623, tolerance: 2 },
            },
            { name: 'stew-rock', when: v => has(v, 'Pet rock') && veg(v) === 0, maxFails: 4 },
        ),
        ...['Onion', 'Potato', 'Cabbage'].map(name =>
            phase(
                interact,
                {
                    target: 'loc',
                    name: "^Lalli's Stew$",
                    use: { item: `^${name}$` },
                    at: { x: 2771, z: 3623, tolerance: 2 },
                },
                { name: `stew-${name.toLowerCase()}`, when: v => has(v, 'Pet rock') && has(v, name), maxFails: 4 },
            ),
        ),
        phase(
            talk,
            { ...askeladden },
            {
                name: 'olaf-rock',
                when: v => bones(v) === 1 && veg(v) === 3 && v.inv('Pet rock') === 0 && has(v, 'Unstrung lyre'),
                maxFails: 4,
            },
        ),
        tick('tick-olaf-lalli', v => bones(v) === 2 && heard(v, /call itself Askeladden/i)),
        phase(
            talk,
            { ...lalli, choices: ['Other human'] },
            {
                name: 'olaf-lalli',
                when: v => bones(v) === 2 && has(v, 'Unstrung lyre') && !heard(v, /call itself Askeladden/i),
                maxFails: 4,
            },
        ),
        phase(
            items,
            { combine: { use: '^Knife$', on: '^Branch$', product: '^Unstrung lyre$' } },
            { name: 'olaf-craft', when: v => has(v, 'Branch'), maxFails: 4 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Swaying tree$', option: '^Cut-branch$', at: { x: 2738, z: 3638, tolerance: 3 } },
            {
                name: 'olaf-branch',
                when: v => bones(v) === 2 && lyreAny(v) === 0 && !has(v, 'Branch') && has(v, 'Rune axe'),
                maxFails: 4,
            },
        ),
        // ---- Manni's drinking contest (cheat route) ----
        tick('tick-manni', v => bones(v) === 3 && heard(v, /completed the Revellers' trial/i)),
        phase(
            talk,
            { ...npcAt('^Manni the Reveller$', 2660, 3673), choices: ['^Yes$'] },
            {
                name: 'manni-drink',
                when: v =>
                    bones(v) === 3 &&
                    has(v, 'Keg of beer') &&
                    !has(v, 'Low alcohol keg') &&
                    !heard(v, /completed the Revellers' trial/i),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            items,
            { combine: { use: '^Low alcohol keg$', on: '^Keg of beer$' }, at: { x: 2660, z: 3677, tolerance: 1 } },
            { name: 'manni-swap', when: v => has(v, 'Keg of beer') && has(v, 'Low alcohol keg'), maxFails: 4 },
        ),
        phase(
            pickup,
            { area: { x: 2660, z: 3676, radius: 3 }, items: [{ item: 'Keg of beer', count: 1 }] },
            {
                name: 'manni-keg',
                when: v =>
                    bones(v) === 3 &&
                    has(v, 'Low alcohol keg') &&
                    !has(v, 'Keg of beer') &&
                    !has(v, 'Strange object') &&
                    !has(v, 'Lit strange object') &&
                    !has(v, 'Beer'),
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Pipe$', option: '^Put-inside$', at: { x: 2662, z: 3674, tolerance: 1 } },
            { name: 'manni-pipe', when: v => has(v, 'Lit strange object'), maxFails: 3 },
        ),
        phase(
            items,
            {
                combine: { use: '^Tinderbox$', on: '^Strange object$', product: '^Lit strange object$' },
                at: { x: 2662, z: 3674, tolerance: 1 },
            },
            { name: 'manni-light', when: v => has(v, 'Strange object') && has(v, 'Tinderbox'), maxFails: 3 },
        ),
        phase(
            interact,
            {
                target: 'npc',
                name: '^Council workman$',
                use: { item: '^Beer$' },
                at: { x: 2655, z: 3592, tolerance: 3 },
            },
            { name: 'manni-workman', when: v => has(v, 'Beer') && has(v, 'Low alcohol keg'), maxFails: 4 },
        ),
        phase(
            talk,
            {
                npc: '^Poison Salesman$',
                at: { x: 2695, z: 3495, tolerance: 3 },
                choices: ['Fremennik Trials', '^Yes$'],
            },
            {
                name: 'manni-keg-buy',
                when: v =>
                    bones(v) === 3 && v.inv('Coins') >= 250 && !has(v, 'Low alcohol keg') && !has(v, 'Keg of beer'),
                maxFails: 4,
            },
        ),
        phase(
            bank,
            {
                area: SEERS_BANK,
                depositAllExcept: [],
                withdraw: [
                    { item: 'Bones', count: 3 },
                    { item: 'Coins', count: 6000 },
                    { item: 'Tinderbox', count: 1 },
                    { item: 'Beer', count: 1 },
                    { item: 'Rune axe', count: 1 },
                    { item: 'Knife', count: 1 },
                    { item: 'Raw shark', count: 1 },
                    { item: 'Cabbage', count: 1 },
                    { item: 'Potato', count: 1 },
                    { item: 'Onion', count: 1 },
                ],
            },
            {
                name: 'bank-1',
                when: v =>
                    lead(v) === 0 &&
                    v.inv('Coins') === 0 &&
                    bones(v) === 0 &&
                    !inHouse(v, 0) &&
                    !inHouse(v, 2) &&
                    (peerDone(v) || !nearPeerDoor(v)),
                maxFails: 3,
            },
        ),

        // ---- phase 1b: Peer's riddle and house, empty-handed (the stage is told by what the pack holds) ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2636, z: 3667 },
                at: { x: 2636, z: 3665, tolerance: 1 },
            },
            { name: 'peer-exit', when: v => seerKey(v) > 0 && lvl(v) === 0, maxFails: 4 },
        ),
        phase(interact, use2('^Frozen key$', '^Cooking range$', 2629, 3663, 2630, 3663), {
            name: 'peer-melt',
            when: v => iceKey(v) > 0,
            maxFails: 4,
        }),
        phase(interact, use2('^Sealed vase$', '^Frozen table$', 2638, 3665, 2638, 3664), {
            name: 'peer-freeze',
            when: v => sealed(v) > 0,
            maxFails: 4,
        }),
        phase(
            items,
            { combine: { use: '^Vase lid$', on: '^Vase of water$' } },
            { name: 'peer-seal', when: v => lid(v) > 0 && vaseWater(v) > 0, maxFails: 4 },
        ),
        phase(interact, use2('^Vase$', '^Tap$', 2629, 3661, 2630, 3661), {
            name: 'peer-vase-water',
            when: v => vase(v) > 0 && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(interact, use2('^4/5ths full bucket$', '^Chest$', 2632, 3665, 2632, 3664), {
            name: 'peer-scales',
            when: v => bucket4(v) > 0 && !waterDone(v) && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(
            items,
            { combine: { use: '^Full bucket$', on: '^2/3rds full jug$' } },
            { name: 'peer-pour-4', when: v => fullBucket(v) > 0 && jug2(v) > 0 && !waterDone(v), maxFails: 4 },
        ),
        phase(interact, use2('^Empty bucket$', '^Tap$', 2629, 3661, 2630, 3661), {
            name: 'peer-fill-2',
            when: v => emptyBucket(v) > 0 && jug2(v) > 0 && !waterDone(v) && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(
            items,
            { combine: { use: '^2/5ths full bucket$', on: '^Empty jug$' } },
            { name: 'peer-pour-2', when: v => bucket2(v) > 0 && emptyJug(v) > 0 && !waterDone(v), maxFails: 4 },
        ),
        phase(interact, use2('^Full jug$', '^Drain$', 2629, 3662, 2630, 3662), {
            name: 'peer-drain',
            when: v => fullJug(v) > 0 && bucket2(v) > 0 && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(
            items,
            { combine: { use: '^Full bucket$', on: '^Empty jug$' } },
            { name: 'peer-pour-1', when: v => fullBucket(v) > 0 && emptyJug(v) > 0 && !waterDone(v), maxFails: 4 },
        ),
        phase(interact, use2('^Empty bucket$', '^Tap$', 2629, 3661, 2630, 3661), {
            name: 'peer-fill-1',
            when: v => emptyBucket(v) > 0 && emptyJug(v) > 0 && !waterDone(v) && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(interact, loc2('^Cupboard$', '^Search$', 2629, 3660, 2630, 3661), {
            name: 'peer-bucket-search',
            when: v => anyBucket(v) === 0 && !waterDone(v) && inHouse(v, 2) && !isClosed(v, 2629, 3660),
            onFail: 'continue',
            maxFails: 6,
        }),
        settle(
            'peer-bucket-settle',
            v =>
                anyBucket(v) === 0 &&
                !waterDone(v) &&
                inHouse(v, 2) &&
                isClosed(v, 2629, 3660) &&
                near(v, 2629, 3660, 3, 2),
        ),
        phase(interact, loc2('^Cupboard$', '^Open$', 2629, 3660, 2630, 3661), {
            name: 'peer-bucket-open',
            when: v => anyBucket(v) === 0 && !waterDone(v) && inHouse(v, 2) && isClosed(v, 2629, 3660),
            onFail: 'continue',
            maxFails: 6,
        }),
        phase(interact, loc2('^Chest$', '^Search$', 2635, 3660, 2635, 3661), {
            name: 'peer-jug-search',
            when: v => anyJug(v) === 0 && !waterDone(v) && inHouse(v, 2) && !isClosed(v, 2635, 3660),
            onFail: 'continue',
            maxFails: 6,
        }),
        settle(
            'peer-jug-settle',
            v =>
                anyJug(v) === 0 &&
                !waterDone(v) &&
                inHouse(v, 2) &&
                isClosed(v, 2635, 3660) &&
                near(v, 2635, 3660, 3, 2),
        ),
        phase(interact, loc2('^Chest$', '^Open$', 2635, 3660, 2635, 3661), {
            name: 'peer-jug-open',
            when: v => anyJug(v) === 0 && !waterDone(v) && inHouse(v, 2) && isClosed(v, 2635, 3660),
            onFail: 'continue',
            maxFails: 6,
        }),
        // Discs: unicorn eye (red), bull eye (wooden, dyed with the red goop of a cooked red herring), both into the mural.
        phase(
            items,
            { combine: { use: '^Sticky red goop$', on: '^Wooden disk$', product: '^Red disk$' } },
            { name: 'peer-dye', when: v => goop(v) > 0 && wood(v) > 0, maxFails: 4 },
        ),
        phase(interact, use2('^Red herring$', '^Cooking range$', 2629, 3663, 2630, 3663), {
            name: 'peer-cook',
            when: v => herring(v) > 0 && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(interact, loc2('^Bookcase$', '^Search$', 2634, 3665, 2634, 3664), {
            name: 'peer-herring',
            when: v =>
                wood(v) > 0 && herring(v) === 0 && goop(v) === 0 && disk(v) === 1 && !afterLid(v) && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(interact, loc2("^Bull's head$", '^Study$', 2634, 3660, 2634, 3661), {
            name: 'peer-bull',
            when: v =>
                disk(v) === 1 && wood(v) === 0 && herring(v) === 0 && goop(v) === 0 && !afterLid(v) && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(interact, loc2("^Unicorn's head$", '^Study$', 2632, 3660, 2632, 3661), {
            name: 'peer-unicorn',
            when: v => disk(v) + wood(v) + herring(v) + goop(v) === 0 && !afterLid(v) && inHouse(v, 2),
            maxFails: 4,
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Trapdoor$',
                option: '^Climb-down$',
                tile: { x: 2636, z: 3663, level: 2 },
                at: up2(2636, 3664),
            },
            { name: 'peer-down', when: v => inHouse(v, 2) && wantEast(v) && !isClosed(v, 2636, 3663), maxFails: 4 },
        ),
        settle(
            'peer-trapdoor-settle',
            v => inHouse(v, 2) && wantEast(v) && isClosed(v, 2636, 3663) && near(v, 2636, 3663, 3, 2),
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Trapdoor$',
                option: '^Open$',
                tile: { x: 2636, z: 3663, level: 2 },
                at: up2(2636, 3664),
            },
            { name: 'peer-trapdoor', when: v => inHouse(v, 2) && wantEast(v) && isClosed(v, 2636, 3663), maxFails: 4 },
        ),
        // The mural is in the wall between the rooms: only the east room (reached by the trapdoor) can use it.
        phase(
            interact,
            {
                target: 'loc',
                name: '^Abstract mural$',
                use: { item: '^Red disk$' },
                tile: { x: 2634, z: 3663 },
                at: { x: 2635, z: 3664, tolerance: 1 },
            },
            { name: 'peer-mural', when: v => east0(v) && disk(v) > 0 && lid(v) === 0, maxFails: 6 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2636, z: 3663 },
                at: { x: 2636, z: 3664, tolerance: 1 },
            },
            { name: 'peer-east-up', when: v => east0(v) && lid(v) > 0 && seerKey(v) === 0, maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2631, z: 3663 },
                at: { x: 2631, z: 3664, tolerance: 1 },
            },
            {
                name: 'peer-up',
                when: v => inHouse(v, 0) && px(v) <= 2634 && seerKey(v) === 0 && bones(v) === 0,
                maxFails: 4,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2631, z: 3667 },
                at: { x: 2631, z: 3669, tolerance: 1 },
            },
            {
                name: 'peer-enter',
                when: v =>
                    noItems(v) && nearPeerDoor(v) && lvl(v) === 0 && !peerDone(v) && heard(v, /solved the riddle/i),
                maxFails: 4,
            },
        ),
        phase(
            combolock,
            {},
            {
                name: 'peer-riddle',
                when: v =>
                    noItems(v) && nearPeerDoor(v) && lvl(v) === 0 && !peerDone(v) && !heard(v, /solved the riddle/i),
                maxFails: 4,
            },
        ),
        // ---- phase 1: Rellekka, ledger 10 bones -> 3 (then Peer's deposit empties the pack) ----
        phase(
            talk,
            { ...peer, choices: ['^Yes$', '^Yes$'] },
            { name: 'peer-start', when: v => lead(v) === 3, maxFails: 4 },
        ),
        tick1('tick-koschei', v => lead(v) === 4 && koscheiDone(v) && lvl(v) === 0),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                at: { x: 2672, z: 10099, level: 2, tolerance: 1 },
            },
            { name: 'koschei-exit', when: v => lead(v) === 4 && inArena(v) && koscheiDone(v), maxFails: 4 },
        ),
        phase(
            talk,
            { continue: true },
            {
                name: 'koschei-after',
                when: v => lead(v) === 4 && lvl(v) === 1 && v.state.dialog.isOpen,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 2667, z: 3694, level: 1, tolerance: 1 },
            },
            {
                name: 'koschei-down',
                when: v => lead(v) === 4 && lvl(v) === 1 && koscheiDone(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 2667, z: 3694, level: 1, tolerance: 1 },
            },
            {
                name: 'koschei-down-b',
                when: v => lead(v) === 4 && lvl(v) === 1 && koscheiDone(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 2667, z: 3694, level: 1, tolerance: 1 },
            },
            {
                name: 'koschei-down-c',
                when: v => lead(v) === 4 && lvl(v) === 1 && koscheiDone(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            combat,
            {
                target: 'Koschei the deathless',
                area: { x: 2671, z: 10098, radius: 25, level: 2 },
                respawnWaitTicks: 200,
                maxLevelGap: 400,
            },
            {
                name: 'koschei-last',
                when: v => lead(v) === 4 && inArena(v) && !koscheiDone(v) && prayer(v) === 0,
                maxFails: 40,
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Koschei the deathless',
                area: { x: 2671, z: 10098, radius: 25, level: 2 },
                respawnWaitTicks: 200,
                maxLevelGap: 400,
            },
            {
                name: 'koschei-last-b',
                when: v => lead(v) === 4 && inArena(v) && !koscheiDone(v) && prayer(v) === 0,
                maxFails: 40,
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Koschei the deathless',
                area: { x: 2671, z: 10098, radius: 25, level: 2 },
                respawnWaitTicks: 200,
                maxLevelGap: 400,
            },
            {
                name: 'koschei-last-c',
                when: v => lead(v) === 4 && inArena(v) && !koscheiDone(v) && prayer(v) === 0,
                maxFails: 40,
                onFail: 'continue',
            },
        ),
        phase(
            combat,
            {
                target: 'Koschei the deathless',
                area: { x: 2671, z: 10098, radius: 25, level: 2 },
                prayers: ['Protect from Melee'],
                respawnWaitTicks: 200,
                maxLevelGap: 400,
            },
            {
                name: 'koschei-fight',
                when: v => lead(v) === 4 && inArena(v) && !koscheiDone(v) && prayer(v) > 0,
                maxFails: 6,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-down$', at: { x: 2667, z: 3694, tolerance: 1 } },
            { name: 'koschei-enter', when: v => lead(v) === 4 && lvl(v) === 0 && !koscheiDone(v), maxFails: 4 },
        ),
        ...talkStep1('thorvald-start', 5, thorvald, ['^Yes$'], /recommend that you speak to the seer/i),
        tick1('tick-maze', v => lead(v) === 6 && near(v, 2649, 3661, 3) && mazeDone(v)),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-up$',
                tile: { x: 2665, z: 10037 },
                at: { x: 2665, z: 10038, tolerance: 1 },
            },
            { name: 'maze-exit', when: v => lead(v) === 6 && near(v, 2665, 10038, 3), maxFails: 4 },
        ),
        portal('maze-p7', 2666, 10029, [2668, 10026]),
        portal('maze-p6', 2656, 10037, [2653, 10035]),
        portal('maze-p5', 2630, 10023, [2630, 10028]),
        portal('maze-p4', 2665, 10018, [2667, 10015]),
        portal('maze-p3', 2656, 10004, [2651, 10004]),
        portal('maze-p2', 2639, 10015, [2642, 10017]),
        portal('maze-p1', 2631, 10002, [2631, 10004]),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                tile: { x: 2644, z: 3657 },
                at: { x: 2644, z: 3658, tolerance: 1 },
            },
            {
                name: 'maze-enter',
                when: v => lead(v) === 6 && !inMaze(v) && !(near(v, 2649, 3661, 3) && mazeDone(v)),
                maxFails: 4,
            },
        ),
        // The Navigator's house door is not one the walker opens: open it first, from the road (z >= 3663).
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                tile: { x: 2645, z: 3663 },
                at: { x: 2646, z: 3664, tolerance: 1 },
            },
            {
                name: 'swensen-door',
                onFail: 'continue',
                when: v =>
                    ((lead(v) === 7 && !heard(v, /fiendish complexity/i)) ||
                        (lead(v) === 6 && !inMaze(v) && !near(v, 2649, 3661, 3))) &&
                    lvl(v) === 0 &&
                    !(pz(v) <= 3662 && px(v) >= 2644 && px(v) <= 2651 && pz(v) >= 3657),
                maxFails: 8,
            },
        ),
        ...talkStep1('swensen-start', 7, swensen, ['^Yes$'], /fiendish complexity/i),
        ...talkStep1('olaf-start', 8, olaf, ['^Yes$'], /more music lovers/i),
        ...talkStep1('manni-start', 9, manni, ['^Yes$'], /one of us can drink no more/i),
        ...talkStep1(
            'brundt-start',
            10,
            brundt,
            ['any quests', 'Yes, I am interested', 'I want to become'],
            /support of seven of the twelve/i,
        ),
    ],
    until: v => done(v),
});

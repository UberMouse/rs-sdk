// Prince Ali Rescue (server/content/scripts/quests/quest_prince, areas/area_draynor/scripts/{ned,aggie,lady_keli,joe_guard,
// leela,prince_ali}.rs2, area_alkharid/scripts/{hassan,osman}.rs2; quest id prince, varp princequest).
// Route: Hassan (Al Kharid palace) starts it; Osman (instructions, "Okay, I better go find some things" sets stage 2);
// onions (Lumbridge field), a redberry (SE Varrock ground spawn), a pink skirt (Thessalia, 2 gp); Draynor: Ned makes a wig
// from 3 balls of wool and sells rope (15 gp), Aggie makes yellow dye (2 onions, 5 gp; used on the wig = blonde wig) and
// skin paste (redberries, pot of flour, bucket of water, ashes); Lady Keli shows her key and lets the bot touch it (soft
// clay -> Key print, only at stage 2); beers from the Port Sarim Rusty Anchor bartender; Osman takes the print and a bronze
// bar; Leela (Draynor) hands over the key and, with wig, skirt and paste held, sets the guard stage; three beers at once
// make Joe drunk (one "fancy one?" talk); rope used on Lady Keli; the key used on the Prison Door (3123,3243) teleports
// the bot in; the wig, skirt, paste and key handed to Prince Ali; Hassan pays.
// Start save lib:prince-ali-rescue-start carries what has no cheap source: 3 balls of wool, pot of flour, ashes, bucket of
// water, soft clay, bronze bar; plus 250 coins, 5 swordfish. The plan gathers onions, a redberry, the skirt, rope, beers.
// Both wigs are named "Wig" (plain id 2421, blonde id 2419). The Draynor jail guards (level 26) attack through the fence.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pick from '@conductor/tasks/pick';
import pickup from '@conductor/tasks/pickup';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'prince';
const PLAIN_WIG = 2421;
const BLONDE_WIG = 2419;
const hasId = (v: PlanView, id: number) => v.state.inventory.some(i => i.id === id);
const coins = (v: PlanView) => v.inv('Coins');
const near = (v: PlanView, c: { x: number; z: number }, r: number) => {
    const p = v.state.player;
    return !!p && p.level === 0 && Math.max(Math.abs(p.worldX - c.x), Math.abs(p.worldZ - c.z)) <= r;
};
const started = (v: PlanView) => v.quest(ID) === 'started';
const progressed = (v: PlanView) =>
    ['Wig', 'Paste', 'Pink skirt', 'Key print', 'Bronze key', 'Rope', 'Yellow dye'].some(n => v.inv(n) > 0);
const spoken = (v: PlanView) => started(v) && (v.runs('osman1') > 0 || progressed(v));
const HASSAN_AT = { x: 3302, z: 3163 };
const OSMAN_AT = { x: 3286, z: 3180 };
const LEELA_AT = { x: 3113, z: 3263 };
const endReady = (v: PlanView) => v.runs('prince') > 0 && v.inv('Paste') === 0;
const osman2Ready = (v: PlanView) =>
    v.inv('Key print') > 0 && v.inv('Beer') >= 3 && disguise(v) && v.inv('Bronze bar') > 0 && v.runs('osman2') < 3;
const leelaReady = (v: PlanView) =>
    disguise(v) &&
    v.inv('Bronze key') === 0 &&
    v.inv('Key print') === 0 &&
    v.inv('Bronze bar') === 0 &&
    v.runs('leela') < 3;
/** Blonde wig, skirt and paste held: the disguise. */
const disguise = (v: PlanView) => hasId(v, BLONDE_WIG) && v.inv('Pink skirt') > 0 && v.inv('Paste') > 0;
/** The disguise and the key. */
const kit = (v: PlanView) => disguise(v) && v.inv('Bronze key') > 0;
/** Draynor errands start once the Varrock shopping is in the pack (or already used up). */
const shopped = (v: PlanView) =>
    spoken(v) && v.inv('Pink skirt') > 0 && (v.inv('Redberries') > 0 || v.inv('Paste') > 0);
const needYellow = (v: PlanView) =>
    v.inv('Onion') < 2 && v.inv('Yellow dye') === 0 && !hasId(v, BLONDE_WIG) && v.inv('Paste') === 0;

const hassan = { npc: '^Hassan$', at: { x: 3302, z: 3163, level: 0, tolerance: 3 } };
const osman = { npc: '^Osman$', at: { x: 3286, z: 3180, level: 0, tolerance: 3 } };
const ned = { npc: '^Ned$', at: { x: 3100, z: 3258, level: 0, tolerance: 3 } };
const aggie = { npc: '^Aggie$', at: { x: 3086, z: 3259, level: 0, tolerance: 3 } };
const keli = { npc: '^Lady Keli$', at: { x: 3128, z: 3244, level: 0, tolerance: 2 } };
const joe = { npc: '^Joe$', at: { x: 3125, z: 3245, level: 0, tolerance: 2 } };
const leela = { npc: '^Leela$', at: { x: 3113, z: 3263, level: 0, tolerance: 4 } };
const JAIL_AT = { x: 3126, z: 3245 };
const guardsNear = (v: PlanView) =>
    v.state.nearbyNpcs.some(n => /^Jail guard$/i.test(n.name) && n.reachable !== false && n.distance <= 12);
const jailReady = (v: PlanView) => kit(v) && v.inv('Paste') > 0;
const keliReady = (v: PlanView) =>
    spoken(v) && v.inv('Soft clay') > 0 && v.inv('Key print') === 0 && disguise(v) && v.runs('keli-print') < 4;
const R = { onFail: 'continue', maxFails: 4 } as const;

export default definePlan({
    name: 'prince-ali-rescue',
    description:
        'Prince Ali Rescue: Hassan, Osman, onions, redberry, pink skirt, Ned wig and rope, Aggie dye and paste, Keli key print, beers, Osman, Leela key, Joe beers, rope on Keli, door, Prince Ali, Hassan.',
    requires: { ...QUEST_TAB_REQUIRED },
    until: v => v.questDone(ID),
    phases: [
        // The talk task's own walk fails at the Al Kharid toll gate (its dialog guard is off, the guard's continue pages
        // stay open), so every crossing is a travel phase first.
        phase(
            travel,
            { to: { ...HASSAN_AT, level: 0 }, tolerance: 3 },
            { name: 'to-hassan', when: v => endReady(v) && !near(v, HASSAN_AT, 10), ...R },
        ),
        phase(
            travel,
            { to: { ...LEELA_AT, level: 0 }, tolerance: 4 },
            { name: 'to-leela', when: v => leelaReady(v) && !near(v, LEELA_AT, 15), ...R },
        ),
        phase(
            travel,
            { to: { ...OSMAN_AT, level: 0 }, tolerance: 3 },
            { name: 'to-osman', when: v => osman2Ready(v) && !near(v, OSMAN_AT, 10), ...R },
        ),
        // --- the end ---
        phase(
            talk,
            { ...hassan },
            {
                name: 'hassan-end',
                when: v => endReady(v) && v.runs('hassan-end') === 0,
                ...R,
            },
        ),
        phase(
            talk,
            { ...hassan },
            {
                name: 'hassan-end-b',
                when: v => endReady(v) && v.runs('hassan-end') > 0,
                ...R,
            },
        ),
        phase(
            talk,
            { npc: '^Prince Ali$', at: { x: 3123, z: 3242, level: 0, tolerance: 2 } },
            {
                name: 'prince',
                when: v => kit(v) && v.inv('Rope') === 0 && v.runs('door') > v.runs('prince') && v.runs('prince') < 4,
                ...R,
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Prison Door$',
                use: { item: '^Bronze key$' },
                tile: { x: 3123, z: 3243 },
                at: { x: 3123, z: 3244, level: 0, tolerance: 1 },
            },
            {
                name: 'door',
                when: v =>
                    kit(v) &&
                    v.inv('Rope') === 0 &&
                    v.inv('Beer') === 0 &&
                    v.runs('door') <= v.runs('prince') &&
                    v.runs('door') < 4,
                ...R,
            },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Lady Keli$', use: { item: '^Rope$' }, at: { ...keli.at } },
            {
                name: 'rope-keli',
                when: v => kit(v) && v.inv('Rope') > 0 && v.inv('Beer') === 0 && v.runs('rope-keli') < 4,
                ...R,
            },
        ),
        // The two jail guards inside attack the bot and a hit closes Joe's dialog (and the rope's message box): kill them first.
        phase(
            combat,
            {
                target: 'Jail guard',
                skill: 'Attack',
                allowMaxed: true,
                area: { x: 3124, z: 3244, radius: 10 },
                weapon: 'Rune scimitar',
                food: ['Swordfish'],
                eatBelow: 0.5,
            },
            {
                name: 'guards',
                when: v =>
                    (keliReady(v) || jailReady(v)) && near(v, JAIL_AT, 30) && guardsNear(v) && v.runs('guards') < 10,
                until: v => !guardsNear(v),
                ...R,
            },
        ),
        phase(
            travel,
            { to: { ...JAIL_AT, level: 0 }, tolerance: 1 },
            {
                name: 'to-jail',
                when: v =>
                    (keliReady(v) || (jailReady(v) && v.inv('Beer') >= 3 && v.inv('Rope') > 0)) &&
                    !near(v, JAIL_AT, 6) &&
                    v.runs('to-jail') < 8,
                ...R,
            },
        ),
        phase(
            talk,
            { ...joe, choices: ['some beer'] },
            {
                name: 'joe',
                when: v => kit(v) && v.inv('Rope') > 0 && v.inv('Beer') >= 3 && v.runs('joe') < 4,
                ...R,
            },
        ),
        phase(
            talk,
            { ...leela },
            {
                name: 'leela',
                when: leelaReady,
                ...R,
            },
        ),
        phase(
            talk,
            { ...osman, choices: ['Thank you'] },
            {
                name: 'osman2',
                when: osman2Ready,
                ...R,
            },
        ),
        // --- Draynor / Port Sarim ---
        phase(
            talk,
            {
                npc: '^Bartender$',
                at: { x: 3045, z: 3257, level: 0, tolerance: 3 },
                choices: ['buy a beer'],
            },
            {
                name: 'beers',
                when: v =>
                    disguise(v) &&
                    coins(v) >= 2 &&
                    v.runs('beers') < 12 &&
                    v.inv('Beer') < 3 &&
                    ((v.inv('Key print') > 0 && v.inv('Bronze key') === 0) ||
                        (v.inv('Bronze key') > 0 && v.inv('Beer') > 0)),
                ...R,
            },
        ),
        phase(
            talk,
            {
                ...keli,
                choices: [
                    'famous in RuneScape',
                    'latest plan',
                    'not try to get him out',
                    'see the key',
                    'touch the key',
                ],
            },
            {
                name: 'keli-print',
                when: keliReady,
                ...R,
            },
        ),
        phase(
            items,
            {
                combine: {
                    use: { name: '^Yellow dye$' },
                    on: { name: '^Wig$', id: PLAIN_WIG },
                    product: { name: '^Wig$', id: BLONDE_WIG },
                },
            },
            { name: 'blonde', when: v => v.inv('Yellow dye') > 0 && hasId(v, PLAIN_WIG), ...R },
        ),
        phase(
            talk,
            { ...aggie, choices: ['skin paste', 'Mix me some'] },
            {
                name: 'paste',
                when: v =>
                    shopped(v) &&
                    v.inv('Redberries') > 0 &&
                    v.inv('Pot of flour') > 0 &&
                    v.inv('Ashes') > 0 &&
                    v.inv('Bucket of water') > 0 &&
                    v.inv('Paste') === 0 &&
                    v.runs('paste') < 3,
                ...R,
            },
        ),
        phase(
            talk,
            { ...aggie, choices: ['dyes for me', 'make yellow dye', 'make me some yellow dye'] },
            {
                name: 'yellow',
                when: v =>
                    shopped(v) &&
                    v.inv('Onion') >= 2 &&
                    v.inv('Yellow dye') === 0 &&
                    !hasId(v, BLONDE_WIG) &&
                    coins(v) >= 5 &&
                    v.runs('yellow') < 3,
                ...R,
            },
        ),
        phase(
            talk,
            { ...ned, choices: ['like some rope', 'sell me some rope'] },
            {
                name: 'rope',
                when: v => shopped(v) && v.inv('Rope') === 0 && coins(v) >= 15 && v.runs('rope') < 3,
                ...R,
            },
        ),
        phase(
            talk,
            { ...ned, choices: ['other things from wool', 'sort of wig', 'make me a wig'] },
            {
                name: 'wig',
                when: v =>
                    shopped(v) &&
                    v.inv('Ball of wool') >= 3 &&
                    !hasId(v, PLAIN_WIG) &&
                    !hasId(v, BLONDE_WIG) &&
                    v.runs('wig') < 3,
                ...R,
            },
        ),
        // --- the shopping leg ---
        phase(
            travel,
            { to: { x: 3092, z: 3268, level: 0 }, tolerance: 6 },
            {
                name: 'to-draynor',
                when: v =>
                    spoken(v) &&
                    v.inv('Pink skirt') > 0 &&
                    (v.inv('Redberries') > 0 || v.inv('Paste') > 0) &&
                    ((v.state.player?.worldZ ?? 0) > 3300 || (v.state.player?.worldX ?? 0) > 3140) &&
                    v.inv('Bronze key') === 0 &&
                    !near(v, { x: 3286, z: 3180 }, 30),
                ...R,
            },
        ),
        phase(
            shop,
            { npc: 'Thessalia', at: { x: 3204, z: 3417 }, buy: [{ item: 'Pink skirt', count: 1 }] },
            {
                name: 'skirt',
                when: v =>
                    spoken(v) &&
                    v.inv('Pink skirt') === 0 &&
                    (v.inv('Redberries') > 0 || v.inv('Paste') > 0) &&
                    !needYellow(v) &&
                    coins(v) >= 2 &&
                    v.runs('skirt') < 3,
                ...R,
            },
        ),
        phase(
            pickup,
            { area: { x: 3272, z: 3370, radius: 10 }, items: [{ item: 'Redberries', count: 1 }] },
            {
                name: 'berries',
                when: v =>
                    spoken(v) &&
                    v.inv('Redberries') === 0 &&
                    v.inv('Paste') === 0 &&
                    !needYellow(v) &&
                    near(v, { x: 3272, z: 3370 }, 14),
            },
        ),
        phase(
            travel,
            { to: { x: 3268, z: 3364, level: 0 }, tolerance: 4, waypoints: [{ x: 3260, z: 3335 }] },
            {
                name: 'to-berries',
                when: v =>
                    spoken(v) &&
                    v.inv('Redberries') === 0 &&
                    v.inv('Paste') === 0 &&
                    !needYellow(v) &&
                    !near(v, { x: 3272, z: 3370 }, 14),
            },
        ),
        phase(
            pick,
            { loc: 'Onion', item: 'Onion', count: 2, area: { x: 3190, z: 3267, radius: 8 } },
            { name: 'onions', when: v => spoken(v) && needYellow(v) },
        ),
        phase(
            talk,
            { ...osman, choices: ['first thing', 'better go find'] },
            { name: 'osman1', when: v => started(v) && v.runs('osman1') === 0 && !progressed(v), ...R },
        ),
        phase(
            talk,
            { ...hassan, choices: ['Can I help you'] },
            { name: 'hassan-start', when: v => v.quest(ID) === 'none' && v.runs('hassan-start') < 3, ...R },
        ),
    ],
});

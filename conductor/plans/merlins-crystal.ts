// Merlin's Crystal (quest id arthur; wiki/quests/merlins-crystal.md): Arthur, Gawain, Lancelot, the Catherby crate to
// Keep Le Faye, Mordred -> Morgan, crate back, Chaos altar words (Wilderness, opted in for that step only), wax from a
// beehive -> black candle -> lit, bat bones, Lady of the Lake + beggar (bread) for Excalibur, bones dropped on the
// Camelot magic symbol (Thrantax chant), Excalibur on the Giant crystal, Arthur.
// The quest tab shows none/started/done only, so phases ride on markers:
//   * Insect repellent held, Bucket of wax, Black candle, Lit black candle or Excalibur = stage 4+ (the repellent is
//     picked right after Morgan's talk, so it is the "Morgan done" marker; it is never used up).
//   * Lit candle + Excalibur + no Bat bones = the summon is done (the bones are dropped on the floor away from the
//     symbol after the chant, so the "bones held" state means not yet bound).
//   * Dialog history (10 pages) tells the talk-only stages and the altar words apart inside one run; after a restart
//     those steps are repeated, which is harmless.
// Needs: melee gear (combat ~50), lobsters (the Wilderness altar phases need 3, via minFood), a Bread, a Tinderbox, a Bucket, a crush weapon.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'arthur';
const FOOD = ['Swordfish', 'Lobster'];

const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const box = (v: PlanView, x0: number, x1: number, z0: number, z1: number) =>
    px(v) >= x0 && px(v) <= x1 && pz(v) >= z0 && pz(v) <= z1;
const seen = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const dlg = (v: PlanView) => v.state.dialog.isOpen;

const started = (v: PlanView) => v.quest(ID) !== 'none';
const done = (v: PlanView) => v.questDone(ID);
const repel = (v: PlanView) => v.inv('Insect repellent');
const bucket = (v: PlanView) => v.inv('Bucket');
const wax = (v: PlanView) => v.inv('Bucket of wax');
const candle = (v: PlanView) => v.inv('Black candle');
const lit = (v: PlanView) => v.inv('Lit black candle');
const bones = (v: PlanView) => v.inv('Bat bones');
const exc = (v: PlanView) => v.inv('Excalibur');

const gawainDone = (v: PlanView) => seen(v, /guarded by some renegade knights/i);
const lancelotDone = (v: PlanView) => seen(v, /deliveries by boat|sea entrance/i);
const morganSeen = (v: PlanView) => seen(v, /Setting him free won't be easy|will go do all that/i);
const altarSeen = (v: PlanView) => seen(v, /small inscription|It reads: 'Snarthon/i);
const askedSeen = (v: PlanView) => seen(v, /bad luck to make black candles|FULL of wax|Nope, not yet|any wax yet/i);
const ladySeen = (v: PlanView) => seen(v, /set a test for you|upstairs room of the jeweller/i);
const boundSeen = (v: PlanView) => seen(v, /The deed is done/i);
const freedSeen = (v: PlanView) => seen(v, /set Merlin free|already freed Merlin/i);

const s4 = (v: PlanView) => repel(v) + wax(v) + candle(v) + lit(v) + exc(v) > 0 || morganSeen(v);
const inKeep = (v: PlanView) => box(v, 2763, 2790, 3395, 3412);
const atCatherbyCrate = (v: PlanView) => box(v, 2795, 2810, 3436, 3446);
const atJeweller = (v: PlanView) => box(v, 3008, 3024, 3238, 3252);
const inWild = (v: PlanView) => pz(v) >= 3520 && px(v) >= 2944;
const nearAltar = (v: PlanView) => box(v, 3230, 3250, 3598, 3615);

// Catherby side: the repellent is known stage 4+, the wax chain has not produced a candle yet.
const waxChain = (v: PlanView) => repel(v) > 0 && wax(v) + candle(v) + lit(v) + exc(v) === 0;
const needAltar = (v: PlanView) => waxChain(v) && askedSeen(v) && !altarSeen(v);
const summonReady = (v: PlanView) => lit(v) > 0 && bones(v) > 0 && exc(v) > 0;

const crateIn = { target: 'loc' as const, name: '^Crate$', option: '^Hide-in$', at: { x: 2801, z: 3443, level: 0 } };
const arthur = { npc: '^King Arthur$', at: { x: 2764, z: 3515, level: 0, tolerance: 3 } };
const candleMaker = { npc: '^Candle maker$', at: { x: 2800, z: 3439, tolerance: 2 } };
const symbol = { x: 2780, z: 3515, tolerance: 1 };

export default definePlan({
    name: 'merlins-crystal',
    description:
        "Merlin's Crystal: Arthur, Gawain, Lancelot, crate to Keep Le Faye, Mordred/Morgan, crate back, Chaos altar words, wax -> black candle, bat bones, Excalibur via the Lady and the beggar, Thrantax chant, crystal, Arthur.",
    requires: {
        ...QUEST_TAB_REQUIRED,
        'Bread, Tinderbox and Bucket unless Excalibur or the candle chain is under way': v =>
            done(v) ||
            exc(v) + lit(v) + candle(v) + wax(v) > 0 ||
            (v.inv('Bread') > 0 && v.inv('Tinderbox') > 0 && bucket(v) > 0),
    },
    until: v => done(v),
    phases: [
        // --- open dialogs left by interact / combat, answered first ---
        phase(
            talk,
            { continue: true },
            { name: 'hive-dialog', when: v => dlg(v) && box(v, 2750, 2766, 3436, 3450), maxFails: 4 },
        ),
        phase(
            talk,
            { continue: true, choices: ['^Yes\\.$', '^Yes\\.$'] },
            {
                name: 'crate-dialog',
                when: v => dlg(v) && (atCatherbyCrate(v) || (inKeep(v) && lvl(v) < 2)),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { continue: true, choices: ['untrap Merlin', 'OK I will go do all that'] },
            {
                name: 'morgan',
                when: v => dlg(v) && inKeep(v) && lvl(v) === 2,
                maxFails: 4,
            },
        ),
        phase(
            talk,
            { continue: true, choices: ['Yes certainly'] },
            {
                name: 'beggar-talk',
                when: v => dlg(v) && atJeweller(v),
                maxFails: 4,
            },
        ),

        // --- finish ---
        phase(talk, arthur, { name: 'arthur-finish', when: v => started(v) && freedSeen(v), maxFails: 4 }),
        phase(
            talk,
            {
                use: { items: ['^Excalibur$'], onLoc: '^Giant crystal$' },
                at: { x: 2766, z: 3491, level: 2, tolerance: 1 },
            },
            { name: 'crystal', when: v => lit(v) > 0 && exc(v) > 0 && bones(v) === 0 && !freedSeen(v), maxFails: 4 },
        ),
        phase(
            items,
            { drop: [{ item: '^Bat bones$' }], at: { x: 2772, z: 3511, tolerance: 1 } },
            { name: 'bones-away', when: v => summonReady(v) && boundSeen(v), maxFails: 4 },
        ),
        phase(
            items,
            { drop: [{ item: '^Bat bones$' }], at: symbol, choices: ['^Snarthon Candtrick Termanto$'] },
            { name: 'summon', when: v => summonReady(v) && !boundSeen(v), maxFails: 4 },
        ),

        // --- Excalibur ---
        phase(
            interact,
            {
                target: 'loc',
                name: '^Door$',
                option: '^Open$',
                choices: ['Yes certainly'],
                at: { x: 3017, z: 3246, tolerance: 1 },
            },
            {
                name: 'beggar-door',
                onFail: 'continue',
                when: v => lit(v) > 0 && bones(v) > 0 && exc(v) === 0 && ladySeen(v) && !dlg(v),
                maxFails: 4,
            },
        ),
        phase(
            talk,
            {
                npc: 'Lady of the Lake',
                at: { x: 2924, z: 3405, tolerance: 3 },
                choices: ['I seek the sword Excalibur'],
            },
            { name: 'lady', when: v => lit(v) > 0 && bones(v) > 0 && exc(v) === 0 && !ladySeen(v), maxFails: 4 },
        ),
        phase(
            combat,
            {
                target: 'Giant bat',
                area: { x: 2752, z: 3403, radius: 8 },
                loot: ['Bat bones'],
                food: FOOD,
                respawnWaitTicks: 100,
            },
            {
                name: 'bats',
                when: v => lit(v) > 0 && bones(v) === 0 && exc(v) === 0,
                until: v => bones(v) > 0,
                maxFails: 6,
            },
        ),

        // --- candle chain ---
        phase(
            items,
            { combine: { use: '^Tinderbox$', on: '^Black candle$', product: '^Lit black candle$' } },
            { name: 'light', when: v => candle(v) > 0 && lit(v) === 0, maxFails: 4 },
        ),
        phase(talk, candleMaker, { name: 'candle-wax', when: v => wax(v) > 0, maxFails: 4 }),
        phase(
            talk,
            {
                use: { items: ['^Insect repellent$', '^Bucket$'], onLoc: '^Beehive$' },
                at: { x: 2758, z: 3444, tolerance: 2 },
            },
            {
                name: 'hive',
                onFail: 'continue',
                when: v => waxChain(v) && bucket(v) > 0 && altarSeen(v) && !inWild(v),
                maxFails: 4,
            },
        ),

        // --- Chaos altar words (Wilderness, opted in for this step only) ---
        phase(
            travel,
            { to: { x: 3213, z: 3475 }, tolerance: 3, wilderness: true, minFood: 3 },
            { name: 'altar-leave', when: v => inWild(v) && (altarSeen(v) || !needAltar(v)), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Chaos altar$',
                option: '^Check$',
                at: { x: 3239, z: 3606, tolerance: 2 },
                wilderness: true,
                minFood: 3,
            },
            { name: 'altar-check', when: v => needAltar(v) && nearAltar(v), maxFails: 3 },
        ),
        phase(
            travel,
            { to: { x: 3239, z: 3606 }, tolerance: 2, wilderness: true, minFood: 3 },
            { name: 'altar-go', when: v => needAltar(v) && !nearAltar(v), maxFails: 3 },
        ),
        phase(
            talk,
            { ...candleMaker, choices: ['black candles'] },
            {
                name: 'candle-ask',
                when: v => waxChain(v) && !askedSeen(v),
                maxFails: 4,
            },
        ),

        // --- Catherby: repellent, right after Morgan (the stage 4 marker) ---
        phase(
            pickup,
            { area: { x: 2807, z: 3450, radius: 2 }, items: [{ item: 'Insect repellent', count: 1 }] },
            {
                name: 'repellent',
                when: v =>
                    started(v) &&
                    repel(v) === 0 &&
                    wax(v) + candle(v) + lit(v) + exc(v) === 0 &&
                    !inKeep(v) &&
                    morganSeen(v),
                maxFails: 4,
            },
        ),

        // --- Keep Le Faye ---
        // Mordred (healed, still hostile) and the knights keep hitting after Morgan's talk: leave under attack.
        phase(
            travel,
            { to: { x: 2802, z: 3440, level: 0 }, tolerance: 3, flee: true },
            {
                name: 'keep-flee',
                when: v => inKeep(v) && morganSeen(v) && !dlg(v) && v.state.player?.combat.inCombat === true,
                maxFails: 4,
            },
        ),
        // The exit crate sits on a bridge tile the client lists no locs for; the front door opens from inside.
        phase(
            travel,
            { to: { x: 2802, z: 3440, level: 0 }, tolerance: 3 },
            { name: 'keep-out', when: v => inKeep(v) && morganSeen(v) && !dlg(v), maxFails: 4 },
        ),
        phase(
            combat,
            {
                target: 'Sir Mordred',
                area: { x: 2769, z: 3403, level: 2, radius: 3 },
                food: FOOD,
                stopOnDialog: true,
                // Eat early: a low-HP meal when the scene opens closes Morgan's choice dialog.
                eatBelow: 0.85,
                respawnWaitTicks: 100,
            },
            { name: 'mordred', when: v => inKeep(v) && !morganSeen(v) && !s4(v), maxFails: 4 },
        ),

        // --- Camelot: Arthur, Gawain, Lancelot, then the crate ---
        // A walk planned from Lancelot's floor finds no route to Catherby: step down to the courtyard first.
        phase(
            travel,
            { to: { x: 2762, z: 3508, level: 0 }, tolerance: 2 },
            {
                name: 'leave-floor',
                when: v => started(v) && !s4(v) && lancelotDone(v) && lvl(v) > 0 && !inKeep(v),
                maxFails: 4,
            },
        ),
        phase(interact, crateIn, {
            name: 'crate-in',
            when: v => started(v) && !s4(v) && lancelotDone(v) && !inKeep(v) && !dlg(v),
            maxFails: 4,
        }),
        phase(
            talk,
            {
                npc: '^Sir Lancelot$',
                at: { x: 2759, z: 3515, level: 1, tolerance: 2 },
                choices: ['get into Morgan Le Faye'],
            },
            { name: 'lancelot', when: v => started(v) && !s4(v) && gawainDone(v) && !lancelotDone(v), maxFails: 4 },
        ),
        phase(
            talk,
            {
                npc: '^Sir Gawain$',
                at: { x: 2763, z: 3506, tolerance: 2 },
                choices: ['how Merlin got trapped', 'Thank you for the information'],
            },
            { name: 'gawain', when: v => started(v) && !s4(v) && !gawainDone(v) && !lancelotDone(v), maxFails: 4 },
        ),
        phase(
            talk,
            { ...arthur, choices: ['Knight of the Round Table'] },
            {
                name: 'arthur-start',
                when: v => !started(v),
                maxFails: 4,
            },
        ),
    ],
});

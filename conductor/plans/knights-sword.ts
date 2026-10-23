// The Knight's Sword (quest id squire; server/content/scripts/quests/quest_squire/scripts/quest_squire.rs2).
// Chain: Squire (start) -> Reldo (Imcando) -> Thurgo (redberry pie) -> blurite ore (Asgarnian Ice Dungeon, ladder at
// Mudskipper Point) -> Thurgo (asks for a picture) -> Squire (stage 5) -> Sir Vyvin's cupboard (portrait; refused while
// Vyvin stands within 1 tile) -> Thurgo (portrait) -> Thurgo (blurite + 2 iron bars: sword) -> Squire (takes the sword).
// The quest tab shows no stage, so the stage rides on items and place. Talks that change no item (Thurgo's "what sword?",
// the Squire's report) are told apart by place (nearLadder = arrived from the dungeon, not yet in the hut) and by the
// iron bars: they are banked until the portrait is in hand, so "blurite, bars held, no portrait" means the portrait was
// handed over and Thurgo is next. Start: 2 iron bars and a redberry pie in the pack or the bank, a pickaxe, Mining 10.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import bank from '@conductor/tasks/bank';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'squire';
const squire = { npc: '^Squire$', at: { x: 2977, z: 3342, level: 0, tolerance: 3 } };
const reldo = { npc: '^Reldo$', at: { x: 3210, z: 3494, tolerance: 3 } };
const thurgo = { npc: '^Thurgo$', at: { x: 3001, z: 3144, level: 0, tolerance: 2 } };
const FALADOR_BANK = { x: 3013, z: 3355, radius: 4 };
const CUPBOARD = { x: 2984, z: 3336, level: 2 };

const pos = (v: PlanView) => v.state.player;
const near = (v: PlanView, x: number, z: number, r: number, level = 0) => {
    const p = pos(v);
    return !!p && p.level === level && Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - z)) <= r;
};
const inDungeon = (v: PlanView) => {
    const p = pos(v);
    return !!p && p.worldZ > 9000 && p.worldX >= 2980 && p.worldX <= 3090;
};
const nearReldo = (v: PlanView) => near(v, 3209, 3495, 14);
const atSquire = (v: PlanView) => near(v, 2977, 3342, 8) || near(v, 2984, 3336, 8, 2);
// Arrived from the dungeon ladder (3009,3150), east of the hut (walls x 2999..3002).
const nearLadder = (v: PlanView) => {
    const p = pos(v);
    return !!p && p.level === 0 && p.worldX >= 3005 && p.worldX <= 3016 && p.worldZ >= 3145 && p.worldZ <= 3156;
};
const started = (v: PlanView) => v.quest(ID) === 'started';
const blurite = (v: PlanView) => v.inv('Blurite ore') > 0;
const portrait = (v: PlanView) => v.inv('Portrait') > 0;
const sword = (v: PlanView) => v.inv('Blurite sword') > 0;
const bars = (v: PlanView) => v.inv('Iron bar');
// Mid-quest, blurite ore in hand, portrait not (yet): the Squire/cupboard/Thurgo-ask leg.
const midLeg = (v: PlanView) => started(v) && blurite(v) && v.inv('Redberry pie') === 0 && !portrait(v) && bars(v) < 2;

export default definePlan({
    name: 'knights-sword',
    description:
        "The Knight's Sword: Squire, Reldo, Thurgo (pie), blurite ore in the Asgarnian Ice Dungeon, Thurgo, Squire, Sir Vyvin's cupboard portrait, Thurgo (portrait, sword), Squire.",
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        phase(talk, { ...squire }, { name: 'squire-finish', when: v => sword(v) && started(v), maxFails: 8 }),
        // Attacked in the dungeon: a flee travel may start in combat (no other task does); it only reaches the ladder foot,
        // the climb is the next phase once the fight is over.
        phase(
            travel,
            { to: { x: 3009, z: 9551, level: 0 }, tolerance: 1, flee: true },
            {
                name: 'flee-to-ladder',
                when: v => inDungeon(v) && v.state.player?.combat.inCombat === true,
                maxFails: 5,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Ladder$', option: '^Climb-up$', at: { x: 3009, z: 9550, tolerance: 1 } },
            { name: 'exit-dungeon', when: v => inDungeon(v) && blurite(v), maxFails: 5 },
        ),
        phase(
            talk,
            { ...thurgo },
            {
                name: 'thurgo-sword',
                when: v => started(v) && blurite(v) && bars(v) >= 2 && !portrait(v),
                maxFails: 8,
            },
        ),
        phase(
            talk,
            { ...thurgo },
            { name: 'thurgo-portrait', when: v => started(v) && portrait(v) && bars(v) >= 2, maxFails: 8 },
        ),
        phase(
            travel,
            { to: { x: 2977, z: 3342, level: 0 }, tolerance: 3 },
            {
                name: 'castle-down',
                when: v => started(v) && portrait(v) && bars(v) < 2 && (pos(v)?.level ?? 0) !== 0,
                maxFails: 4,
            },
        ),
        phase(
            bank,
            { area: FALADOR_BANK, withdraw: [{ item: 'Iron bar', count: 2 }] },
            { name: 'bars-withdraw', when: v => started(v) && portrait(v) && bars(v) < 2 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cupboard$', option: '^Search$', at: { ...CUPBOARD, tolerance: 2 } },
            { name: 'cupboard-search', when: v => midLeg(v) && atSquire(v), onFail: 'continue', maxFails: 12 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Cupboard$', option: '^Open$', at: { ...CUPBOARD, tolerance: 2 } },
            { name: 'cupboard-open', when: v => midLeg(v) && atSquire(v), onFail: 'continue', maxFails: 12 },
        ),
        phase(
            talk,
            { ...thurgo },
            {
                name: 'thurgo-ask',
                when: v => midLeg(v) && nearLadder(v),
                maxFails: 8,
            },
        ),
        phase(talk, { ...squire }, { name: 'squire-report', when: v => midLeg(v) && !inDungeon(v), maxFails: 8 }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks blurite ore$',
                option: '^Mine$',
                expect: 'manage to mine',
                tile: { x: 3049, z: 9566 },
                at: { x: 3049, z: 9567, level: 0, tolerance: 1 },
            },
            {
                name: 'mine-blurite',
                when: v => started(v) && !blurite(v) && v.inv('Redberry pie') === 0 && inDungeon(v) && !portrait(v),
                maxFails: 10,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^(Lobster|Swordfish|Salmon)$', option: '^Eat$' },
            {
                name: 'eat-before-descent',
                when: v =>
                    started(v) &&
                    !blurite(v) &&
                    !inDungeon(v) &&
                    v.inv('Redberry pie') === 0 &&
                    v.hp.current < v.hp.max - 12 &&
                    v.inv(/^(Lobster|Swordfish|Salmon)$/) > 0,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Ladder$',
                option: '^Climb-down$',
                at: { x: 3009, z: 3150, level: 0, tolerance: 1 },
            },
            {
                name: 'enter-dungeon',
                when: v =>
                    started(v) &&
                    !blurite(v) &&
                    v.inv('Redberry pie') === 0 &&
                    !inDungeon(v) &&
                    !portrait(v) &&
                    bars(v) < 2,
                maxFails: 5,
            },
        ),
        phase(
            bank,
            { area: FALADOR_BANK, deposit: [{ item: 'Iron bar' }] },
            { name: 'stash-bars', when: v => started(v) && bars(v) >= 2 && !blurite(v) && !portrait(v) },
        ),
        phase(
            talk,
            { ...thurgo, choices: ['redberry pie'] },
            { name: 'thurgo-pie', when: v => started(v) && v.inv('Redberry pie') > 0 && nearReldo(v), maxFails: 8 },
        ),
        phase(
            talk,
            { ...reldo, choices: ['Imcando'] },
            { name: 'reldo', when: v => started(v) && v.inv('Redberry pie') > 0 && !nearReldo(v), maxFails: 8 },
        ),
        phase(
            talk,
            { ...squire, choices: ['life as a squire', 'make a new sword', 'would these dwarves', 'give it a go'] },
            { name: 'squire-start', when: v => v.quest(ID) === 'none' },
        ),
    ],
    until: v => v.questDone(ID),
});

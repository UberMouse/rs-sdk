// Nature Spirit (server scripts: quests/quest_druidspirit/scripts/*.rs2, areas/area_mausoleum/scripts/drezel.rs2,
// skill_crafting/scripts/jewellery/jewellery.rs2). Needs Priest in Peril at stage 61 (one more Drezel talk after the
// quest), the Wolfbane dagger held, a Ghostspeak amulet worn, Crafting 18, a Silver bar, ~10 gp and melee gear + food.
//   * Al Kharid: Sickle mould (Dommik, 10 gp), Silver bar on the furnace -> Silver sickle.
//   * Drezel (Paterdomus dungeon): "anything else interesting" starts it (stage 5; 3 meat + 3 apple pies).
//   * Holy barrier -> Mort Myre gate (3443,3458, open once started) -> south bank (3441,3328) -> the stepping stones
//     "Bridge" Jump onto Filliman's island (agility roll, a failure drops into the water for 2-7 HP and back).
//   * Island (3440,3337 grotto door): Washing bowl (3437,3337) -> Mirror, Search the Grotto tree -> Journal, the door
//     summons Filliman (ghost talk -> 20, Mirror -> 25, Journal -> 30, "How can I help" -> Druidic spell, 35).
//   * Drezel blesses (40) -> cast the spell beside rotting logs (3439,3348) -> Pick the Fungi on log (50, the bloom lasts
//     25 ticks) -> back on the island: fungi on the nature Stone (3439,3336), the used spell on the spirit Stone
//     (3441,3336), stand on the faith Stone (3440,3335) and tell Filliman "I've solved the puzzle" (60).
//   * Grotto door Enter -> underground grotto (3441,9740): Filliman becomes the Nature Spirit (70), the sickle is
//     blessed (75) and a Druid pouch given. Cast Bloom with the blessed sickle in the swamp, pick 3 plants, Fill the
//     pouch; an invisible Ghast that attacks uses a charge and turns visible; kill 3 (the ghast-3 line), then the
//     Nature Spirit again for the reward.
// Stages are read from held items, position, nearby locs/NPCs and dialog/message history (the quest tab shows only
// none/started/done). Walk tokens: priestperil >= 4/5/6/8 for the temple, druidspirit >= 1 for the Mort Myre gate.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import interact from '@conductor/tasks/interact';
import items from '@conductor/tasks/items';
import pickup from '@conductor/tasks/pickup';
import shop from '@conductor/tasks/shop';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'druidspirit';
const PP = ['quest:priestperil>=4', 'quest:priestperil>=5', 'quest:priestperil>=6', 'quest:priestperil>=8'];
const SWAMP = ['quest:druidspirit>=1'];
const MET = [...PP, ...SWAMP];
const FOOD = ['Swordfish', 'Meat pie', 'Apple pie'];

const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const near = (v: PlanView, x: number, z: number, r: number) =>
    lvl(v) === 0 && Math.abs(px(v) - x) <= r && Math.abs(pz(v) - z) <= r;
const dungeon = (v: PlanView) => pz(v) > 9800; // Drezel's mausoleum dungeon
const inGrotto = (v: PlanView) => px(v) >= 3425 && px(v) <= 3460 && pz(v) >= 9728 && pz(v) <= 9765;
const onIsland = (v: PlanView) => lvl(v) === 0 && px(v) >= 3434 && px(v) <= 3446 && pz(v) >= 3330 && pz(v) <= 3344;
const southBank = (v: PlanView) => lvl(v) === 0 && px(v) >= 3430 && px(v) <= 3452 && pz(v) >= 3316 && pz(v) <= 3329;
const atLogs = (v: PlanView) => near(v, 3440, 3349, 5);

// A choice menu (as against continue pages) is open.
const menuOpen = (v: PlanView) =>
    v.state.dialog.isOpen && v.state.dialog.options.some(o => !/click here to continue/i.test(o.text));
const started = (v: PlanView) => v.quest(ID) === 'started';
const none = (v: PlanView) => v.quest(ID) === 'none';
const dialogs = (v: PlanView, re: RegExp) => v.state.recentDialogs.some(d => d.text.some(t => re.test(t)));
const messages = (v: PlanView, re: RegExp) => v.state.gameMessages.some(m => re.test(m.text));
const filliman = (v: PlanView) => v.state.nearbyNpcs.some(n => /^Filliman Tarlock$/.test(n.name));
const locNear = (v: PlanView, name: RegExp) => v.state.nearbyLocs.some(l => name.test(l.name));

const sickle = (v: PlanView) => v.inv('Silver sickle');
const blessed = (v: PlanView) => v.inv('Silver sickle(b)');
const anySickle = (v: PlanView) => sickle(v) + blessed(v);
const mirror = (v: PlanView) => v.inv('Mirror');
const journal = (v: PlanView) => v.inv('Journal');
const spell = (v: PlanView) => v.inv('Druidic spell');
const used = (v: PlanView) => v.inv('A used spell');
const fungi = (v: PlanView) => v.inv('Mort myre fungi');
const plants = (v: PlanView) => fungi(v) + v.inv('Mort myre stem') + v.inv('Mort myre pear');
const pouch = (v: PlanView) => v.inv('Druid pouch');
// A filled pouch holds one charge per point (3-9); an empty one is a single item of the same name.
const pouchFilled = (v: PlanView) => pouch(v) >= 2 || (pouch(v) === 1 && messages(v, /two Ghasts/i));
// Ghasts walk unseen: listed by name without a level or an Attack option until the pouch makes one visible.
const ghastNear = (v: PlanView) => v.state.nearbyNpcs.some(n => n.name === 'Ghast' && n.reachable !== false);
const ghastVisible = (v: PlanView) =>
    v.state.nearbyNpcs.some(n => n.name === 'Ghast' && n.options.some(o => /^attack$/i.test(o)));
const allThree = (v: PlanView) => messages(v, /all three Ghasts/i);
// The latest spell message says the bloom took ("There is no suitable material" means nothing grew and the spell is kept).
const castOk = (v: PlanView) =>
    /cast the spell in the swamp/i.test(
        v.state.gameMessages.filter(m => /cast the spell in the swamp|no suitable material/i.test(m.text)).at(-1)
            ?.text ?? '',
    );
const settling = (v: PlanView) =>
    castOk(v) &&
    atLogs(v) &&
    spell(v) + used(v) > 0 &&
    fungi(v) === 0 &&
    !locNear(v, /^Fungi on log$/) &&
    blessed(v) === 0;
// After a Cast Bloom with the sickle the plants are listed 1-2 ticks later: walk, do not cast again on that view.
const sickleSettle = (v: PlanView) => v.last?.phase === 'cast-sickle' && v.last.status === 'done' && atLogs(v);
const blessEv = (v: PlanView) =>
    dialogs(
        v,
        /prepare yourself for the blessings|you.re now blessed|since you got blessed|something of the faith about you/i,
    );
// Filliman's ghost talk, the mirror and the journal leave these lines in the dialog history.
const ev1 = (v: PlanView) => dialogs(v, /Don.t be silly|preposterous|pull one over|reflects the truth/i);
const ev2 = (v: PlanView) => dialogs(v, /most peculiar thing|dysfunctional|where did I put my journal/i);
const ritualEv = (v: PlanView) =>
    dialogs(v, /everything seems to be in place|come through now into the grotto|come down into the grotto/i);
// No journal, spell, used spell or fungus: before the journal is found or after the stones are set.
const bare = (v: PlanView) => journal(v) + spell(v) + used(v) + fungi(v) === 0;

// Where the bot has to be: on Filliman's island, or out in the swamp / at Drezel.
const needIsland = (v: PlanView) =>
    started(v) &&
    (blessed(v) > 0
        ? allThree(v)
        : mirror(v) === 0 || journal(v) > 0 || (bare(v) && mirror(v) > 0) || (fungi(v) > 0 && used(v) > 0));
const needOut = (v: PlanView) => started(v) && !needIsland(v);

const drezel = { npc: '^Drezel$', at: { x: 3438, z: 9895, tolerance: 3, met: MET } };
const door = { target: 'loc' as const, name: '^Grotto$', option: '^Enter$', at: { x: 3440, z: 3336, tolerance: 1 } };
const stone = (x: number, z: number, item: string) => ({
    target: 'loc' as const,
    name: '^Stone$',
    tile: { x, z },
    use: { item },
    at: { x: 3440, z: 3334, tolerance: 2 },
});
const barrier = {
    target: 'loc' as const,
    name: '^Holy barrier$',
    option: '^Pass-through$',
    expect: 'pass through the holy barrier',
    at: { x: 3440, z: 9889, tolerance: 2 },
};
const grottoLoc = { target: 'loc' as const, name: '^Grotto$', at: { x: 3441, z: 9738, level: 0, tolerance: 2 } };

export default definePlan({
    name: 'nature-spirit',
    description:
        'Nature Spirit to done: sickle (Al Kharid mould + furnace), Drezel, Mort Myre, Filliman (mirror, journal, spell), blessing, fungus ritual, grotto, blessed sickle, pouch, 3 ghasts.',
    requires: {
        ...QUEST_TAB_REQUIRED,
        'Priest in Peril done (Wolfbane held)': v =>
            v.questDone('priestperil') &&
            v.inv('Wolfbane') + v.state.equipment.filter(e => /wolfbane/i.test(e.name)).length > 0,
        'Ghostspeak amulet worn': v => v.state.equipment.some(e => /ghostspeak/i.test(e.name)),
    },
    phases: [
        // A menu the guard declined stays open (the Nature Spirit's sickle questions): "Ok thanks" closes it.
        phase(
            talk,
            { continue: true, choices: ['^Ok,? thanks'] },
            { name: 'menu', when: v => menuOpen(v), onFail: 'continue' },
        ),
        phase(
            talk,
            { continue: true },
            { name: 'dialog', when: v => v.state.dialog.isOpen && !menuOpen(v), onFail: 'continue' },
        ),
        // Inventory slots run short: the bowl (the Mirror is under it), emptied pie dishes and rotten food are junk.
        phase(
            items,
            { drop: [{ item: '^Washing bowl$' }] },
            { name: 'junk-bowl', when: v => v.inv('Washing bowl') > 0 && mirror(v) > 0, onFail: 'continue' },
        ),
        phase(
            items,
            { drop: [{ item: '^Pie dish$' }] },
            { name: 'junk-dish', when: v => v.inv('Pie dish') > 0, onFail: 'continue' },
        ),
        phase(
            items,
            { drop: [{ item: '^Rotten food$' }] },
            { name: 'junk-rot', when: v => v.inv('Rotten food') > 0, onFail: 'continue' },
        ),
        // ---- the grotto (underground): the Nature Spirit ----
        // The first talk (the transformation) ends in a menu of sickle questions: answer it with "Ok thanks"; the second
        // (the sickle) and the last (the reward) are plain conversations, so a failed first try falls through to them.
        phase(
            interact,
            { ...grottoLoc, option: '^Search$', choices: ['^Ok,? thanks'] },
            {
                name: 'grotto-talk-menu',
                when: v =>
                    inGrotto(v) && blessed(v) === 0 && !allThree(v) && !dialogs(v, /transformation is complete/i),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { ...grottoLoc, option: '^Search$' },
            {
                name: 'grotto-talk',
                when: v => inGrotto(v) && (blessed(v) === 0 || allThree(v)) && v.last?.phase !== 'grotto-talk',
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // The talk's pages (the blessing, the pouch, the reward) are still being clicked through when the interact ends.
        phase(
            talk,
            { continue: true },
            { name: 'after-talk', when: v => inGrotto(v) && v.last?.phase === 'grotto-talk', onFail: 'continue' },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Grotto$', option: '^Exit$', at: { x: 3442, z: 9734, level: 0, tolerance: 1 } },
            { name: 'grotto-exit', when: v => inGrotto(v) && blessed(v) > 0 && !allThree(v), onFail: 'continue' },
        ),
        // ---- the ghasts: a filled pouch makes the one that attacks visible ----
        phase(
            combat,
            {
                target: 'Ghast',
                level: 30,
                skill: 'Strength',
                area: { x: 3436, z: 3350, radius: 16 },
                food: FOOD,
                eatBelow: 0.5,
                maxLevelGap: 20,
                respawnWaitTicks: 60,
            },
            {
                name: 'ghasts',
                when: v => blessed(v) > 0 && ghastVisible(v) && !allThree(v) && !onIsland(v) && !inGrotto(v),
                until: v => allThree(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // Using the filled pouch on an unseen Ghast turns it visible and binds it to the bot.
        phase(
            interact,
            { target: 'npc', name: '^Ghast$', use: { item: '^Druid pouch$' } },
            {
                name: 'reveal',
                when: v =>
                    blessed(v) > 0 &&
                    pouchFilled(v) &&
                    !ghastVisible(v) &&
                    ghastNear(v) &&
                    !allThree(v) &&
                    !onIsland(v) &&
                    !inGrotto(v),
                onFail: 'continue',
                maxFails: 8,
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^Druid pouch$', option: '^Fill$', expect: 'natures harvests' },
            {
                name: 'fill',
                when: v => blessed(v) > 0 && pouch(v) >= 1 && !pouchFilled(v) && plants(v) >= 3,
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Fungi on log$', option: '^Pick$' },
            {
                name: 'pick-fungi',
                when: v => blessed(v) > 0 && plants(v) < 3 && locNear(v, /^Fungi on log$/),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Budding branch$', option: '^Take-cutting$' },
            {
                name: 'pick-stem',
                when: v => blessed(v) > 0 && plants(v) < 3 && locNear(v, /^Budding branch$/),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^A golden pear bush$', option: '^Pick$' },
            {
                name: 'pick-pear',
                when: v => blessed(v) > 0 && plants(v) < 3 && locNear(v, /^A golden pear bush$/),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'item', name: '^Silver sickle\\(b\\)$', option: '^Cast Bloom$' },
            {
                name: 'cast-sickle',
                when: v =>
                    blessed(v) > 0 &&
                    pouch(v) >= 1 &&
                    !pouchFilled(v) &&
                    plants(v) < 3 &&
                    atLogs(v) &&
                    !allThree(v) &&
                    !sickleSettle(v),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            travel,
            { to: { x: 3440, z: 3349 }, tolerance: 2, met: MET },
            {
                name: 'to-logs-2',
                when: v => blessed(v) > 0 && !allThree(v) && !atLogs(v) && !onIsland(v) && !inGrotto(v),
            },
        ),
        // ---- the ritual and the grotto entrance (on the island) ----
        phase(interact, door, { name: 'finish-enter', when: v => onIsland(v) && allThree(v), onFail: 'continue' }),
        phase(interact, door, {
            name: 'grotto-enter',
            when: v =>
                onIsland(v) &&
                (ritualEv(v) || (v.last?.phase === 'puzzle' && v.last.status === 'done')) &&
                blessed(v) === 0 &&
                sickle(v) > 0,
            onFail: 'continue',
        }),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Grotto tree$',
                option: '^Search$',
                expect: 'tome|journal|knot',
                at: { x: 3438, z: 3340, tolerance: 2 },
            },
            {
                name: 'search-tree',
                when: v =>
                    onIsland(v) &&
                    mirror(v) > 0 &&
                    journal(v) === 0 &&
                    bare(v) &&
                    !ritualEv(v) &&
                    blessed(v) === 0 &&
                    !dialogs(v, /My journal! That should help|It.s all coming back/i) &&
                    !messages(v, /seems to absorb the/i),
                onFail: 'continue',
                maxFails: 2,
            },
        ),
        phase(
            talk,
            { npc: '^Filliman Tarlock$', at: { x: 3440, z: 3335, tolerance: 1 }, choices: ['solved the puzzle'] },
            {
                name: 'puzzle',
                when: v => stonesDone(v) && filliman(v) && v.last?.phase !== 'puzzle',
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { ...door, choices: ['^Ok, thanks'] },
            { name: 'summon-ritual', when: v => stonesDone(v) && !filliman(v), onFail: 'continue' },
        ),
        phase(interact, stone(3441, 3336, '^A used spell$'), {
            name: 'spirit-stone',
            when: v => onIsland(v) && fungi(v) === 0 && used(v) > 0 && mirror(v) > 0 && journal(v) === 0,
            onFail: 'continue',
        }),
        phase(interact, stone(3439, 3336, '^Mort myre fungi$'), {
            name: 'nature-stone',
            when: v => onIsland(v) && fungi(v) > 0 && mirror(v) > 0,
            onFail: 'continue',
        }),
        // ---- Filliman: mirror, journal, the spell ----
        phase(
            interact,
            { target: 'npc', name: '^Filliman Tarlock$', use: { item: '^Journal$' }, choices: ['How can I help'] },
            {
                name: 'journal',
                when: v => onIsland(v) && filliman(v) && journal(v) > 0 && mirror(v) > 0 && ev2(v),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { target: 'npc', name: '^Filliman Tarlock$', use: { item: '^Mirror$' } },
            {
                name: 'mirror',
                when: v => onIsland(v) && filliman(v) && journal(v) > 0 && mirror(v) > 0 && ev1(v) && !ev2(v),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { ...door, choices: ['wearing an amulet', '^Ok, thanks'] },
            {
                name: 'ghost-talk',
                when: v => onIsland(v) && journal(v) > 0 && mirror(v) > 0 && !ev1(v) && !ev2(v),
                onFail: 'continue',
            },
        ),
        phase(
            interact,
            { ...door, choices: [] },
            {
                name: 'summon',
                when: v => onIsland(v) && !filliman(v) && journal(v) > 0 && (ev1(v) || ev2(v)),
                onFail: 'continue',
            },
        ),
        phase(
            pickup,
            { area: { x: 3437, z: 3337, radius: 3 }, items: [{ item: 'Washing bowl' }, { item: 'Mirror' }] },
            {
                name: 'mirror-pickup',
                when: v => onIsland(v) && started(v) && mirror(v) === 0 && blessed(v) === 0,
                onFail: 'continue',
            },
        ),
        phase(
            pickup,
            { area: { x: 3437, z: 3337, radius: 3 }, items: [{ item: 'Washing bowl' }, { item: 'Mirror' }] },
            {
                name: 'mirror-pickup-2',
                when: v => onIsland(v) && started(v) && mirror(v) === 0 && blessed(v) === 0,
                onFail: 'continue',
            },
        ),
        // ---- crossing the stones ----
        // After a jump the view of the position lags: walk on from wherever the jump left the bot (a failed jump is
        // jumped again, the walk failing with no path across the water).
        phase(
            travel,
            { to: { x: 3440, z: 3336 }, tolerance: 3, met: MET },
            { name: 'after-jump-in', when: v => v.last?.phase === 'jump-in' && needIsland(v), onFail: 'continue' },
        ),
        phase(
            travel,
            { to: { x: 3441, z: 3327 }, tolerance: 1, met: MET },
            { name: 'after-jump-out', when: v => v.last?.phase === 'jump-out' && needOut(v), onFail: 'continue' },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Bridge$', option: '^Jump$', at: { x: 3441, z: 3328, tolerance: 1 } },
            { name: 'jump-in', when: v => needIsland(v) && southBank(v), onFail: 'continue', maxFails: 12 },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Bridge$', option: '^Jump$', at: { x: 3440, z: 3332, tolerance: 1 } },
            { name: 'jump-out', when: v => needOut(v) && onIsland(v), onFail: 'continue', maxFails: 12 },
        ),
        phase(
            travel,
            { to: { x: 3441, z: 3327 }, tolerance: 1, met: MET },
            {
                name: 'to-bank',
                when: v =>
                    needIsland(v) && !onIsland(v) && !southBank(v) && !inGrotto(v) && !dungeon(v) && lvl(v) === 0,
            },
        ),
        // ---- Drezel's blessing, then the logs ----
        phase(
            interact,
            { target: 'item', name: '^Druidic spell$', option: '^Cast$', expect: 'cast the spell' },
            {
                name: 'cast-spell',
                when: v => spell(v) > 0 && blessEv(v) && atLogs(v) && !castOk(v),
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        phase(
            interact,
            { target: 'loc', name: '^Fungi on log$', option: '^Pick$' },
            {
                name: 'pick-first',
                when: v => blessed(v) === 0 && fungi(v) === 0 && locNear(v, /^Fungi on log$/),
                onFail: 'continue',
            },
        ),
        // The client shows the bloom (and the new inventory) 3 ticks after the cast and the bloom lasts 25: walk between
        // two tiles beside the logs instead of re-casting on the stale inventory, until the Fungi on log is listed.
        phase(
            travel,
            { to: { x: 3440, z: 3352 }, tolerance: 1, met: MET },
            { name: 'settle-a', when: v => (settling(v) || sickleSettle(v)) && pz(v) <= 3350 },
        ),
        phase(
            travel,
            { to: { x: 3440, z: 3349 }, tolerance: 1, met: MET },
            { name: 'settle-b', when: v => (settling(v) || sickleSettle(v)) && pz(v) >= 3351 },
        ),
        phase(
            travel,
            { to: { x: 3440, z: 3349 }, tolerance: 2, met: MET },
            { name: 'to-logs', when: v => spell(v) > 0 && blessEv(v) && !atLogs(v) && !onIsland(v) && !dungeon(v) },
        ),
        phase(talk, drezel, {
            name: 'bless',
            when: v => spell(v) > 0 && !blessEv(v) && !onIsland(v),
            onFail: 'continue',
            maxFails: 4,
        }),
        // ---- the sickle errand (Al Kharid) ----
        phase(
            interact,
            {
                target: 'loc',
                name: '^Furnace$',
                use: { item: '^Silver bar$' },
                at: { x: 3274, z: 3184, tolerance: 3 },
                choices: ['Silver sickle'],
            },
            {
                name: 'craft-sickle',
                when: v => anySickle(v) === 0 && v.inv('Silver bar') > 0 && v.inv('Sickle mould') > 0,
                maxFails: 3,
            },
        ),
        phase(
            shop,
            { npc: 'Dommik', at: { x: 3322, z: 3194 }, buy: [{ item: 'Sickle mould', count: 1 }] },
            { name: 'mould', when: v => anySickle(v) === 0 && v.inv('Sickle mould') === 0 },
        ),
        // ---- Drezel, the barrier, the swamp ----
        phase(interact, barrier, {
            name: 'pass',
            when: v => started(v) && dungeon(v) && !inGrotto(v) && anySickle(v) > 0,
            onFail: 'continue',
            maxFails: 4,
        }),
        phase(
            talk,
            { ...drezel, choices: ['anything else interesting', 'what is it', 'go and look for him', "I'm sure"] },
            { name: 'start', when: v => none(v) && anySickle(v) > 0, maxFails: 3 },
        ),
    ],
    until: v => v.questDone(ID),
});

// Both stones set (fungus and spell gone), the journal handed over, the sickle held: only the ritual talk is left.
function stonesDone(v: PlanView): boolean {
    return onIsland(v) && bare(v) && mirror(v) > 0 && sickle(v) > 0 && blessed(v) === 0 && !ritualEv(v);
}

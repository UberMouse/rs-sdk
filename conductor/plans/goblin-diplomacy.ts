// Goblin Diplomacy (server/content/scripts/quests/quest_gobdip, areas/area_draynor/scripts/aggie.rs2,
// area_falador/scripts/wyson_the_gardener.rs2, area_port_sarim/scripts/bartender.rs2):
//   3 Goblin mail (Lumbridge goblins) -> 2 Onions (Lumbridge field) -> 3 Redberries (ground spawns SE Varrock)
//   -> 2 Woad leaves (Wyson, Falador park, 20 gp) -> Aggie in Draynor makes red, yellow and blue dye (5 gp each, by
//   dialog) -> red on yellow = orange dye -> orange and blue dye onto two mails -> Bartender in Port Sarim starts the
//   quest -> Wartface/Bentnoze: pick-a-colour, then hand in orange, blue and last the plain (brown) mail.
// Start state: 35+ coins, a weapon, food. Restart-safe: phases come from the held items, the quest tab and the
// position (the plain mail is handed in only when it is the last mail held and the bot stands at the generals).
// The Varrock leg avoids the stone circle dark wizards (learnings/hazards.md) via (3260,3335).
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import combat from '@conductor/tasks/combat';
import items from '@conductor/tasks/items';
import pick from '@conductor/tasks/pick';
import pickup from '@conductor/tasks/pickup';
import talk from '@conductor/tasks/talk';
import travel from '@conductor/tasks/travel';

const ID = 'gobdip';
const FOOD = ['Salmon', 'Trout', 'Tuna', 'Lobster', 'Swordfish'];
const GENERALS = { x: 2957, z: 3511 };
const generals = { npc: 'General Wartface', at: { ...GENERALS, level: 0, tolerance: 4 } };
const aggie = { npc: 'Aggie', at: { x: 3086, z: 3259, level: 0, tolerance: 3 } };

const inv = (v: PlanView, ...names: string[]) => names.reduce((n, name) => n + v.inv(name), 0);
const plain = (v: PlanView) => v.inv('Goblin mail');
const orange = (v: PlanView) => v.inv('Orange goblin mail');
const blue = (v: PlanView) => v.inv('Blue goblin mail');
const mails = (v: PlanView) => plain(v) + orange(v) + blue(v);
const started = (v: PlanView) => v.quest(ID) === 'started';
const near = (v: PlanView, c: { x: number; z: number }, r: number) => {
    const p = v.state.player;
    return !!p && p.level === 0 && Math.max(Math.abs(p.worldX - c.x), Math.abs(p.worldZ - c.z)) <= r;
};
// What each colour still needs: raw ingredients, or its dye / mail already made.
const hasRed = (v: PlanView) => v.inv('Redberries') >= 3 || inv(v, 'Red dye', 'Orange dye') > 0 || orange(v) > 0;
const hasYellow = (v: PlanView) => v.inv('Onion') >= 2 || inv(v, 'Yellow dye', 'Orange dye') > 0 || orange(v) > 0;
const hasBlue = (v: PlanView) => v.inv('Woad leaf') >= 2 || v.inv('Blue dye') > 0 || blue(v) > 0;
// Ingredients are gathered only with all three mails held and nothing handed in yet (a hand-in lowers the count).
const gathering = (v: PlanView) => mails(v) === 3;
const coins = (v: PlanView) => v.inv('Coins');

export default definePlan({
    name: 'goblin-diplomacy',
    description:
        'Goblin Diplomacy: 3 goblin mails, onions, redberries, woad, Aggie dyes, dye two mails, start at the Port Sarim bartender, hand orange, blue, brown to the goblin generals.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // The last mail (plain = brown) once orange and blue are in: the only state with one plain mail at the generals.
        phase(
            talk,
            { ...generals },
            {
                name: 'turnin-brown',
                when: v => started(v) && mails(v) === 1 && plain(v) === 1 && near(v, GENERALS, 20),
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        // With all three colours held the quest is at stage 1 (or 2 after a restart: then this talk hands in the
        // orange mail and ends early, which is fine).
        phase(
            talk,
            { ...generals, choices: ['pick an armour colour'] },
            {
                name: 'generals-pick',
                when: v => started(v) && orange(v) > 0 && blue(v) > 0 && plain(v) > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            talk,
            { ...generals },
            {
                name: 'turnin-dyed',
                when: v => started(v) && orange(v) + blue(v) > 0,
                onFail: 'continue',
                maxFails: 6,
            },
        ),
        phase(
            talk,
            { npc: 'Bartender', at: { x: 3045, z: 3257, level: 0, tolerance: 3 }, choices: ['Not very busy'] },
            { name: 'start', when: v => v.quest(ID) === 'none' && orange(v) > 0 && blue(v) > 0 && plain(v) > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Orange dye$', on: '^Goblin mail$', product: '^Orange goblin mail$' } },
            { name: 'dye-orange', when: v => v.inv('Orange dye') > 0 && plain(v) > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Blue dye$', on: '^Goblin mail$', product: '^Blue goblin mail$' } },
            { name: 'dye-blue', when: v => v.inv('Blue dye') > 0 && plain(v) > 0 },
        ),
        phase(
            items,
            { combine: { use: '^Red dye$', on: '^Yellow dye$', product: '^Orange dye$' } },
            { name: 'mix-orange', when: v => v.inv('Red dye') > 0 && v.inv('Yellow dye') > 0 },
        ),
        // Aggie, once every colour's ingredients are held (one visit).
        phase(
            talk,
            { ...aggie, choices: ['dyes for me', 'make red dye', 'make me some red dye'] },
            {
                name: 'aggie-red',
                when: v =>
                    hasRed(v) &&
                    hasYellow(v) &&
                    hasBlue(v) &&
                    v.inv('Redberries') >= 3 &&
                    v.inv('Red dye') === 0 &&
                    coins(v) >= 5,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { ...aggie, choices: ['dyes for me', 'make yellow dye', 'make me some yellow dye'] },
            {
                name: 'aggie-yellow',
                when: v =>
                    hasRed(v) &&
                    hasYellow(v) &&
                    hasBlue(v) &&
                    v.inv('Onion') >= 2 &&
                    v.inv('Yellow dye') === 0 &&
                    coins(v) >= 5,
                onFail: 'continue',
            },
        ),
        phase(
            talk,
            { ...aggie, choices: ['dyes for me', 'make blue dye', 'make me some blue dye'] },
            {
                name: 'aggie-blue',
                when: v =>
                    hasRed(v) &&
                    hasYellow(v) &&
                    hasBlue(v) &&
                    v.inv('Woad leaf') >= 2 &&
                    v.inv('Blue dye') === 0 &&
                    coins(v) >= 5,
                onFail: 'continue',
            },
        ),
        // Ingredients (producers).
        phase(
            pick,
            { loc: 'Onion', item: 'Onion', count: 2, area: { x: 3190, z: 3267, radius: 8 } },
            { name: 'onions', when: v => gathering(v) && !hasYellow(v) },
        ),
        phase(
            travel,
            { to: { x: 3268, z: 3364, level: 0 }, tolerance: 4, waypoints: [{ x: 3260, z: 3335 }] },
            {
                name: 'to-berries',
                when: v => gathering(v) && !hasRed(v) && hasYellow(v) && !near(v, { x: 3272, z: 3370 }, 14),
            },
        ),
        phase(
            pickup,
            { area: { x: 3272, z: 3370, radius: 10 }, items: [{ item: 'Redberries', count: 3 }] },
            { name: 'berries', when: v => gathering(v) && !hasRed(v) && hasYellow(v) },
        ),
        // Back west by the Lumbridge-Draynor road, not along z 3376 past the stone circle.
        phase(
            travel,
            { to: { x: 3092, z: 3268, level: 0 }, tolerance: 6, waypoints: [{ x: 3260, z: 3335 }] },
            {
                name: 'to-draynor',
                when: v =>
                    gathering(v) &&
                    hasRed(v) &&
                    hasYellow(v) &&
                    !hasBlue(v) &&
                    (v.state.player?.worldX ?? 0) > 3130 &&
                    (v.state.player?.worldZ ?? 0) > 3300,
            },
        ),
        phase(
            talk,
            {
                npc: 'Wyson',
                at: { x: 3027, z: 3379, level: 0, tolerance: 4 },
                choices: ['looking for woad', '20 coins'],
            },
            {
                name: 'woad',
                when: v => gathering(v) && hasRed(v) && hasYellow(v) && !hasBlue(v) && coins(v) >= 20,
                onFail: 'continue',
                maxFails: 4,
            },
        ),
        // Goblin mail (producer; only while nothing is dyed or handed in).
        phase(
            combat,
            {
                target: 'Goblin',
                area: { x: 3254, z: 3236, radius: 20 },
                food: FOOD,
                loot: ['Goblin mail'],
                skill: 'Strength',
            },
            {
                name: 'mails',
                when: v =>
                    mails(v) < 3 && orange(v) === 0 && blue(v) === 0 && !(plain(v) === 1 && near(v, GENERALS, 20)),
                until: v => mails(v) >= 3,
            },
        ),
    ],
    until: v => v.questDone(ID),
});

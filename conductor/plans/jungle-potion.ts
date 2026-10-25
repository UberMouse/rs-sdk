// Jungle Potion (quest id junglepotion; wiki/quests/jungle-potion.md): Port Sarim -> Karamja (Captain Tobias, 30 gp),
// Trufitus in Tai Bwo Wannai (start), then five herbs in turn: Snake weed (vines SW), Ardrigal (palm NE), Sito foil
// (scorched earth S), Volencia moss (rock SE), Rogues purse (cave wall in the pothole dungeon N). Each herb is searched
// unidentified, identified (Herblore 3), and handed to Trufitus, who then names the next one.
// Needs Druidic Ritual done, Herblore 3, 30+ coins and some food. The quest tab shows none/started/done only, so the
// herb being fetched is read from Trufitus' clue text in the dialog history; after a restart (or with the history
// rolled over) the "Not yet, what's the clue again?" talk puts it back. The server lets only the current stage's loc
// give a counted herb, so each search phase is gated on its clue.
import { definePlan, phase, type PlanView } from '@conductor/lib/plan';
import { QUEST_TAB_REQUIRED } from '@conductor/lib/quests';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';

const ID = 'junglepotion';
const HERBS = /^(Snake weed|Ardrigal|Sito foil|Volencia moss|Rogues purse)$/i;
// one clue phrase per herb stage, in quest order (Trufitus' hand-in and clue dialogs)
const CLUES = [/kisses/i, /profusion/i, /blackened/i, /clings to rocks/i, /darkness/i];

const px = (v: PlanView) => v.state.player?.worldX ?? 0;
const pz = (v: PlanView) => v.state.player?.worldZ ?? 0;
const lvl = (v: PlanView) => v.state.player?.level ?? 0;
const underground = (v: PlanView) => pz(v) > 9000;
const surface = (v: PlanView) => pz(v) < 6000 && lvl(v) === 0;
// Karamja is south of z 3190 (Port Sarim, the mainland, is z 3200+ at x 3000+)
const karamja = (v: PlanView) => surface(v) && pz(v) < 3190 && px(v) < 2990;
const portSarim = (v: PlanView) => surface(v) && pz(v) >= 3190 && px(v) >= 2990 && px(v) <= 3060;
const onDeck = (v: PlanView) => lvl(v) === 1 && px(v) >= 2940 && px(v) <= 2975 && pz(v) >= 3130 && pz(v) <= 3160;
const coins = (v: PlanView) => v.inv('Coins');

const started = (v: PlanView) => v.quest(ID) === 'started';
const herbs = (v: PlanView) => v.inv(HERBS);
const unid = (v: PlanView) => v.inv(/^Unidentified herb$/i);
// 0..4 = the herb Trufitus last asked for, -1 = none seen
const stage = (v: PlanView) => {
    const pages = [...v.state.recentDialogs].sort((a, b) => b.tick - a.tick);
    for (const p of pages) {
        const t = p.text.join(' ');
        const i = CLUES.findIndex(c => c.test(t));
        if (i >= 0) return i;
    }
    return -1;
};
const needSearch = (v: PlanView, k: number) => started(v) && stage(v) === k && herbs(v) === 0 && unid(v) === 0;

const trufitus = { npc: '^Trufitus$', at: { x: 2809, z: 3086, tolerance: 3 } };
const search = (name: string, k: number, at: { x: number; z: number }, loc: string) =>
    phase(
        interact,
        { target: 'loc' as const, name: loc, option: '^Search$', at: { ...at, tolerance: 4 } },
        { name, when: v => needSearch(v, k) && surface(v) && karamja(v), maxFails: 4 },
    );

export default definePlan({
    name: 'jungle-potion',
    description: 'Jungle Potion: boat to Karamja, Trufitus, five herbs searched, identified and handed in one by one.',
    requires: { ...QUEST_TAB_REQUIRED },
    phases: [
        // --- consumers first ---
        phase(
            interact,
            { target: 'item', name: '^Unidentified herb$', option: '^Identify$' },
            { name: 'identify', when: v => unid(v) > 0 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Hand holds$',
                option: '^Climb$',
                at: { x: 2830, z: 9522, level: 0, tolerance: 2 },
            },
            { name: 'cave-out', when: v => underground(v) && herbs(v) > 0 },
        ),
        phase(
            talk,
            { ...trufitus, choices: ['Of course'] },
            { name: 'hand-in', when: v => started(v) && herbs(v) > 0 && !underground(v) },
        ),
        // --- the herbs ---
        search('vine', 0, { x: 2761, z: 3016 }, '^Marshy jungle vine$'),
        search('palm', 1, { x: 2874, z: 3120 }, '^Palm tree$'),
        search('scorched', 2, { x: 2790, z: 3048 }, '^Scorched earth$'),
        search('rock', 3, { x: 2851, z: 3035 }, '^Rock$'),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Fungus covered Cavern wall$',
                option: '^Search$',
                at: { x: 2866, z: 9517, level: 0, tolerance: 4 },
            },
            { name: 'cave-herb', when: v => needSearch(v, 4) && underground(v), maxFails: 4 },
        ),
        phase(
            interact,
            {
                target: 'loc',
                name: '^Rocks$',
                option: '^Search$',
                at: { x: 2824, z: 3117, tolerance: 3 },
                choices: ['enter the cave'],
            },
            { name: 'cave-in', when: v => needSearch(v, 4) && karamja(v) && surface(v), maxFails: 3 },
        ),
        // --- the clue, when none is in the history ---
        phase(
            talk,
            { ...trufitus, choices: ['Not yet'] },
            { name: 'clue', when: v => started(v) && herbs(v) === 0 && unid(v) === 0 && stage(v) < 0 && karamja(v) },
        ),
        // --- start the quest ---
        phase(
            talk,
            { ...trufitus, choices: ['where is everyone', 'Me\\? How can I help', 'just the challenge'] },
            { name: 'start', when: v => v.quest(ID) === 'none' && karamja(v) },
        ),
        // --- the boat ---
        phase(
            interact,
            { target: 'loc', name: '^Gangplank$', option: 'Cross', tile: { x: 2956, z: 3144, level: 1 } },
            { name: 'disembark', when: onDeck, maxFails: 4 },
        ),
        phase(
            talk,
            { npc: '^Captain Tobias$', at: { x: 3028, z: 3216, tolerance: 3 }, choices: ['Yes please'], travels: true },
            { name: 'ship', when: v => portSarim(v) && coins(v) >= 30 && v.quest(ID) !== 'done', maxFails: 4 },
        ),
    ],
    until: v => v.questDone(ID),
});

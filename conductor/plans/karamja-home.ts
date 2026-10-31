// From Karamja (Crandor escape) back to Port Sarim by the Musa Point customs officer (30 coins).
import { definePlan, phase } from '@conductor/lib/plan';
import interact from '@conductor/tasks/interact';
import talk from '@conductor/tasks/talk';

export default definePlan({
    name: 'karamja-home',
    description: 'Musa Point customs ferry to Port Sarim',
    until: v => (v.state.player?.worldX ?? 0) > 3000 && v.runs('cross') > 0,
    phases: [
        phase(
            interact,
            {
                target: 'loc',
                name: '^Gangplank$',
                option: 'Cross',
                tile: { x: 3031, z: 3217, level: 1 },
                at: { x: 3031, z: 3217, level: 1, tolerance: 2 },
            },
            { name: 'cross', when: v => (v.state.player?.worldX ?? 0) > 3000 },
        ),
        phase(
            talk,
            {
                npc: '^Customs officer$',
                at: { x: 2954, z: 3147, tolerance: 2 },
                choices: ['Can I journey', 'Search away', '^Ok'],
                travels: true,
            },
            { name: 'ferry', when: v => v.inv('Coins') >= 30 && (v.state.player?.worldX ?? 0) < 3000 },
        ),
    ],
});

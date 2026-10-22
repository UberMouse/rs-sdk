// Varrock East bank (take up to 16 cooked trout/salmon) -> travel to the Gnome Stronghold course -> agility laps.
// Runs until the run's --until (e.g. level:Agility:N). The food covers the White Wolf Mountain walk;
// once at the course it laps from wherever it stands.
import { definePlan, phase } from '@conductor/lib/plan';
import agility from '@conductor/tasks/agility';
import bank from '@conductor/tasks/bank';
import travel from '@conductor/tasks/travel';

const vbank = { x: 3254, z: 3420, radius: 3 };
const atCourse = (v: { state: { player?: { worldX: number; worldZ: number } | null } }) => {
    const p = v.state.player;
    return !!p && Math.abs(p.worldX - 2474) <= 40 && Math.abs(p.worldZ - 3436) <= 40;
};

export default definePlan({
    name: 'gnome-agility',
    method: 'agility-gnome-course',
    description: 'Varrock East bank food -> travel to Gnome Stronghold -> agility laps',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(agility, { course: 'gnome' }, { when: v => atCourse(v) }),
        phase(
            travel,
            { to: { x: 2474, z: 3436 } },
            { when: v => v.runs('bank-food') > 0 || v.inv(/^(trout|salmon)$/i) >= 10 },
        ),
        phase(
            bank,
            {
                area: vbank,
                withdraw: [
                    { item: 'Trout', count: 8, upTo: true },
                    { item: 'Salmon', count: 8, upTo: true },
                ],
            },
            { name: 'bank-food' },
        ),
    ],
});

// Ardougne -> Gnome Stronghold (west, no mountain) -> gnome laps until Agility 52.
import { definePlan, phase } from '@conductor/lib/plan';
import agility from '@conductor/tasks/agility';
import travel from '@conductor/tasks/travel';

const atCourse = (v: { state: { player?: { worldX: number; worldZ: number } | null } }) => {
    const p = v.state.player;
    return !!p && Math.abs(p.worldX - 2474) <= 40 && Math.abs(p.worldZ - 3436) <= 40;
};

export default definePlan({
    name: 'agility-from-ardougne',
    method: 'agility-gnome-course',
    description: 'Travel Ardougne -> Gnome Stronghold -> gnome laps to Agility 52',
    until: v => v.level('Agility') >= 52,
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(agility, { course: 'gnome' }, { when: v => atCourse(v), until: v => v.level('Agility') >= 52 }),
        phase(travel, { to: { x: 2474, z: 3436 } }, { when: v => !atCourse(v) }),
    ],
});

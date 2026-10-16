// Altar exit done earlier. Varrock East bank (stash runes, fetch scimitar + fish) -> wield scimitar -> bank pickaxe -> travel to Stronghold -> gnome laps.
import { definePlan, phase } from '@conductor/lib/plan';
import agility from '@conductor/tasks/agility';
import bank from '@conductor/tasks/bank';
import combat from '@conductor/tasks/combat';
import travel from '@conductor/tasks/travel';

const SCIM = /^steel scimitar$/i;
const PICK = /^adamant pickaxe$/i;
const BANK_AREA = { x: 3254, z: 3420, radius: 5 };
const scimWorn = (v: { state: { equipment: { name: string }[] } }) => v.state.equipment.some(i => SCIM.test(i.name));
const atCourse = (v: { state: { player?: { worldX: number; worldZ: number } | null } }) => {
    const p = v.state.player;
    return !!p && Math.abs(p.worldX - 2474) <= 40 && Math.abs(p.worldZ - 3436) <= 40;
};

export default definePlan({
    name: 'agility-52',
    description: 'Bank swap (runes/pickaxe out, scimitar + fish in) -> travel to the Gnome Stronghold -> agility laps',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(agility, { course: 'gnome' }, { when: v => atCourse(v) }),
        phase(
            travel,
            { to: { x: 2474, z: 3436 } },
            { when: v => v.runs('bank-2') > 0 && scimWorn(v) && v.inv(PICK) === 0 },
        ),
        phase(
            bank,
            { area: BANK_AREA, depositAllExcept: ['Trout', 'Salmon'] },
            { name: 'bank-2', when: v => v.runs('wield') > 0 && v.inv(PICK) > 0 },
        ),
        phase(
            combat,
            { target: 'Man', area: { x: 3238, z: 3404, radius: 14 }, skill: 'Strength', weapon: 'Steel scimitar' },
            { name: 'wield', when: v => v.inv(SCIM) > 0 && !scimWorn(v), until: scimWorn },
        ),
        phase(
            bank,
            {
                area: BANK_AREA,
                deposit: [{ item: 'Earth rune' }],
                withdraw: [
                    { item: 'Steel scimitar', count: 1 },
                    { item: 'Trout', count: 8, upTo: true },
                    { item: 'Salmon', count: 8, upTo: true },
                ],
            },
            { name: 'bank-1', when: v => v.runs('bank-1') === 0 },
        ),
    ],
});

// Firemaking 1 -> 99: tinderbox from Falador general store, normal trees at Lumbridge to FM 30, then Draynor willows.
import { definePlan, phase } from '@conductor/lib/plan';
import { place } from '@conductor/lib/places';
import bank from '@conductor/tasks/bank';
import firemaking from '@conductor/tasks/firemaking';
import shop from '@conductor/tasks/shop';
import travel from '@conductor/tasks/travel';
import woodcutting from '@conductor/tasks/woodcutting';

type V = { state: { player?: { worldX: number; worldZ: number } | null } };
const near = (v: V, x: number, z: number, r: number) => {
    const p = v.state.player;
    return !!p && Math.abs(p.worldX - x) <= r && Math.abs(p.worldZ - z) <= r;
};
const nearLumb = (v: V) => near(v, 3215, 3230, 45);
const nearDraynor = (v: V) => near(v, 3090, 3240, 30);
const nearFal = (v: V) => near(v, 2955, 3375, 25);
const hasAxe = (v: { inv(i: RegExp): number }) => v.inv(/^(?!broken ).* axe$/i) > 0;
const kit = (v: { inv(i: RegExp): number }) => hasAxe(v) && v.inv(/^tinderbox$/i) > 0;

export default definePlan({
    name: 'fm-99',
    description: 'Firemaking 1-99: Lumbridge trees to 30, Draynor willows after.',
    requires: { 'combat level 45+': v => (v.state.player?.combatLevel ?? 0) >= 45 },
    until: v => v.level('Firemaking') >= 99,
    phases: [
        phase(
            firemaking,
            { logs: 'Logs', area: { x: 3230, z: 3240, radius: 6 } },
            {
                name: 'burn-logs',
                when: v => v.full && v.inv('Logs') > 0 && v.level('Firemaking') < 30 && v.inv(/^tinderbox$/i) > 0,
                until: v => v.level('Firemaking') >= 30,
            },
        ),
        phase(
            firemaking,
            { logs: 'Willow logs', area: { x: 3088, z: 3247, radius: 6 } },
            {
                name: 'burn-willow',
                when: v => v.inv('Willow logs') > 0 && v.full && v.inv(/^tinderbox$/i) > 0,
                until: v => v.level('Firemaking') >= 99,
            },
        ),
        phase(
            bank,
            {
                area: { x: 2945, z: 3368, radius: 4 },
                depositAllExcept: ['Coins', 'Dusty key', 'Tinderbox'],
                withdraw: [
                    { item: 'Adamant axe', count: 1, upTo: true },
                    { item: 'Tinderbox', count: 1, upTo: true },
                ],
            },
            { name: 'fetch-start', when: v => !hasAxe(v) && nearFal(v) },
        ),
        phase(
            shop,
            { npc: 'Shop keeper', at: { x: 2956, z: 3388 }, buy: [{ item: 'Tinderbox', count: 1, maxUnitPrice: 10 }] },
            { name: 'buy-tinderbox', when: v => v.inv(/^tinderbox$/i) === 0 && hasAxe(v) && nearFal(v) },
        ),
        phase(
            bank,
            {
                area: place('bank:draynor-bank').area(3),
                depositAllExcept: ['Coins', 'Dusty key', 'Tinderbox'],
                withdraw: [
                    { item: 'Adamant axe', count: 1, upTo: true },
                    { item: 'Tinderbox', count: 1, upTo: true },
                ],
            },
            { name: 'fetch-draynor', when: v => !kit(v) && nearDraynor(v) },
        ),
        phase(
            travel,
            { to: { x: 3200, z: 3222 } },
            { name: 'to-lumbridge', when: v => kit(v) && v.level('Firemaking') < 30 && !nearLumb(v) },
        ),
        phase(
            woodcutting,
            { tree: 'tree', onFull: 'stop', area: { x: 3195, z: 3220, radius: 12 } },
            { name: 'chop-trees', when: v => kit(v) && v.level('Firemaking') < 30 && nearLumb(v) },
        ),
        phase(
            travel,
            { to: { x: 3088, z: 3236 } },
            { name: 'to-draynor', when: v => kit(v) && v.level('Firemaking') >= 30 && !nearDraynor(v) },
        ),
        phase(
            woodcutting,
            { tree: 'willow', onFull: 'stop', area: { x: 3085, z: 3232, radius: 9 } },
            { name: 'chop-willow', when: v => kit(v) && v.level('Firemaking') >= 30 && nearDraynor(v) },
        ),
    ],
});

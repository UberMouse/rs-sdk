// Bulk iron smithing: mine a stock of ore (SE Varrock, bank Varrock East) -> smelt at the Al Kharid furnace
// (bank beside it) -> smith kiteshields at Varrock West anvil (bank beside it). Stages follow bank counts.
import { definePlan, phase } from '@conductor/lib/plan';
import bank from '@conductor/tasks/bank';
import mining from '@conductor/tasks/mining';
import smithing from '@conductor/tasks/smithing';
import travel from '@conductor/tasks/travel';

const anvil = { x: 3188, z: 3421, radius: 5 };
const westBank = { x: 3185, z: 3436, radius: 5 };
const eastBank = { x: 3254, z: 3420, radius: 3 };
const akBank = { x: 3269, z: 3167, radius: 3 };
const furnace = { x: 3272, z: 3185, radius: 4 };
const mine = { x: 3285, z: 3365, radius: 10 };
const keep = ['Adamant pickaxe', 'Coins'];
const N = 81; // ore to bank before smelting
const pick = 'Adamant pickaxe';
const products = /^iron kiteshield$/i;
type V = { state: { player?: { worldX: number; worldZ: number } | null } };
const far = (v: V, c: { x: number; z: number }, r: number) => {
    const p = v.state.player;
    return !p || Math.abs(p.worldX - c.x) > r || Math.abs(p.worldZ - c.z) > r;
};
const inAK = (v: V) => {
    const p = v.state.player;
    return !!p && p.worldZ < 3300;
};

const bankOre = (v: { bank: (i: string) => number | undefined }) => v.bank('Iron ore') ?? 0;

export default definePlan({
    name: 'iron-bulk',
    method: 'iron-se-varrock-bank',
    description:
        'Bulk iron: mine N ore into the bank (Varrock East), smelt at Al Kharid, smith kiteshields at Varrock West',
    requires: { 'combat level 5+': v => (v.state.player?.combatLevel ?? 0) >= 5 },
    phases: [
        phase(
            smithing,
            { mode: 'smith', bar: 'iron', product: 'kiteshield', area: anvil },
            { name: 'smith-kite', when: v => v.inv('Iron bar') >= 3 && v.inv('Hammer') > 0 && !far(v, anvil, 8) },
        ),
        phase(
            bank,
            {
                area: westBank,
                depositAllExcept: ['Hammer', 'Coins'],
                withdraw: [{ item: 'Iron bar', count: 24, upTo: true }],
            },
            { name: 'bank-west', when: v => v.inv(products) > 0 && v.inv('Iron bar') < 3 },
        ),
        phase(
            travel,
            {
                to: { x: 3188, z: 3425 },
                tolerance: 3,
                waypoints: [
                    { x: 3200, z: 3300 },
                    { x: 3180, z: 3350 },
                ],
            },
            { name: 'to-anvil', when: v => v.inv('Iron bar') >= 3 && v.inv('Hammer') > 0 && far(v, anvil, 8) },
        ),
        phase(
            smithing,
            { mode: 'smelt', bar: 'iron', area: furnace },
            { name: 'smelt', when: v => v.inv('Iron ore') > 0 && inAK(v) },
        ),
        phase(
            bank,
            { area: akBank, depositAllExcept: ['Coins'], withdraw: [{ item: 'Iron ore', count: 28, upTo: true }] },
            {
                name: 'bank-ak',
                when: v =>
                    (v.inv('Iron bar') > 0 && inAK(v) && v.inv('Hammer') === 0) ||
                    (v.inv('Iron ore') === 0 &&
                        v.inv('Iron bar') === 0 &&
                        v.inv('Hammer') === 0 &&
                        v.inv(products) === 0 &&
                        bankOre(v) >= N),
            },
        ),
        phase(
            bank,
            {
                area: akBank,
                depositAllExcept: ['Coins'],
                withdraw: [
                    { item: 'Hammer', count: 1 },
                    { item: 'Iron bar', count: 24, upTo: true },
                ],
            },
            {
                name: 'bank-bars',
                when: v =>
                    v.runs('bank-ak') > 0 &&
                    v.inv('Iron ore') === 0 &&
                    v.inv('Iron bar') === 0 &&
                    v.inv('Hammer') === 0 &&
                    bankOre(v) === 0 &&
                    (v.bank('Iron bar') ?? 0) >= 3,
            },
        ),
        phase(
            bank,
            { area: eastBank, depositAllExcept: keep },
            { name: 'bank-ore', when: v => v.inv('Iron ore') > 0 && !inAK(v) },
        ),
        phase(
            travel,
            { to: { x: 3254, z: 3420 }, tolerance: 3 },
            { name: 'to-bank', when: v => v.runs('setup') === 0 && far(v, eastBank, 20) },
        ),
        phase(
            bank,
            { area: eastBank, depositAllExcept: ['Coins'], withdraw: [{ item: pick, count: 1, upTo: true }] },
            { name: 'setup', when: v => v.runs('setup') === 0 },
        ),
        phase(
            travel,
            { to: { x: 3286, z: 3368 }, tolerance: 4, waypoints: [{ x: 3260, z: 3400 }] },
            {
                name: 'to-mine',
                when: v => v.inv(pick) > 0 && v.inv('Iron ore') === 0 && bankOre(v) < N && far(v, mine, 12),
            },
        ),
        phase(
            mining,
            { rock: 'iron', onFull: 'stop', area: mine },
            {
                name: 'mine',
                when: v => v.inv(pick) > 0 && v.inv('Iron ore') === 0 && bankOre(v) < N && !far(v, mine, 12),
            },
        ),
    ],
});

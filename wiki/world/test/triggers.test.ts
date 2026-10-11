import { describe, expect, test } from 'bun:test';
import { parseCallables, parseTriggers } from '../sources/triggers';

const rs2 = `[oploc1,bankbooth]
def_npc $n = npc_find(coord, _bank_teller, 1);
@openbank;

[oploc2,bankbooth] @openbank;
[opnpc3,_bank_teller]
@openbank;
[label,openbank]
if_openmain(bank_main);
`;

describe('parseTriggers', () => {
    const t = parseTriggers('interface_bank/scripts/bank_booth.rs2', rs2);

    test('op triggers on names and categories, with bodies', () => {
        expect(t.map(x => [x.on, x.op, x.target, x.category])).toEqual([
            ['loc', '1', 'bankbooth', false],
            ['loc', '2', 'bankbooth', false],
            ['npc', '3', 'bank_teller', true],
        ]);
        expect(t[0]!.body).toContain('@openbank');
        expect(t[1]!.body).toContain('@openbank');
    });

    test('labels and procs are not op triggers', () => {
        expect(t.some(x => x.target === 'openbank')).toBe(false);
    });

    test('a body stops at the next header, even a label', () => {
        expect(t[2]!.body).not.toContain('if_openmain');
    });

    test('labels and procs are indexed by how a body calls them', () => {
        expect(parseCallables('f.rs2', rs2)).toEqual([
            { file: 'f.rs2', call: '@openbank', body: '\nif_openmain(bank_main);\n' },
        ]);
        expect(parseCallables('f.rs2', '[proc,openshop](inv $shop)\nx;\n')).toEqual([
            { file: 'f.rs2', call: '~openshop', body: '(inv $shop)\nx;\n' },
        ]);
    });

    test('ap triggers and use-item ops count; spell-target ops and queues do not', () => {
        const u = parseTriggers('f.rs2', '[apnpc1,man]\n[oplocu,_anvil]\n[opnpct,man]\n[queue,man]\n[proc,x]\n');
        expect(u.map(x => [x.on, x.op, x.target, x.category])).toEqual([
            ['npc', '1', 'man', false],
            ['loc', 'u', 'anvil', true],
        ]);
    });
});

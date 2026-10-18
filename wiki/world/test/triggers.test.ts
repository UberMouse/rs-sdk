import { describe, expect, test } from 'bun:test';
import { approachRange, parseCallables, parseTriggers } from '../sources/triggers';

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

    test('op triggers on names and categories, with their header lines and bodies', () => {
        expect(t.map(x => [x.on, x.op, x.target, x.category])).toEqual([
            ['loc', '1', 'bankbooth', false],
            ['loc', '2', 'bankbooth', false],
            ['npc', '3', 'bank_teller', true],
        ]);
        expect(t.map(x => x.line)).toEqual([1, 5, 6]);
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
            { file: 'f.rs2', call: '@openbank', line: 8, body: '\nif_openmain(bank_main);\n' },
        ]);
        expect(parseCallables('f.rs2', '[proc,openshop](inv $shop)\nx;\n')).toEqual([
            { file: 'f.rs2', call: '~openshop', line: 1, body: '(inv $shop)\nx;\n' },
        ]);
    });

    test('ap triggers and use-item ops count; spell-target ops and queues do not', () => {
        const u = parseTriggers('f.rs2', '[apnpc1,man]\n[oplocu,_anvil]\n[opnpct,man]\n[queue,man]\n[proc,x]\n');
        expect(u.map(x => [x.kind, x.on, x.op, x.target, x.category])).toEqual([
            ['ap', 'npc', '1', 'man', false],
            ['op', 'loc', 'u', 'anvil', true],
        ]);
    });

    test('a header with a trailing comment, or CRLF line endings, still parses', () => {
        const u = parseTriggers('f.rs2', '[opnpc3,man] // Man\r\n@x;\r\n[oploc1,door]\r\n@y;\r\n');
        expect(u.map(x => [x.on, x.op, x.target])).toEqual([
            ['npc', '3', 'man'],
            ['loc', '1', 'door'],
        ]);
        expect(u[0]!.body).toContain('@x;');
    });

    test('a `[` line with no `]` is no header and ends the block before it', () => {
        const u = parseTriggers('f.rs2', '[opnpc1,man]\n@a;\n[opnpc2,man\n@b;\n[opnpc3,man]\n@c;\n');
        expect(u.map(x => x.op)).toEqual(['1', '3']);
        expect(u[0]!.body).toContain('@a;');
        expect(u[0]!.body).not.toContain('@b;');
    });
});

describe('approachRange', () => {
    const range = approachRange(
        parseTriggers(
            'f.rs2',
            [
                '[apnpc1,barmaid]',
                'if (npc_range(coord) > 3) {',
                '    p_aprange(3); // across the bar',
                '    return;',
                '}',
                '@talk;',
                '[apnpc3,barmaid] // trade',
                'if (npc_range(coord) > 2) { p_aprange(2); return; }',
                '[apnpc1,_teller]',
                'if (npc_range(coord) > 2) {',
                '    p_aprange(2);',
                '    return;',
                '}',
                '[apnpc1,own_teller]',
                '@talk;',
                '[apnpc1,seer]',
                'if (lineofsight(coord, npc_coord) = false) {',
                '    p_aprange(3);',
                '    return;',
                '}',
                '[opnpc1,man]',
                'if (npc_range(coord) > 4) { p_aprange(4); return; }',
            ].join('\n'),
        ),
    );

    test("the least range an npc's approach triggers widen to, comments left out", () => {
        expect(range('barmaid', undefined)).toBe(2);
    });

    test("a category's range, unless the config has its own trigger for that op", () => {
        expect(range('teller', 'teller')).toBe(2);
        expect(range('own_teller', 'teller')).toBeUndefined();
    });

    test('none for a range not opened as written, nor for an op trigger', () => {
        expect(range('seer', undefined)).toBeUndefined();
        expect(range('man', undefined)).toBeUndefined();
    });
});

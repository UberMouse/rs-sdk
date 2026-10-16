import { describe, expect, test } from 'bun:test';
import { parseScript, type Script, type Stmt } from '../sources/runescript';

const parse = (body: string): Script => {
    const s = parseScript('x.rs2', 1, body);
    if ('error' in s) throw new Error(s.error);
    return s;
};

/** Each statement as its kind and text, nested ones indented. */
const shape = (stmts: readonly Stmt[], depth = 0): string[] =>
    stmts.flatMap(s => {
        const line = `${'  '.repeat(depth)}${s.t} ${s.t === 'def' ? s.names.join(',') : s.text}`;
        if (s.t === 'if')
            return [line, ...shape(s.yes, depth + 1), `${'  '.repeat(depth)}else`, ...shape(s.no, depth + 1)];
        if (s.t === 'while') return [line, ...shape(s.body, depth + 1)];
        return [line];
    });

describe('parseScript', () => {
    test('a proc header with its return types, an if without braces, and a varp assignment', () =>
        expect(shape(parse('(int $a)(boolean)\nif ($a = 1) %journey_number = $a;\nreturn(true);').body)).toEqual([
            'if if ($a = 1)',
            '  set %journey_number = $a;',
            'else',
            'return return',
        ]));

    test('a def with no value, several locals from one call, and a loop', () =>
        expect(
            shape(
                parse(
                    'def_int $option;\n$x, $z = ~door_open($angle, loc_shape);\nwhile ($x > 0) { $x = calc($x - 1); }',
                ).body,
            ),
        ).toEqual([
            'def $option',
            'def $x,$z',
            'while while ($x > 0) { $x = calc($x - 1); }',
            '  set $x = calc($x - 1);',
        ]));

    test('arithmetic binds tighter than comparison, and comparison than & and |', () => {
        const [s] = parse('if (2 * $a + 1 >= 3 & $b = 1 | $c) {}').body;
        expect(s?.t === 'if' && s.cond.t === 'bin' ? s.cond.op : '').toBe('|');
        const and = s?.t === 'if' && s.cond.t === 'bin' ? s.cond.l : undefined;
        expect(and?.t === 'bin' && and.op).toBe('&');
        const ge = and?.t === 'bin' ? and.l : undefined;
        expect(ge?.t === 'bin' && [ge.op, ge.l.text]).toEqual(['>=', '2 * $a + 1']);
    });

    test('component references, second-npc commands, digit-led config names, queue*, comments, quoted interpolations', () => {
        const { body } = parse(
            [
                'if_settext(ship_journey:com_0, "You sail.");',
                '~.chatnpc("<p,neutral>Hello <text_gender("sir", "madam")>.");',
                '.npc_say("x"); /* a block',
                'comment */ inv_add(inv, 1dose2strength, 1);',
                'queue*(hazeel_leave, 0)(npc_uid);',
                'switch_int ($a) { case 1 : mes("one"); case default : mes("other"); }',
            ].join('\n'),
        );
        expect(shape(body)).toEqual([
            // A string's text is blanked (classify.ts codeOf); its interpolations stay, quotes and all.
            'call if_settext(ship_journey:com_0, " ")',
            'call ~.chatnpc("<p,neutral> <text_gender("sir", "madam")> ")',
            'call .npc_say(" ")',
            'call inv_add(inv, 1dose2strength, 1)',
            'call queue*(hazeel_leave, 0)(npc_uid)',
            'switch switch_int ($a)',
        ]);
        const queue = body[4]?.t === 'call' ? body[4].call : undefined;
        expect(queue?.args?.map(a => a.text)).toEqual(['hazeel_leave', '0', 'npc_uid']);
    });

    test('a construct it does not read is named with its line', () =>
        expect(parseScript('x.rs2', 10, '\nmes("a");\n@@@;')).toEqual({ error: '`@` (x.rs2:12) is not read' }));
});

// Wield levels (phase 4 survey §1.10): `[opheld2,<obj>] @levelrequire_attack(40, last_slot);` in
// levelrequire/scripts/tier*.rs2. The labels and procs those call are in levelrequire/scripts/levelrequire.rs2: each
// checks `stat_base(<skill>) < <level>` and may first check a quest varp (`%dragonquest < ^dragon_complete`) or
// forward to another label with its arguments. This follows the calls with the arguments bound, so every label
// shape the scripts use is read from the scripts rather than listed here.
import { SKILLS, type Skill } from '../model/server';
import { blocks, type Block } from './triggers';

/** The scripts read: the tier files and levelrequire.rs2, by path relative to server/content/scripts. */
export const LEVELREQUIRE_DIR = 'levelrequire/scripts/';

export interface WieldRequirement {
    /** The base level each checked skill needs (`stat_base`, so boosts do not count). */
    levels: Partial<Record<Skill, number>>;
    /** The varps a quest check reads (`dragonquest`), when wielding needs a quest done too. */
    quests: string[];
    /** The `[opheld2,<obj>]` header's `file:line`. */
    at: string;
}

const OPHELD2 = /^\[opheld2,([a-z0-9_]+)\]$/;
const CALLABLE = /^\[(label|proc),([a-z0-9_]+)\]$/;

/**
 * Labels outside levelrequire/scripts that tier gates call, and the one line followed in each: the Tutorial Island
 * gate's other checks run only on the island, then it calls `@levelrequire_attack(1, $slot)`
 * (tutorial/scripts/tutorial.rs2:267-279).
 */
const OFF_ISLAND: Record<string, RegExp> = { '@tutorial_island_equip': /^@levelrequire_\w+\([^)]*\);/m };

/** A label's or proc's parameter names (`$level`), from the `(int $level, int $slot)` its header line ends with. */
const paramNames = (b: Block): string[] =>
    [...(b.body.match(/^\(([^)]*)\)/)?.[1] ?? '').matchAll(/\$(\w+)/g)].map(m => m[1]!);

/**
 * Every obj the levelrequire scripts gate, with what wielding it needs. Throws naming the file and line when a gate
 * calls a label or proc it cannot follow, checks a stat that is not a skill, or reads a varp other than as
 * `%var < ^const`.
 */
export function readWieldRequirements(scripts: readonly [file: string, text: string][]): Map<string, WieldRequirement> {
    const all = scripts.filter(([f]) => f.startsWith(LEVELREQUIRE_DIR)).flatMap(([f, text]) => blocks(f, text));
    const callables = new Map<string, Block>();
    for (const b of all) {
        const m = b.header.match(CALLABLE);
        if (m) callables.set((m[1] === 'label' ? '@' : '~') + m[2], b);
    }
    for (const [call, line] of Object.entries(OFF_ISLAND)) {
        const b = scripts.flatMap(([f, text]) => blocks(f, text)).find(x => x.header === `[label,${call.slice(1)}]`);
        const kept = b?.body.match(line);
        if (!b || !kept) throw new Error(`${call} no longer ends in a levelrequire call: re-read it`);
        callables.set(call, { ...b, body: `${b.body.match(/^\([^)]*\)/)?.[0] ?? ''}\n${kept[0]}` });
    }

    const walk = (b: Block, env: Map<string, number>, out: WieldRequirement, depth: number): void => {
        if (depth > 20) throw new Error(`${b.file}:${b.line}: levelrequire calls nest too deep`);
        const body = b.body.replace(/\/\/[^\n]*/g, '');
        for (const m of body.matchAll(/stat_base\((\w+)\)\s*<\s*(\$\w+|\d+)/g)) {
            const skill = m[1]!;
            const level = m[2]!.startsWith('$') ? env.get(m[2]!.slice(1)) : Number(m[2]);
            if (!(SKILLS as readonly string[]).includes(skill) || level === undefined)
                throw new Error(`${b.file}:${b.line}: cannot read the check ${m[0]}`);
            out.levels[skill as Skill] = Math.max(out.levels[skill as Skill] ?? 0, level);
        }
        // A varp read any other way than `%var < ^const` is a check this does not price: throw rather than drop it.
        for (const m of body.matchAll(/%\w+(\s*<\s*\^\w+)?/g)) {
            const varp = m[0].match(/^%(\w+)/)![1]!;
            if (!m[1]) {
                const line = b.line + body.slice(0, m.index).split('\n').length - 1;
                throw new Error(`${b.file}:${line}: cannot read the varp check on %${varp}`);
            }
            if (!out.quests.includes(varp)) out.quests.push(varp);
        }
        // A proc that takes no arguments is called without parentheses: `if (~levelrequire_dragon_slayer_quest = false)`.
        for (const m of body.matchAll(/([@~])(\w+)(?:\(([^)]*)\))?/g)) {
            const call = m[1]! + m[2]!;
            // `~equip` wields the obj once every check has passed: it is in player/scripts/equip.rs2 and checks nothing.
            if (call === '~equip') continue;
            const callee = callables.get(call);
            if (!callee) throw new Error(`${b.file}:${b.line}: levelrequire calls ${call}, which it cannot follow`);
            const args = (m[3] ?? '').split(',').map(a => a.trim());
            const bound = new Map<string, number>();
            paramNames(callee).forEach((p, i) => {
                const a = args[i];
                const v = a?.startsWith('$') ? env.get(a.slice(1)) : /^\d+$/.test(a ?? '') ? Number(a) : undefined;
                if (v !== undefined) bound.set(p, v);
            });
            walk(callee, bound, out, depth + 1);
        }
    };

    const out = new Map<string, WieldRequirement>();
    for (const b of all) {
        const m = b.header.match(OPHELD2);
        if (!m) continue;
        const req: WieldRequirement = { levels: {}, quests: [], at: `${b.file}:${b.line}` };
        walk(b, new Map(), req, 0);
        out.set(m[1]!, req);
    }
    return out;
}

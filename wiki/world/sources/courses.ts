// The agility courses' laps, read from their scripts. A course keeps its lap in a progress varp through one proc,
// as skill_agility/scripts/gnome_course.rs2:103-110 writes it:
//
//     [proc,update_gnome_varp](int $completed)
//     if(calc(%gnome_course_progress + 1) >= $completed) { %gnome_course_progress = $completed; }
//     if(%gnome_course_progress = 7) { stat_advance(agility, 390); %gnome_course_progress = 0; }
//
// Each obstacle's loc trigger calls it with its own place in the lap (`~update_gnome_varp(3)`), so an obstacle
// moves the lap on only when it is the next one (an earlier one sets it back to that one), and the last pays the lap
// bonus.
import { codeOf } from '../classify';
import type { Tile } from '../types';
import type { Callable, Trigger } from './triggers';
import { cmp } from '../util';
import { parseCoord } from './zones';

/** One trigger that moves a course's lap on: the op on a loc config (or category) and the step it sets. */
export interface CourseStep {
    /** The trigger's subject: a loc config, or a category with `category`. */
    target: string;
    category: boolean;
    /** The trigger's op slot ('1'-'5'). */
    op: string;
    /** The progress the call sets: the obstacle's place in the lap, from 1. */
    step: number;
    /**
     * The call runs only for the placement on this tile (`if (loc_coord = <coord>)`, the Barbarian course's last
     * crumbling wall, barbarian_course.rs2:121): the config's other placements set no step.
     */
    at?: Tile;
    /** The call, as `file:line`. */
    source: string;
}

export interface CourseDef {
    /** The progress varp without its `_course_progress` (`gnome`): the course's subtype. */
    course: string;
    /** The progress varp (`gnome_course_progress`). */
    varp: string;
    /** The step that completes the lap (the proc's `%varp = <n>`): steps run 1 to this. */
    laps: number;
    /** The lap bonus in xp tenths, the proc's `stat_advance(agility, <n>)`. */
    lapBonus: number;
    /** The bonus's stat_advance, as `file:line`. */
    source: string;
    /** By step, then trigger subject. */
    steps: CourseStep[];
}

const LAP_RULE = /if\s*\(\s*calc\(\s*%([a-z0-9_]+)\s*\+\s*1\s*\)\s*>=\s*\$([a-z0-9_]+)\s*\)/;
const LAP_END = /if\s*\(\s*%([a-z0-9_]+)\s*=\s*(\d+)\s*\)\s*\{([^}]*)\}/;
const BONUS = /\bstat_advance\(\s*agility\s*,\s*(\d+)\s*\)/;
const GUARD = /if\s*\(\s*loc_coord\s*=\s*(\d+_\d+_\d+_\d+_\d+)\s*\)\s*$/;

/** The line of `code[index]`, the code (codeOf, which keeps the lines) starting on line `line`. */
const lineAt = (line: number, code: string, index: number): number =>
    line + code.slice(0, index).split('\n').length - 1;

/** The `{` positions of the blocks enclosing `body[index]`, outermost first. */
function enclosing(body: string, index: number): number[] {
    const open: number[] = [];
    for (let i = 0; i < index; i++) {
        if (body[i] === '{') open.push(i);
        else if (body[i] === '}') open.pop();
    }
    return open;
}

interface Lap {
    proc: string;
    varp: string;
    laps: number;
    lapBonus: number;
    source: string;
}

/** A proc that keeps a lap as the file comment shows: the next-step rule, then the bonus and reset at the last step. */
function lapOf(c: Callable): Lap | undefined {
    if (!c.call.startsWith('~')) return undefined;
    const code = codeOf(c.body);
    const rule = code.match(LAP_RULE);
    const end = code.match(LAP_END);
    if (!rule || !end || end[1] !== rule[1]) return undefined;
    const bonus = end[3]!.match(BONUS);
    if (!bonus || !new RegExp(`%${end[1]}\\s*=\\s*0\\b`).test(end[3]!)) return undefined;
    const at = end.index! + end[0].indexOf(bonus[0]);
    return {
        proc: c.call,
        varp: end[1]!,
        laps: Number(end[2]),
        lapBonus: Number(bonus[1]),
        source: `${c.file}:${lineAt(c.line, code, at)}`,
    };
}

/**
 * Every course: each proc that keeps a lap, and the loc op triggers whose body, or a label or proc it calls (followed
 * through), calls it with a step. A call inside a block other than a `loc_coord` guard throws, as which placements it
 * runs for is then unread.
 */
export function readCourses(triggers: readonly Trigger[], callables: readonly Callable[]): CourseDef[] {
    const laps = callables.flatMap(c => lapOf(c) ?? []);
    if (!laps.length) return [];
    const byCall = new Map(callables.map(c => [c.call, c]));
    const lapCalls = new Set(laps.map(l => l.proc));
    const steps = new Map<string, CourseStep[]>(laps.map(l => [l.proc, []]));
    for (const t of triggers) {
        if (t.on !== 'loc' || t.kind !== 'op') continue;
        const bodies: { file: string; line: number; body: string }[] = [t];
        const seen = new Set<string>();
        for (let i = 0; i < bodies.length; i++) {
            const { file, line, body } = bodies[i]!;
            const code = codeOf(body);
            for (const m of code.matchAll(/([@~][a-z0-9_]+)\(\s*(\d+)\s*\)|[@~][a-z0-9_]+|\bjump\(([a-z0-9_]+)\)/g)) {
                const call = m[3] ? `@${m[3]}` : (m[1] ?? m[0]);
                if (lapCalls.has(call) && m[2] !== undefined) {
                    const guards = enclosing(code, m.index).map(open => code.slice(0, open).match(GUARD)?.[1]);
                    const source = `${file}:${lineAt(line, code, m.index)}`;
                    if (guards.some(g => g === undefined))
                        throw new Error(`${source}: ${call}(${m[2]}) is inside a block that is not a loc_coord guard`);
                    const at = guards.at(-1);
                    steps.get(call)!.push({
                        target: t.target,
                        category: t.category,
                        op: t.op,
                        step: Number(m[2]),
                        ...(at === undefined ? {} : { at: parseCoord(at) }),
                        source,
                    });
                    continue;
                }
                const callee = byCall.get(call);
                if (!callee || lapCalls.has(call) || seen.has(call)) continue;
                seen.add(call);
                bodies.push(callee);
            }
        }
    }
    return laps
        .map(l => ({
            course: l.varp.replace(/_course_progress$/, ''),
            varp: l.varp,
            laps: l.laps,
            lapBonus: l.lapBonus,
            source: l.source,
            steps: steps.get(l.proc)!.sort((a, b) => a.step - b.step || cmp(a.target, b.target)),
        }))
        .sort((a, b) => cmp(a.course, b.course));
}

/**
 * The step a placed loc sets on a course: its config's own trigger or its category's, at its tile when the call is
 * guarded; undefined when it sets none. Throws when it would set two.
 */
export function stepAt(
    course: CourseDef,
    config: string,
    category: string | undefined,
    tile: Tile,
): CourseStep | undefined {
    const hits = course.steps.filter(
        s =>
            (s.category ? s.target === category : s.target === config) &&
            (!s.at || (s.at.level === tile.level && s.at.x === tile.x && s.at.z === tile.z)),
    );
    if (new Set(hits.map(h => h.step)).size > 1)
        throw new Error(
            `${config} at (${tile.x}, ${tile.z}) sets steps ${hits.map(h => h.step).join(', ')} of ${course.course}`,
        );
    return hits[0];
}

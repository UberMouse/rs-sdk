import { describe, expect, test } from 'bun:test';
import { readCourses, stepAt } from '../sources/courses';
import { parseCallables, parseTriggers } from '../sources/triggers';

// A course written as gnome_course.rs2 and barbarian_course.rs2 write theirs: a lap proc, obstacles calling it
// directly, through a label, and once behind a loc_coord guard.
const COURSE = `[oploc1,log]
p_arrivedelay;
~update_test_varp(1);

[oploc1,branch] @climb_branch;
[label,climb_branch]
mes("You climb the tree ~update_test_varp(9)...");
// ~update_test_varp(8);
~update_test_varp(2);

[oploc1,wall]
if(coordx(coord) > coordx(loc_coord)) {
    return;
}
stat_advance(agility, 125);
if(loc_coord = 0_39_55_46_33) {
    ~update_test_varp(3);
}

[oploc1,_rope_category]
~update_test_varp(3);

[proc,update_test_varp](int $completed)
if(calc(%test_course_progress + 1) >= $completed) {
    %test_course_progress = $completed;
}
if(%test_course_progress = 3) {
    stat_advance(agility, 420);
    %test_course_progress = 0;
}

[proc,not_a_lap](int $n)
%other = $n;
`;

const FILE = 'skill_agility/scripts/test_course.rs2';
const tile = (x: number, z: number) => ({ level: 0, x, z });
const read = (text: string) => readCourses(parseTriggers(FILE, text), parseCallables(FILE, text));

describe('readCourses', () => {
    test('a lap proc: its varp, last step and bonus; its steps from every trigger reaching it, by step', () => {
        const [course, ...more] = read(COURSE);
        expect(more).toEqual([]);
        expect(course).toEqual({
            course: 'test',
            varp: 'test_course_progress',
            laps: 3,
            lapBonus: 420,
            source: `${FILE}:28`,
            steps: [
                { target: 'log', category: false, op: '1', step: 1, source: `${FILE}:3` },
                // Through the label; the call in its string and the commented one are not calls.
                { target: 'branch', category: false, op: '1', step: 2, source: `${FILE}:9` },
                { target: 'rope_category', category: true, op: '1', step: 3, source: `${FILE}:21` },
                // 0_39_55_46_33 is (39 * 64 + 46, 55 * 64 + 33).
                {
                    target: 'wall',
                    category: false,
                    op: '1',
                    step: 3,
                    at: { level: 0, x: 2542, z: 3553 },
                    source: `${FILE}:17`,
                },
            ],
        });
    });

    test('a step inside any other block throws: which placements it runs for is unread', () => {
        const text = COURSE.replace('if(loc_coord = 0_39_55_46_33) {', 'if(stat(agility) > 5) {');
        expect(() => read(text)).toThrow(
            `${FILE}:17: ~update_test_varp(3) is inside a block that is not a loc_coord guard`,
        );
    });

    test('no lap proc, no course', () => expect(read(COURSE.replace('%test_course_progress = 0;', ''))).toEqual([]));

    test('stepAt: by config or category, a guarded step only on its tile', () => {
        const [course] = read(COURSE);
        expect(stepAt(course!, 'log', undefined, tile(1, 1))?.step).toBe(1);
        expect(stepAt(course!, 'rope', 'rope_category', tile(1, 1))?.step).toBe(3);
        expect(stepAt(course!, 'rope_category', undefined, tile(1, 1))).toBeUndefined();
        expect(stepAt(course!, 'wall', undefined, tile(2542, 3553))?.step).toBe(3);
        expect(stepAt(course!, 'wall', undefined, tile(2539, 3553))).toBeUndefined();
        expect(stepAt(course!, 'wall', undefined, { level: 1, x: 2542, z: 3553 })).toBeUndefined();
    });

    test('stepAt throws on a placement that would set two steps', () => {
        const [course] = read(COURSE.replace('[oploc1,_rope_category]', '[oploc2,log]'));
        expect(() => stepAt(course!, 'log', undefined, { level: 0, x: 1, z: 1 })).toThrow('sets steps 1, 3 of test');
    });
});

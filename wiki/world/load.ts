// Reads wiki/world.json, which build.ts writes, as a typed World. The file is generated and committed,
// so a reader needs neither the game data nor the collision data the build loads.
import { readFileSync } from 'fs';
import { contentHash } from './content-hash';
import { WORLD_JSON } from './paths';
import { WORLD_FORMAT, type World } from './types';

/** A parsed JSON object, its fields not yet checked. */
type Parsed = { [key: string]: unknown };

const isObject = (x: unknown): x is Parsed => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Whether `x` is a world.json of this format: its format, a string generatedFrom, the ten lists and
 * the loadoutRules object. Their items are taken as build.ts wrote them, but for the crossing model's fields
 * (crossingModelProblem).
 */
const isWorld = (x: Parsed): x is Parsed & World =>
    x.format === WORLD_FORMAT &&
    typeof x.generatedFrom === 'string' &&
    [
        x.areas,
        x.features,
        x.sites,
        x.npcSpawns,
        x.connectors,
        x.quests,
        x.transports,
        x.gates,
        x.crossings,
        x.methods,
    ].every(Array.isArray) &&
    isObject(x.loadoutRules);

const isInt = (x: unknown): x is number => Number.isInteger(x);
const isCount = (x: unknown): x is number => isInt(x) && x >= 0;
const isOp = (x: unknown): boolean => isInt(x) && x >= 1 && x <= 5;
const isName = (x: unknown): boolean => typeof x === 'string' && x !== '';
const isTile = (x: unknown): boolean => isObject(x) && isInt(x.level) && isInt(x.x) && isInt(x.z);
const isSets = (x: unknown): x is string[][] =>
    Array.isArray(x) && x.every(set => Array.isArray(set) && set.every(r => typeof r === 'string'));

/** Whether an act's `choices` are absent or option texts. */
const isChoices = (x: unknown): boolean => x === undefined || (Array.isArray(x) && x.every(isName));

/** What is wrong with an Act, or undefined. */
function actProblem(a: unknown): string | undefined {
    if (!isObject(a)) return 'an act that is not an object';
    switch (a.kind) {
        case 'loc-op':
            return isName(a.loc) && isOp(a.op) && isChoices(a.choices)
                ? undefined
                : 'a loc-op act needs a loc, an op 1-5, and choices, when it has them, as option texts';
        case 'item-on-loc':
            return isName(a.loc) && isName(a.obj) !== isName(a.category)
                ? undefined
                : 'an item-on-loc act needs a loc and one of an obj or a category';
        case 'npc-op':
            return isName(a.npc) && isOp(a.op) && isChoices(a.choices)
                ? undefined
                : 'an npc-op act needs an npc, an op 1-5, and choices, when it has them, as option texts';
        case 'item-op':
            return isName(a.obj) && isOp(a.op) ? undefined : 'an item-op act needs an obj and an op 1-5';
        case 'interface':
            return isName(a.component) ? undefined : 'an interface act needs a component';
        default:
            return `an act of kind ${JSON.stringify(a.kind)}`;
    }
}

/** What is wrong with a Roll, or undefined. */
function rollProblem(r: unknown): string | undefined {
    if (!isObject(r)) return 'a roll that is not an object';
    if (!isName(r.stat) || !isInt(r.low) || !isInt(r.high) || !isName(r.source))
        return 'a roll needs a stat, whole low and high bounds, and a source';
    const f = r.fail;
    if (!isObject(f) || !isCount(f.ticks) || !isCount(f.damage)) return "a roll's fail needs ticks and damage";
    if (f.to !== undefined && !isTile(f.to)) return "a roll's fail.to is not a tile";
    if (f.back !== undefined && (f.to === undefined || !isCount(f.back)))
        return "a roll's fail.back is run ticks from its fail.to";
    return undefined;
}

/** What is wrong with a World.crossings row, or undefined. */
function crossingProblem(c: unknown): string | undefined {
    if (!isObject(c)) return 'not an object';
    if (c.via !== 'scripted' && c.via !== 'teleport') return `a via of ${JSON.stringify(c.via)}`;
    const act = actProblem(c.act);
    if (act) return act;
    if (!isTile(c.at)) return 'its at is not a tile';
    if (!Array.isArray(c.from) || !c.from.every(isTile)) return 'its from is not a list of tiles';
    if (!Array.isArray(c.landings) || !c.landings.length) return 'no landings';
    for (const l of c.landings)
        if (!isObject(l) || !isTile(l.tile) || (l.spread !== undefined && !isCount(l.spread)))
            return 'a landing needs a tile, and spread, when it has one, as run ticks';
    if (!isSets(c.requires)) return 'its requires is not a list of requirement sets';
    if (!c.requires.length) return 'its requires has no set, so nothing makes the move ([[]] asks for nothing)';
    const roll = c.roll === undefined ? undefined : rollProblem(c.roll);
    if (roll) return roll;
    return isName(c.source) ? undefined : 'no source';
}

/** A gate trigger's op (`oploc1,x` -> 1); undefined for a use-item trigger. */
const opOfTrigger = (trigger: unknown): number | undefined => {
    const m = typeof trigger === 'string' ? trigger.match(/^(?:op|ap)loc([1-5]),/) : null;
    return m ? Number(m[1]) : undefined;
};

/**
 * What is wrong with a World.gates row's crossing-model fields (its roll, act, landings and oneWay, and a gate's
 * requires), or undefined.
 */
function gateProblem(g: Parsed): string | undefined {
    // A quest window's requires is [], never met; a gate's has the sets that open it.
    if (g.kind === 'gate' && Array.isArray(g.requires) && !g.requires.length)
        return 'a gate whose requires has no set, so nothing opens it ([[]] asks for nothing)';
    const roll = g.roll === undefined ? undefined : rollProblem(g.roll);
    if (roll) return roll;
    if (g.oneWay !== undefined && (g.oneWay !== true || g.from === undefined))
        return 'oneWay, when it has it, is true, on a row with from';
    if (g.act !== undefined) {
        const act = actProblem(g.act);
        if (act) return act;
        const a = g.act as Parsed;
        if (a.kind !== 'loc-op' || a.loc !== g.loc || a.op !== opOfTrigger(g.trigger))
            return "its act is not a loc-op of the row's loc and its trigger's op";
    }
    if (g.landings !== undefined) {
        if (!Array.isArray(g.landings)) return 'its landings is not a list';
        for (const l of g.landings)
            if (!isObject(l) || !isTile(l.stand) || !isTile(l.landing) || (l.free !== undefined && l.free !== true))
                return 'a landing needs a stand and a landing tile, and free, when it has it, as true';
    }
    return undefined;
}

/**
 * What is wrong with a World.sites row's course, or undefined: an `agility-course` site has one, and no other site
 * does; its obstacles are features of `features`, in lap order from step 1.
 */
function courseProblem(s: Parsed, features: number): string | undefined {
    if ((s.kind === 'agility-course') !== (s.course !== undefined))
        return 'an agility-course site, and only one, has a course';
    if (s.course === undefined) return undefined;
    const c = s.course;
    if (!isObject(c) || !isName(c.varp) || !isCount(c.lapBonus) || !isName(c.source))
        return 'a course needs a varp, a lap bonus and a source';
    if (!Array.isArray(c.obstacles) || !c.obstacles.length) return 'a course with no obstacles';
    let last = 0;
    for (const o of c.obstacles) {
        if (
            !isObject(o) ||
            !isCount(o.feature) ||
            o.feature >= features ||
            !isName(o.loc) ||
            !isTile(o.tile) ||
            !isName(o.source)
        )
            return "a course's obstacle needs a feature, a loc, a tile and a source";
        if (!isInt(o.step) || o.step < 1 || (o.step !== last && o.step !== last + 1))
            return "a course's obstacles are in lap order from step 1, with no step missed";
        last = o.step;
    }
    return undefined;
}

/** The first malformed crossing-model field of `world`, or site course, as `<list>[<i>]: <what>`, or undefined. */
function crossingModelProblem(world: World): string | undefined {
    const rows: [string, readonly unknown[], (x: Parsed) => string | undefined][] = [
        ['sites', world.sites, s => courseProblem(s, world.features.length)],
        ['crossings', world.crossings, crossingProblem],
        ['gates', world.gates, gateProblem],
        ['transports', world.transports, t => (t.act === undefined ? undefined : actProblem(t.act))],
    ];
    for (const [list, items, problem] of rows)
        for (const [i, item] of items.entries()) {
            const why = isObject(item) ? problem(item) : 'not an object';
            if (why) return `${list}[${i}]: ${why}`;
        }
    return undefined;
}

/** The world in `file` (default wiki/world.json); throws when it is not a world.json of this format. */
export function loadWorld(file: string = WORLD_JSON): World {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        throw new Error(`${file} is not valid JSON (${e.message}): regenerate it with bun run world`, { cause: e });
    }
    const world: Parsed = isObject(parsed) ? parsed : {};
    if (world.format !== WORLD_FORMAT)
        throw new Error(
            `${file} has format ${String(world.format ?? 'none')}, this code reads format ${WORLD_FORMAT}: regenerate it with bun run world`,
        );
    if (!isWorld(world))
        throw new Error(
            `${file} is not a world.json: it needs generatedFrom, areas, features, sites, npcSpawns, connectors, quests, loadoutRules, transports, gates, crossings and methods`,
        );
    const problem = crossingModelProblem(world);
    if (problem) throw new Error(`${file} is not a world.json: ${problem}: regenerate it with bun run world`);
    return world;
}

/**
 * The world in `file`, refusing one built from other game data than server/content holds now (`hash`,
 * default contentHash()): its locations would be stale. The generators of wiki/npcs and wiki/shops
 * read it through here.
 */
export function loadFreshWorld(file: string = WORLD_JSON, hash: () => string = contentHash): World {
    const world = loadWorld(file);
    const now = hash();
    if (world.generatedFrom !== now)
        throw new Error(
            `${file} was built from server/content at ${world.generatedFrom}, which is now at ${now} ` +
                `(server/content may have uncommitted changes): regenerate it with bun run world`,
        );
    return world;
}

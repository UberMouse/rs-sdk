// Generic stop conditions the conductor attaches to any task, so tasks don't
// each re-implement "until level X" / "for N minutes".
import type { BotWorldState } from '../../sdk/types';

export type StopCondition =
    | { kind: 'level'; skill: string; level: number }
    | { kind: 'xp'; skill: string; amount: number }
    | { kind: 'minutes'; minutes: number };

/** Parse `level:woodcutting:15`, `xp:woodcutting:500`, `minutes:5`. */
export function parseStop(spec: string): StopCondition {
    const parts = spec.split(':');
    const n = Number(parts[parts.length - 1]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`bad --until "${spec}": last part must be a positive number`);
    switch (parts[0]) {
        case 'level':
            if (parts.length !== 3) break;
            return { kind: 'level', skill: parts[1]!, level: n };
        case 'xp':
            if (parts.length !== 3) break;
            return { kind: 'xp', skill: parts[1]!, amount: n };
        case 'minutes':
            if (parts.length !== 2) break;
            return { kind: 'minutes', minutes: n };
    }
    throw new Error(`bad --until "${spec}": expected level:<skill>:<n>, xp:<skill>:<n> or minutes:<n>`);
}

export function describeStop(c: StopCondition): string {
    switch (c.kind) {
        case 'level': return `${c.skill} level ${c.level}`;
        case 'xp': return `+${c.amount} ${c.skill} xp`;
        case 'minutes': return `${c.minutes} min`;
    }
}

const skill = (s: BotWorldState, name: string) =>
    s.skills.find(k => k.name.toLowerCase() === name.toLowerCase());

/** Returns a reason when any condition is met, else null. */
export function checkStops(
    stops: StopCondition[],
    state: BotWorldState,
    xpBefore: Record<string, number>,
    startedAt: number,
): string | null {
    for (const c of stops) {
        if (c.kind === 'minutes' && Date.now() - startedAt >= c.minutes * 60_000) {
            return `reached ${describeStop(c)}`;
        }
        if (c.kind === 'level') {
            const k = skill(state, c.skill);
            if (k && k.baseLevel >= c.level) return `reached ${describeStop(c)}`;
        }
        if (c.kind === 'xp') {
            const k = skill(state, c.skill);
            if (k && k.experience - (xpBefore[k.name] ?? k.experience) >= c.amount) return `reached ${describeStop(c)}`;
        }
    }
    return null;
}

/** Fail fast on a typo'd skill name rather than running forever. */
export function validateStops(stops: StopCondition[], state: BotWorldState): void {
    for (const c of stops) {
        if ((c.kind === 'level' || c.kind === 'xp') && !skill(state, c.skill)) {
            throw new Error(`unknown skill "${c.skill}" in --until; skills: ${state.skills.map(s => s.name).join(', ')}`);
        }
    }
}

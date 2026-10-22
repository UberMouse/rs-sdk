// Config params with their defaults: a config's `param=key,value` line, else the `default=` of the key's `.param`
// file (skill_combat/configs/combat.param, npc_combat.param, skill_prayer/configs/bones.param ...), as `npc_param`
// and `oc_param` read them. A value that names a constant (`param=damagetype,^stab_style`) is read from the constants.
import type { Config } from '../sources/configs';
import { first } from '../sources/configs';
import { constantInt, type Constant } from '../sources/constants';
import { ModelError } from './family';
import { param } from './families/common';

/** The `.param` configs by key and the constants, which a param's value or default may name. */
export interface ParamData {
    params: ReadonlyMap<string, Config>;
    constants: ReadonlyMap<string, Constant>;
}

/** `key`'s value on `cfg`, else its `.param` default; throws a ModelError naming `what` when the game has no such param. */
export function paramValue(cfg: Config, key: string, data: ParamData, what: string): string {
    const own = param(cfg, key);
    if (own !== undefined) return own;
    const def = data.params.get(key);
    if (!def) throw new ModelError(`${what}: the game has no param ${key}`);
    const v = first(def, 'default');
    if (v === undefined) throw new ModelError(`${what}: param ${key} has no default`);
    return v;
}

/** An int param: a whole number, or a `^constant` holding one. Throws a ModelError naming `what` otherwise. */
export function paramInt(cfg: Config, key: string, data: ParamData, what: string): number {
    const v = paramValue(cfg, key, data, what);
    const n = /^-?\d+$/.test(v) ? Number(v) : v.startsWith('^') ? constantInt(data.constants, v) : undefined;
    if (n === undefined) throw new ModelError(`${what} has no whole number in ${key} (${v})`);
    return n;
}

/** A namedobj (or other name) param; `null`, the scripts' none, is undefined. */
export function paramName(cfg: Config, key: string, data: ParamData, what: string): string | undefined {
    const v = paramValue(cfg, key, data, what);
    return v === 'null' ? undefined : v;
}

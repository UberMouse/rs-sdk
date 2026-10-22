// What the combat model reads about an NPC (phase 4 survey §1.5): its config stats, its combat params with their
// `.param` defaults, how it hunts, how fast it respawns, and whether a script overrides its default melee AI. Paths
// are under server/content/scripts/ unless they name the engine. The engine's defaults for a config line the npc
// leaves out are read from NpcType.ts and the packer when the module loads, as server.ts reads its defaults.
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENGINE_SRC, ROOT } from '../paths';
import { first, type Config } from '../sources/configs';
import type { Constant } from '../sources/constants';
import { blocks } from '../sources/triggers';
import { ModelError } from './family';
import { paramInt, paramName, type ParamData } from './params';
import { readDefault, type ServerDefault } from './server';

/** The damage types an NPC defends against by its own param (npc_combat.rs2:345-351), by `^<type>_style` stem. */
export const DAMAGE_TYPES = ['stab', 'slash', 'crush', 'ranged', 'magic'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** The npc param each damage type's defence bonus is read from: `~npc_combat_defencebonus` (npc_combat.rs2:345-351). */
const DEFENCE_PARAM: Record<DamageType, string> = {
    stab: 'stabdefence',
    slash: 'slashdefence',
    crush: 'crushdefence',
    ranged: 'rangedefence',
    magic: 'magicdefence',
};

/** The file the `^<type>_style` damage-type constants are in. */
export const DAMAGE_TYPE_SOURCE = 'skill_combat/configs/combat_damagetypes.constant';

/**
 * A damage-type value (`^crush_style`, or the number it holds: npc_combat.param's damagetype default is `2`) as its
 * name, by the `^<type>_style` constant in combat_damagetypes.constant holding that number. Throws a ModelError naming
 * `what` for a value no constant there holds, or one no NPC defence param covers (`^melee_style`).
 */
export function damageType(value: string, constants: ReadonlyMap<string, Constant>, what: string): DamageType {
    const n = value.startsWith('^') ? constants.get(value)?.value : value;
    const names = [...constants]
        .filter(([name, c]) => c.at.startsWith(`${DAMAGE_TYPE_SOURCE}:`) && c.value === n && /^\^\w+_style$/.test(name))
        .map(([name]) => name.slice(1, -'_style'.length));
    const name = names.length === 1 ? names[0] : undefined;
    if (!name || !(DAMAGE_TYPES as readonly string[]).includes(name))
        throw new ModelError(`${what} has damage type ${value}, which is none of ${DAMAGE_TYPES.join(', ')}`);
    return name as DamageType;
}

/** A script that replaces the default melee AI for an NPC: the trigger and its header's `file:line`. */
export interface AiOverride {
    trigger: 'ai_opplayer2' | 'ai_applayer2';
    at: string;
}

export interface NpcCombat {
    npc: string;
    /** Config `attack=` ... `magic=`, each the engine's default when the config sets none. */
    levels: Record<'attack' | 'defence' | 'strength' | 'hitpoints' | 'ranged' | 'magic', number>;
    /** `attackbonus`: NPCs have one attack bonus (npc_combat_melee.rs2:12-13). */
    attackBonus: number;
    strengthBonus: number;
    /** The defence bonus against each damage type. */
    defenceBonus: Record<DamageType, number>;
    /** Ticks between its swings: `%npc_action_delay = clock + attackrate` (npc_combat_melee.rs2:30-39). */
    attackRate: number;
    damageType: DamageType;
    /** Config `huntmode=` (an `all.hunt` entry: `cowardly`, `aggressive_melee` ...), undefined when it sets none. */
    huntMode: string | undefined;
    huntRange: number;
    /**
     * Its shown combat level; `vislevel=hide` is 0. A hunt mode with `check_nottoostrong=outside_wilderness` skips a
     * player whose combat level is above twice it outside the Wilderness (engine/entity/Npc.ts:1011).
     */
    visLevel: number;
    /** Config `respawnrate=` in ticks, before the engine's player-count scaling. */
    respawnRate: number;
    /** `death_drop`, what `npc_default_death` drops (npc_combat.rs2:96-99); undefined for `null`. */
    deathDrop: string | undefined;
    /** `max_dealt`: caps a player's max hit on it (`min($maxhit, npc_param(max_dealt))`, npc_combat.rs2:438). */
    maxDealt: number;
    /** `combat_xp_multiplier`, 1000 for 1x. */
    xpMultiplier: number;
    category: string | undefined;
    /** The scripts that replace the default melee AI for it, one per trigger at most; empty when it has the default. */
    aiOverrides: AiOverride[];
}

/** An npc's NpcCombat; throws a ModelError naming it when the game has no such npc. */
export type NpcCombats = (npc: string) => NpcCombat;

/** The engine default each npc config line falls back to, and where it is read from. */
export interface NpcDefaults {
    /** Every stat (NpcType.ts `stats = [1, 1, 1, 1, 1, 1]`). */
    stat: ServerDefault;
    huntRange: ServerDefault;
    respawnRate: ServerDefault;
    /** The packer writes this vislevel for a config with no `vislevel=` (tools/pack/config/NpcConfig.ts). */
    visLevel: ServerDefault;
}

const NPC_TYPE = 'cache/config/NpcType.ts';
const NPC_CONFIG = join(ROOT, 'server', 'engine', 'tools', 'pack', 'config', 'NpcConfig.ts');

/** The packer's fallback: `if (!vislevel) { ... client.p1(95); client.p2(<n>); }` (95 is the vislevel opcode). */
export function readVisLevelDefault(file: string, text: string): ServerDefault {
    const m = text.match(/if \(!vislevel\) \{[^}]*?client\.p1\(95\);\s*client\.p2\((\d+)\);/);
    if (!m) throw new Error(`Expected the vislevel fallback in ${file}: has it moved?`);
    return { value: Number(m[1]), at: `${file}:${text.slice(0, m.index).split('\n').length}` };
}

function readNpcDefaults(): NpcDefaults {
    const npcType = readFileSync(join(ENGINE_SRC, NPC_TYPE), 'utf8');
    return {
        stat: readDefault(NPC_TYPE, npcType, /^\s*stats = \[(\d+), \1, \1, \1, \1, \1\];/),
        huntRange: readDefault(NPC_TYPE, npcType, /^\s*huntrange = (\d+);/),
        respawnRate: readDefault(NPC_TYPE, npcType, /^\s*respawnrate = (\d+);/),
        visLevel: readVisLevelDefault('tools/pack/config/NpcConfig.ts', readFileSync(NPC_CONFIG, 'utf8')),
    };
}

export const NPC_DEFAULTS = readNpcDefaults();

const AI_TRIGGER = /^\[(ai_opplayer2|ai_applayer2),(_?)([a-z0-9][a-z0-9_]*)\]$/;

/**
 * The `[ai_opplayer2,<subject>]` and `[ai_applayer2,<subject>]` scripts, by `<trigger> <subject>`, the subject
 * `_<category>` for a category's. The global `[ai_opplayer2,_]` (npc_combat.rs2:4, the default melee AI) is left out.
 */
function aiTriggers(scripts: readonly [file: string, text: string][]): Map<string, AiOverride> {
    const out = new Map<string, AiOverride>();
    for (const [file, text] of scripts)
        for (const b of blocks(file, text)) {
            const m = b.header.match(AI_TRIGGER);
            if (m)
                out.set(`${m[1]} ${m[2]}${m[3]}`, {
                    trigger: m[1] as AiOverride['trigger'],
                    at: `${file}:${b.line}`,
                });
        }
    return out;
}

/** A config's whole-number line, or `fallback` when it has none; throws a ModelError naming `what` for a non-number. */
function configInt(cfg: Config, key: string, fallback: number, what: string): number {
    const v = first(cfg, key);
    if (v === undefined) return fallback;
    if (!/^-?\d+$/.test(v)) throw new ModelError(`${what} has no whole number in ${key} (${v})`);
    return Number(v);
}

export function readNpcCombat(
    data: ParamData & {
        npcs: ReadonlyMap<string, Config>;
        scripts: readonly [file: string, text: string][];
    },
    defaults: NpcDefaults = NPC_DEFAULTS,
): NpcCombats {
    const ai = aiTriggers(data.scripts);
    return npc => {
        const cfg = data.npcs.get(npc);
        if (!cfg) throw new ModelError(`no npc ${npc}`);
        const what = `npc ${npc}`;
        const int = (key: string) => paramInt(cfg, key, data, what);
        const stat = (key: string) => configInt(cfg, key, defaults.stat.value, what);
        const vis = first(cfg, 'vislevel');
        const category = first(cfg, 'category');
        // The engine runs the npc's own trigger, else its category's, else the global one (ScriptProvider.ts:124-134).
        const aiOverrides = (['ai_opplayer2', 'ai_applayer2'] as const).flatMap(t => {
            const own = ai.get(`${t} ${npc}`) ?? (category === undefined ? undefined : ai.get(`${t} _${category}`));
            return own ? [own] : [];
        });
        return {
            npc,
            levels: {
                attack: stat('attack'),
                defence: stat('defence'),
                strength: stat('strength'),
                hitpoints: stat('hitpoints'),
                ranged: stat('ranged'),
                magic: stat('magic'),
            },
            attackBonus: int('attackbonus'),
            strengthBonus: int('strengthbonus'),
            defenceBonus: Object.fromEntries(DAMAGE_TYPES.map(t => [t, int(DEFENCE_PARAM[t])])) as Record<
                DamageType,
                number
            >,
            attackRate: int('attackrate'),
            damageType: damageType(paramName(cfg, 'damagetype', data, what) ?? '', data.constants, what),
            huntMode: first(cfg, 'huntmode'),
            huntRange: configInt(cfg, 'huntrange', defaults.huntRange.value, what),
            // NpcConfig.ts:154-156 packs `vislevel=hide` as 0.
            visLevel: vis === 'hide' ? 0 : configInt(cfg, 'vislevel', defaults.visLevel.value, what),
            respawnRate: configInt(cfg, 'respawnrate', defaults.respawnRate.value, what),
            deathDrop: paramName(cfg, 'death_drop', data, what),
            maxDealt: int('max_dealt'),
            xpMultiplier: int('combat_xp_multiplier'),
            category,
            aiOverrides,
        };
    };
}

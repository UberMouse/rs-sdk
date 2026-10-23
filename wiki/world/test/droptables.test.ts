import { describe, expect, test } from 'bun:test';
import { ModelError } from '../model/family';
import { parseConfigs } from '../sources/configs';
import { collectConstants } from '../sources/constants';
import { parseDbrows } from '../sources/dbrows';
import { readDropTables, type DropContext } from '../sources/droptables';

// Scripted game data, cut from the real files' shapes: npc_combat.param's death_drop (default bones), the engine's
// ^true/^false, the loot duration and a quest constant, a few objs, and death scripts written the way drop
// tables/scripts/*.rs2 write them.
const PARAMS = parseConfigs(`
[death_drop]
type=namedobj
default=bones
`);
const CONSTANTS = collectConstants([
    ['engine.constant', '^true = 1\n^false = 0'],
    ['lootdrop.constant', '^lootdrop_duration = 200'],
    ['quest.constant', '^legends_complete = 75'],
]);
const OBJS = new Map(
    [
        'bones',
        'big_bones',
        'coins',
        'sword',
        'ruby',
        'sapphire',
        'arrows',
        'feather',
        'ring_of_wealth',
        'gem',
        'coal',
    ].map(o => [o, {}]),
);
const NPCS = parseConfigs(`
[chain]
[nested]
param=death_drop,big_bones
[ranged]
param=death_drop,null
[jewelled]
[quester]
[switcher]
[copier]
[jumper]
[duck]
category=birds
[plain]
[tabled]
[deriver]
[passer]
[switchcopier]
[tupled]
[summed]
[emptied]
[barer]
`);

// The global default (skill_combat/scripts/npc/npc_combat.rs2:3,96-101), the random_range proc
// (general/scripts/misc/random_range.rs2:1-2), the drop_table proc (drop tables/scripts/drop_table.rs2:1-20).
const DEFAULT = `[ai_queue3,_] gosub(npc_default_death);
[proc,npc_default_death]
gosub(npc_death);
def_namedobj $drop = npc_param(death_drop);
if ($drop ! null & npc_findhero = ^true) {
    obj_add(npc_coord, $drop, 1, ^lootdrop_duration);
}
[proc,npc_death]
npc_del;
[proc,random_range](int $min, int $max)(int)
return(calc($min + randominc(calc($max - $min))));
[proc,roll_on_drop_table](dbrow $data)(namedobj, int)
def_namedobj $drop;
def_int $drop_count;
def_int $drop_chance;
def_int $total = db_getfield($data, drop_table:total, 0);
def_int $rand = random($total);
def_int $i = 0;
while($i <= db_getfieldcount($data, drop_table:drop)) {
    $drop, $drop_count, $drop_chance = db_getfield($data, drop_table:drop, $i);
    $total = sub($total, $drop_chance);
    if ($rand >= $total) {
        return($drop, $drop_count);
    } else {
        $i = add($i, 1);
    }
}
return($drop, $drop_count);
`;

const DROPS = `[ai_queue3,chain]
gosub(npc_death);
obj_add(npc_coord, npc_param(death_drop), 1, ^lootdrop_duration);
~trail_easycluedrop(128, npc_coord);
def_int $r = random(8);
if ($r < 2) {
    obj_add(npc_coord, sword, 1, ^lootdrop_duration);
} else if ($r < 5) {
    obj_add(npc_coord, coins, 10, ^lootdrop_duration);
}

[ai_queue3,nested]
obj_add(npc_coord, npc_param(death_drop), 1, ^lootdrop_duration);
def_int $r = random(4);
if ($r < 1) {
    obj_add(npc_coord, ~gemroll, ^lootdrop_duration);
}
if (random(10) = 0) {
    obj_add(npc_coord, coal, 1, ^lootdrop_duration);
}
[proc,gemroll]()(namedobj, int)
def_int $g = random(8);
if ($g < 2) {
    return(ruby, 1);
} else if ($g < 4) {
    return(sapphire, 2);
}

[ai_queue3,ranged]
obj_add(npc_coord, npc_param(death_drop), 1, ^lootdrop_duration);
obj_add(npc_coord, coins, ~random_range(2, 12), ^lootdrop_duration);
obj_add(npc_coord, arrows, calc(random(11) + 2), ^lootdrop_duration);
obj_add(npc_coord, feather, randominc(10), ^lootdrop_duration);

[ai_queue3,jewelled]
obj_add(npc_coord, ~jewel, ^lootdrop_duration);
[proc,jewel]()(namedobj, int)
def_int $random = 0;
if (inv_total(worn, ring_of_wealth) > 0 & map_members = ^true) {
    $random = random(4);
} else {
    $random = random(8);
}
if ($random < 2) {
    return (gem, 1);
}

[ai_queue3,quester]
def_int $r = random(4);
if ($r < 1 & %legendsquest = ^legends_complete) {
    obj_add(npc_coord, ruby, 1, ^lootdrop_duration);
}

[ai_queue3,switcher]
switch_int (random(4)) {
    case 0, 1 : obj_add(npc_coord, sword, 1, ^lootdrop_duration);
    case default : obj_add(npc_coord, coins, 3, ^lootdrop_duration);
}

[ai_queue3,copier]
def_int $a = random(4);
def_int $b = $a;
if ($a < 2) {
    obj_add(npc_coord, sword, 1, ^lootdrop_duration);
} else if ($b < 3) {
    obj_add(npc_coord, coins, 1, ^lootdrop_duration);
}

[ai_queue3,jumper] @jumped;
[label,jumped]
obj_add(npc_coord, sword, 1, ^lootdrop_duration);
return;
obj_add(npc_coord, coins, 1, ^lootdrop_duration);

[ai_queue3,_birds]
obj_add(npc_coord, feather, 5, ^lootdrop_duration);

[ai_queue3,tabled]
def_namedobj $o;
def_int $n;
$o, $n = ~roll_on_drop_table(tabled_drops);
obj_add(npc_coord, $o, $n, ^lootdrop_duration);

[ai_queue3,deriver]
def_int $r = random(10);
if (calc($r + 1) < 5) {
    if ($r < 3) {
        obj_add(npc_coord, sword, 1, ^lootdrop_duration);
    }
}
def_int $s = calc($r + 1);
if ($s < 5) {
    obj_add(npc_coord, coins, $s, ^lootdrop_duration);
}

[ai_queue3,passer]
def_int $r = random(4);
if (~low($r) = ^true) {
    if ($r < 1) {
        obj_add(npc_coord, sword, 1, ^lootdrop_duration);
    }
}
[proc,low](int $x)(boolean)
if ($x < 2) {
    return(^true);
}
return(^false);

[ai_queue3,switchcopier]
def_int $a = random(4);
def_int $b = $a;
switch_int ($a) {
    case 0, 1 : obj_add(npc_coord, sword, 1, ^lootdrop_duration);
    case default :
        if ($b < 3) {
            obj_add(npc_coord, coins, 1, ^lootdrop_duration);
        }
}

[ai_queue3,tupled]
if (~pair < 3) {
    obj_add(npc_coord, sword, 1, ^lootdrop_duration);
}
[proc,pair]()(int, int)
return(1, 2);

[ai_queue3,summed]
obj_add(npc_coord, coins, calc(~nothing + 1), ^lootdrop_duration);
[proc,nothing]
mes("Nothing.");

[ai_queue3,emptied]
obj_add(npc_coord, coins, ~bare, ^lootdrop_duration);
[proc,bare]()(int)
return;
`;

const DBROWS = parseDbrows(`
[tabled_drops]
table=drop_table
data=total,16
data=drop,coins,5,8
data=drop,ruby,1,6
data=drop,sapphire,2,2
`);

const tables = readDropTables({
    npcs: NPCS,
    objs: OBJS,
    params: PARAMS,
    constants: CONSTANTS,
    dbrows: DBROWS,
    scripts: [
        ['npc_combat.rs2', DEFAULT],
        ['drops.rs2', DROPS],
    ],
});
const counts = (npc: string, ctx?: DropContext) => Object.fromEntries(tables(npc, ctx).counts);
const none = (npc: string, ...objs: string[]) => tables(npc).pNone(new Set(objs));

describe('readDropTables on scripted death scripts', () => {
    test('a random(8) if/else-if chain: each branch its slice of the roll, the death_drop default once', () => {
        // random(8) is 0-7 (NumberOps.ts:32-35). $r < 2 is 2/8: sword 0.25. 2 <= $r < 5 is 3/8 of 10 coins: 3.75.
        // 5-7 add nothing. npc_param(death_drop) is the .param default bones; the trail_ proc is left out.
        expect(counts('chain')).toEqual({ bones: 1, coins: 3.75, sword: 0.25 });
        expect(tables('chain').at).toBe('drops.rs2:1');
    });

    test('a nested roll multiplies, a proc past its last return drops nothing, an inline roll splits', () => {
        // $r < 1 is 1/4; in it ~gemroll's random(8): ruby 2/8 x 1, sapphire 2/8 x 2 per call, so 1/4 x 1/4 = 1/16 ruby
        // and 1/4 x 1/2 = 1/8 sapphire per kill; $g 4-7 returns the default (null, 0), which obj_add drops
        // (ObjOps.ts:23-25). random(10) = 0 is 1/10 coal. death_drop set to big_bones on the config.
        expect(counts('nested')).toEqual({ big_bones: 1, coal: 0.1, ruby: 1 / 16, sapphire: 1 / 8 });
    });

    test('a rolled count is its mean: random_range(2, 12) 7, calc(random(11) + 2) 7, randominc(10) 5', () => {
        // random_range is calc(2 + randominc(10)): 2-12, mean 7 (randominc(n) is 0-n, NumberOps.ts:37-40).
        // random(11) + 2 is 2-12, mean 7. randominc(10) is 0-10, mean 5. death_drop null drops nothing.
        expect(counts('ranged')).toEqual({ arrows: 7, coins: 7, feather: 5 });
    });

    test('the ring of wealth branch reads the context: worn rolls random(4), else random(8)', () => {
        // $random < 2: 2/4 = 0.5 with the ring, 2/8 = 0.25 without; members is true either way.
        expect(counts('jewelled', { worn: ['ring_of_wealth'] })).toEqual({ gem: 0.5 });
        expect(counts('jewelled')).toEqual({ gem: 0.25 });
        expect(counts('jewelled', { worn: ['amulet_of_glory'] })).toEqual({ gem: 0.25 });
    });

    test('a switch over a roll: each case its keys, the default the rest', () => {
        // random(4): keys 0 and 1 are 2/4 sword; 2 and 3 go to the default, 2/4 of 3 coins = 1.5.
        expect(counts('switcher')).toEqual({ coins: 1.5, sword: 0.5 });
    });

    test('pNone: the chance a kill drops none of the objs, summed over the paths that add none', () => {
        // chain: $r 5-7 adds neither the sword nor the coins, 3/8; the bones drop on every path.
        expect(none('chain', 'sword', 'coins')).toBeCloseTo(3 / 8, 12);
        expect(none('chain', 'bones')).toBe(0);
        expect(none('chain')).toBeCloseTo(1, 12);
        // nested: a gem on $r < 1 (1/4) then $g < 4 (4/8), 1/8; coal 1/10 on every path: (7/8)(9/10) = 63/80. The
        // ruby alone is 1/16: (15/16)(9/10) = 27/32.
        expect(none('nested', 'ruby', 'sapphire', 'coal')).toBeCloseTo(63 / 80, 12);
        expect(none('nested', 'ruby', 'coal')).toBeCloseTo(27 / 32, 12);
        // switcher: every roll takes the sword (0-1) or the coins (2-3), never both: 0, where two independent halves
        // would give 1/4.
        expect(none('switcher', 'sword', 'coins')).toBe(0);
        expect(none('switcher', 'sword')).toBeCloseTo(1 / 2, 12);
    });

    test('a copy of a roll narrows with it', () => {
        // $b is $a: past $a < 2 it is 2 or 3, so $b < 3 is 2 alone, 1/4 (a stale 0-3 $b would give 2/4 x 3/4 = 3/8).
        expect(counts('copier')).toEqual({ coins: 0.25, sword: 0.5 });
    });

    test('a label jump runs in place of the trigger, and a return ends it', () => {
        expect(counts('jumper')).toEqual({ sword: 1 });
    });

    test('lookup: the category trigger, else the global default with the death_drop param', () => {
        expect(counts('duck')).toEqual({ feather: 5 });
        expect(tables('duck').at).toBe('drops.rs2:75');
        expect(counts('plain')).toEqual({ bones: 1 });
        expect(tables('plain').at).toBe('npc_combat.rs2:1');
    });

    test('~roll_on_drop_table walks the drop_table row: each drop its chance out of total', () => {
        // random(16) is 0-15. Walking the list, $total falls 16 -> 8 -> 2 -> 0: $rand >= 8 (8/16) coins x5, then
        // $rand >= 2 (6/16) ruby x1, then $rand >= 0 (2/16) sapphire x2. coins 2.5, ruby 0.375, sapphire 0.25.
        expect(counts('tabled')).toEqual({ coins: 2.5, ruby: 0.375, sapphire: 0.25 });
    });

    test('a roll compared after arithmetic narrows the roll itself; a count read from a shifted roll is its mean', () => {
        // random(10) is 0-9. calc($r + 1) < 5 holds for $r 0-3 (4/10); there $r < 3 is 3 of the 4: sword 0.3 (a $r
        // left 0-9 would give 4/10 x 3/10 = 0.12). $s = $r + 1 is 1-10; $s < 5 is $s 1-4 (4/10), mean 2.5: coins 1.
        expect(counts('deriver')).toEqual({ coins: 1, sword: expect.closeTo(0.3, 12) });
    });

    test('a roll passed to a proc and compared there stays narrowed in the caller', () => {
        // ~low($r) is true for $r 0-1 (2/4); there $r < 1 is 1 of the 2: sword 1/4 (a $r left 0-3: 2/4 x 1/4 = 1/8).
        expect(counts('passer')).toEqual({ sword: 0.25 });
    });

    test('a switch narrows every local holding its roll in each case', () => {
        // Keys 0 and 1 are 2/4 sword. The default takes $a 2-3, so $b (a copy) < 3 is 2 alone: coins 1/4 (a stale
        // 0-3 $b would give 2/4 x 3/4 = 3/8).
        expect(counts('switchcopier')).toEqual({ coins: 0.25, sword: 0.5 });
    });

    test('a proc giving other than one value where one is read, or a return short of its declared values', () => {
        expect(() => tables('tupled')).toThrow(/`~pair` \(drops\.rs2:\d+\) gives 2 values/);
        expect(() => tables('summed')).toThrow(/`~nothing` \(drops\.rs2:\d+\) gives 0 values/);
        // The compiler rejects `return;` in a proc declaring (int), so it is no default 0 here.
        expect(() => tables('emptied')).toThrow(/returns 0 values at drops\.rs2:\d+, not the 1 declared/);
    });

    test('an unsupported read is a ModelError naming file:line, raised only for the npc that reaches it', () => {
        expect(() => tables('quester')).toThrow(ModelError);
        expect(() => tables('quester')).toThrow(/%legendsquest.*\(drops\.rs2:50\)/);
        // `&` short-circuits: the varp is read only on the $r < 1 path, which the context now settles.
        expect(counts('quester', { varps: { legendsquest: 75 } })).toEqual({ ruby: 0.25 });
        expect(counts('quester', { varps: { legendsquest: 0 } })).toEqual({});
        expect(() => tables('nobody')).toThrow(/no npc nobody/);
    });
});

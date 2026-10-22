// Smithing at an anvil: a bar used on the anvil opens the interface ([oplocu,_anvil] ->
// [label,smithing_anvil_interface]), a Make 1/5/10 button runs [label,attempt_smithing] and [proc,smithing_anvil] in
// skill_smithing/scripts/smithing/smithing.rs2, on the product's `smithing` dbrow (configs/smithing/smithing.dbrow)
// and the bar's anvil struct (`oc_param(<bar>, smithing_anvil_struct)`, configs/smithing/smithing.struct). A process
// step taking `bar_amount` bars a product, with no fail roll. A load over 10 products needs the interface opened
// again (no Make-X), which is not counted.
import { ModelError, type ActionModel } from '../family';
import { dbIndex, int, param, requireLevel, stringParams, type FamilyFactory } from './common';

/** `product`: the product's obj config (`iron_platebody`), its dbrow's `ifproduct`. */
export interface SmithingParams {
    product?: string;
}

/** The tool `smithing_anvil_interface` checks the inventory for (smithing.rs2:101-104). */
const HAMMER = 'hammer';

export const smithing: FamilyFactory = data => {
    const rows = dbIndex(data.dbrows, 'smithing', 'ifproduct');
    return {
        id: 'smithing',
        skills: ['smithing'],
        kinds: ['anvil'],
        model(site, params, profile): ActionModel {
            const p = stringParams(params, 'smithing', ['product']);
            if (site.kind !== 'anvil') throw new ModelError(`site ${site.id} is a ${site.kind} site, not an anvil`);
            if (!p.product) throw new ModelError('smithing needs a product param (the product obj)');
            const row = rows.get(p.product);
            if (!row) throw new ModelError(`no smithing row makes ${p.product}`);
            const bar = row.data.bar?.[0]?.[0];
            const product = row.data.product?.[0]?.[0];
            if (!bar || !product) throw new ModelError(`${row.row} names no bar or product`);
            const bars = int(row, 'bar_amount');
            const structName = param(data.objs.get(bar), 'smithing_anvil_struct');
            const struct = structName === undefined ? undefined : data.structs.get(structName);
            const xpPerBar = Number(param(struct, 'xpperbar'));
            const barLevel = Number(param(struct, 'levelrequired'));
            if (!struct || !Number.isFinite(xpPerBar) || !Number.isFinite(barLevel))
                throw new ModelError(`${bar} has no anvil struct with xpperbar and levelrequired`);
            // The bar's level opens the interface (smithing.rs2:93-99), the row's makes the product (:251-255).
            requireLevel(profile, 'smithing', barLevel, `working ${bar}`);
            requireLevel(profile, 'smithing', int(row, 'levelrequired'), `smithing ${p.product}`);
            return {
                // [proc,smithing_anvil] (smithing.rs2:271-301): p_delay(1) (:272), the product, then p_delay(2)
                // (:286), and the next product's p_delay(1) from there: a p_delay(k) holds k + 1 ticks
                // (PlayerOps.ts:376-380), so (1 + 1) + (2 + 1) = 5 ticks a product.
                ticksPerAttempt: 5,
                success: 1,
                // bar_amount x the bar's xpperbar (:283).
                xpTenths: { smithing: bars * xpPerBar },
                products: [{ obj: product, count: int(row, 'product_amount') }],
                consumes: [{ obj: bar, count: bars }],
                batch: bars,
                tools: [HAMMER],
            };
        },
    };
};

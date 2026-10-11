// Small helpers the builder, the renderers and the generators of wiki/npcs and wiki/shops share.

/** Ascending order of numbers or strings (by code unit, as `<` compares them), 0 when equal. */
export const cmp = (a: number | string, b: number | string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Appends `x` to the list at `key`, making the list when it is the first. */
export function push<K, V>(lists: Map<K, V[]>, key: K, x: V): void {
    const list = lists.get(key);
    if (list) list.push(x);
    else lists.set(key, [x]);
}

// The promoted chop-burn plan, ended after its second burn: the plan smoke test's two full cycles.
import { definePlan } from '@conductor/lib/plan';
import chopBurn from '@conductor/plans/chop-burn';

export default definePlan({
    ...chopBurn,
    name: 'chop-burn-twice',
    until: v => v.runs('firemaking') >= 2,
});

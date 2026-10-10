// A plan fixture for the CLI's plan loading: imports through the `@conductor/*` alias, as a plan does.
import { definePlan, phase } from '@conductor/lib/plan';
import woodcutting from '@conductor/tasks/woodcutting';

export default definePlan({
    name: 'chop',
    phases: [phase(woodcutting, { tree: 'tree', onFull: 'stop' })],
});

// A module the CLI must refuse as a plan: its default export is a phase list, not definePlan's result.
import { phase } from '@conductor/lib/plan';
import woodcutting from '@conductor/tasks/woodcutting';

export default { name: 'chop', phases: [phase(woodcutting, { tree: 'tree' })] };

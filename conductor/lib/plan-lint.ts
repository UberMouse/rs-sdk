// A static check of one plan module: what a live run would only find when the phase that trips it comes up, or never
// (a phase-name comparison that can never match reads false silently). Parse only, no type check, so a lint of every
// promoted plan stays cheap.
import ts from 'typescript';
import { invalidParams, type PlanDef } from './plan';

/** Calls whose string-literal arguments name phases: the view's methods and the plans' own helpers of those names. */
const PHASE_CALLS = new Set(['runs', 'ran', 'lastDone', 'lastFailed', 'lastWas', 'lastIs']);
/** Item names a woodcutting-axe pattern must tell apart: an unanchored `/axe$/i` takes both. */
const AXE_TRAP = ['Bronze axe', 'Bronze pickaxe'];

const calleeName = (e: ts.Expression): string | undefined =>
    ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined;
const isPhaseAccess = (e: ts.Expression) => ts.isPropertyAccessExpression(e) && e.name.text === 'phase';
/** String methods whose pattern rewrites text (`name.replace(/ /g, '-')`) rather than picking an item. */
const TEXT_METHODS = new Set(['replace', 'replaceAll', 'split']);
/** Whether a RegExp literal is the pattern argument of one of TEXT_METHODS. */
const rewritesText = (re: ts.Node) =>
    ts.isCallExpression(re.parent) &&
    re.parent.arguments[0] === re &&
    ts.isPropertyAccessExpression(re.parent.expression) &&
    TEXT_METHODS.has(re.parent.expression.name.text);

/** String methods that match a reason's text: `reason.includes('x')`, `reason.match(/x/)`. */
const MATCH_METHODS = new Set(['includes', 'match', 'matchAll', 'search']);
/** `e` without the parentheses, `!` and `?? ''` that wrap a value for a match. */
const unwrap = (e: ts.Expression): ts.Expression => {
    for (;;) {
        if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
        else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) e = e.left;
        else return e;
    }
};
/** A result's `.reason`, or a variable named `reason`. */
const isReason = (e: ts.Expression) => {
    const u = unwrap(e);
    return (
        (ts.isPropertyAccessExpression(u) && u.name.text === 'reason') || (ts.isIdentifier(u) && u.text === 'reason')
    );
};
/** Whether a call matches a reason's text: `re.test(reason)`, or one of MATCH_METHODS on it. */
const matchesReason = (call: ts.CallExpression) => {
    if (!ts.isPropertyAccessExpression(call.expression)) return false;
    const method = call.expression.name.text;
    if (method === 'test') return call.arguments.some(isReason);
    return MATCH_METHODS.has(method) && isReason(call.expression.expression);
};
/** Whether `n` holds a `.code === …` (or `!==`) comparison. */
const hasCodeCheck = (n: ts.Node): boolean =>
    (ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
        [n.left, n.right].some(side => ts.isPropertyAccessExpression(side) && side.name.text === 'code')) ||
    (ts.forEachChild(n, hasCodeCheck) ?? false);
/**
 * Whether `n` runs only after a code test in the same `&&` chain (`last.code === 'dialog' && /Dad/.test(reason)`):
 * the code picks the ending and the text is game text it carries, not our wording.
 */
const afterCodeCheck = (n: ts.Node): boolean => {
    for (let child = n, p = n.parent; p; child = p, p = p.parent) {
        if (ts.isParenthesizedExpression(p)) continue;
        if (!ts.isBinaryExpression(p) || p.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return false;
        if (p.right === child && hasCodeCheck(p.left)) return true;
    }
    return false;
};

/** The problems of a plan module: its default export `def` and its source text. Empty when it is clean. */
export function lintPlan(def: PlanDef, source: string): string[] {
    const problems = invalidParams(def);
    const phases = new Set(def.phases.map(p => p.name));
    const file = ts.createSourceFile('plan.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const where = (n: ts.Node) => `line ${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`;
    const checkName = (lit: ts.Node, context: string) => {
        if (ts.isStringLiteral(lit) && !phases.has(lit.text))
            problems.push(`${where(lit)}: ${context} names "${lit.text}", which is no phase of plan "${def.name}"`);
    };

    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
            const name = calleeName(n.expression);
            if (name !== undefined && PHASE_CALLS.has(name)) for (const a of n.arguments) checkName(a, `${name}(...)`);
            if (matchesReason(n) && !afterCodeCheck(n))
                problems.push(
                    `${where(n)}: ${n.getText(file)} matches a reason's text, which may be reworded: branch on \`last.code\``,
                );
        } else if (ts.isBinaryExpression(n)) {
            const op = n.operatorToken.kind;
            if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
                const text = ts.tokenToString(op);
                if (isPhaseAccess(n.left)) checkName(n.right, `.phase ${text}`);
                if (isPhaseAccess(n.right)) checkName(n.left, `.phase ${text}`);
            }
        } else if (n.kind === ts.SyntaxKind.RegularExpressionLiteral && !rewritesText(n)) {
            const text = n.getText(file);
            const slash = text.lastIndexOf('/');
            const re = new RegExp(text.slice(1, slash), text.slice(slash + 1).replace(/[gy]/g, ''));
            if (AXE_TRAP.every(item => re.test(item)))
                problems.push(`${where(n)}: ${text} matches both ${AXE_TRAP.map(i => `"${i}"`).join(' and ')}`);
        }
        ts.forEachChild(n, visit);
    };
    visit(file);
    return problems;
}

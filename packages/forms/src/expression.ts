/**
 * Calculated-field formulas: numbers, `{fieldId}` references, + - * / %,
 * parentheses, unary minus and a few functions. Parsed by hand into a small
 * AST and evaluated over plain numbers; nothing reaches `eval` or `Function`.
 */

export type ExprNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; id: string }
  | { kind: 'neg'; arg: ExprNode }
  | { kind: 'bin'; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { kind: 'call'; fn: FunctionName; args: ExprNode[] };

type BinaryOp = '+' | '-' | '*' | '/' | '%';
type FunctionName = 'min' | 'max' | 'round' | 'abs' | 'floor' | 'ceil';

const FUNCTIONS: Record<FunctionName, readonly [min: number, max: number]> = {
  min: [1, 20],
  max: [1, 20],
  round: [1, 2],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
};

const MAX_TOKENS = 300;
const MAX_DEPTH = 40;

export class ExpressionError extends Error {
  override name = 'ExpressionError';
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'ref'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: BinaryOp }
  | { t: '(' }
  | { t: ')' }
  | { t: ',' };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`Unexpected "${c}"`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (c === '{') {
      const end = src.indexOf('}', i);
      if (end === -1) throw new ExpressionError('Missing "}"');
      const id = src.slice(i + 1, end).trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id))
        throw new ExpressionError(`Bad field reference "{${id}}"`);
      out.push({ t: 'ref', v: id });
      i = end + 1;
    } else if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+/.exec(src.slice(i))!;
      out.push({ t: 'ident', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '(' || c === ')' || c === ',') {
      out.push({ t: c });
      i++;
    } else {
      throw new ExpressionError(`Unexpected "${c}"`);
    }
    if (out.length > MAX_TOKENS) throw new ExpressionError('Formula is too long');
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    if (this.tokens.length === 0) throw new ExpressionError('Formula is empty');
    const node = this.expr(0);
    if (this.pos < this.tokens.length)
      throw new ExpressionError('Unexpected text after the formula');
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(depth: number): ExprNode {
    if (depth > MAX_DEPTH) throw new ExpressionError('Formula is nested too deeply');
    let left = this.term(depth);
    for (
      let tok = this.peek();
      tok?.t === 'op' && (tok.v === '+' || tok.v === '-');
      tok = this.peek()
    ) {
      this.pos++;
      left = { kind: 'bin', op: tok.v, left, right: this.term(depth) };
    }
    return left;
  }

  private term(depth: number): ExprNode {
    let left = this.unary(depth);
    for (
      let tok = this.peek();
      tok?.t === 'op' && (tok.v === '*' || tok.v === '/' || tok.v === '%');
      tok = this.peek()
    ) {
      this.pos++;
      left = { kind: 'bin', op: tok.v, left, right: this.unary(depth) };
    }
    return left;
  }

  private unary(depth: number): ExprNode {
    const tok = this.peek();
    if (tok?.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      if (depth > MAX_DEPTH) throw new ExpressionError('Formula is nested too deeply');
      this.pos++;
      const arg = this.unary(depth + 1);
      return tok.v === '-' ? { kind: 'neg', arg } : arg;
    }
    return this.primary(depth);
  }

  private primary(depth: number): ExprNode {
    const tok = this.peek();
    if (!tok) throw new ExpressionError('Formula ends too early');
    this.pos++;
    switch (tok.t) {
      case 'num':
        return { kind: 'num', value: tok.v };
      case 'ref':
        return { kind: 'ref', id: tok.v };
      case '(': {
        const inner = this.expr(depth + 1);
        this.expect(')');
        return inner;
      }
      case 'ident': {
        if (!Object.hasOwn(FUNCTIONS, tok.v))
          throw new ExpressionError(`Unknown function "${tok.v}"`);
        const fn = tok.v as FunctionName;
        this.expect('(');
        const args: ExprNode[] = [];
        if (this.peek()?.t !== ')') {
          args.push(this.expr(depth + 1));
          while (this.peek()?.t === ',') {
            this.pos++;
            args.push(this.expr(depth + 1));
          }
        }
        this.expect(')');
        const [min, max] = FUNCTIONS[fn];
        if (args.length < min || args.length > max) {
          throw new ExpressionError(
            `${fn}() takes ${min === max ? min : `${min} to ${max}`} values`,
          );
        }
        return { kind: 'call', fn, args };
      }
      default:
        throw new ExpressionError('Unexpected symbol in the formula');
    }
  }

  private expect(t: '(' | ')'): void {
    if (this.peek()?.t !== t) throw new ExpressionError(`Expected "${t}"`);
    this.pos++;
  }
}

/** Parses a formula. Throws `ExpressionError` with a readable message. */
export function parseExpression(src: string): ExprNode {
  return new Parser(tokenize(src)).parse();
}

/** Field ids a formula reads, in first-use order. */
export function expressionRefs(node: ExprNode): string[] {
  const out: string[] = [];
  const walk = (n: ExprNode): void => {
    switch (n.kind) {
      case 'ref':
        if (!out.includes(n.id)) out.push(n.id);
        return;
      case 'neg':
        walk(n.arg);
        return;
      case 'bin':
        walk(n.left);
        walk(n.right);
        return;
      case 'call':
        n.args.forEach(walk);
        return;
      case 'num':
        return;
    }
  };
  walk(node);
  return out;
}

/**
 * Evaluates a parsed formula. Missing or non-numeric references count as 0.
 * Returns null for a division by zero or a non-finite result.
 */
export function evaluateExpression(
  node: ExprNode,
  lookup: (fieldId: string) => number | null,
): number | null {
  const ev = (n: ExprNode): number => {
    switch (n.kind) {
      case 'num':
        return n.value;
      case 'ref':
        return lookup(n.id) ?? 0;
      case 'neg':
        return -ev(n.arg);
      case 'bin': {
        const a = ev(n.left);
        const b = ev(n.right);
        switch (n.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return b === 0 ? Number.NaN : a / b;
          case '%':
            return b === 0 ? Number.NaN : a % b;
        }
        return Number.NaN;
      }
      case 'call': {
        const args = n.args.map(ev);
        switch (n.fn) {
          case 'min':
            return Math.min(...args);
          case 'max':
            return Math.max(...args);
          case 'abs':
            return Math.abs(args[0]!);
          case 'floor':
            return Math.floor(args[0]!);
          case 'ceil':
            return Math.ceil(args[0]!);
          case 'round': {
            const places = Math.max(0, Math.min(6, Math.trunc(args[1] ?? 0)));
            return roundTo(args[0]!, places);
          }
        }
        return Number.NaN;
      }
    }
  };
  const value = ev(node);
  return Number.isFinite(value) ? value : null;
}

/** Half-away-from-zero rounding to `places` decimals without binary drift (1.005 -> 1.01). */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  const shifted = Math.abs(value) * factor;
  const rounded = Math.round(Number(shifted.toPrecision(15)));
  return (Math.sign(value) * rounded) / factor;
}

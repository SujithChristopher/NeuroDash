// Tiny evaluator for the REDCap-style expressions in scale definitions:
//   showIf:   nihss_5a = 'UN' or nihss_5b = 'UN'      consent_obtained(1) = '1'
//   computed: (fss_1+fss_2+ ... ) / 9
// Supports + - * /, comparisons (= <> != < > <= >=), and/or, parentheses, numbers, 'strings',
// identifiers and checkbox refs `name(3)`. No function calls, no eval.

type Tok =
	| { t: 'num'; v: number }
	| { t: 'str'; v: string }
	| { t: 'id'; v: string; box?: string }
	| { t: 'op'; v: string }
	| { t: 'lp' }
	| { t: 'rp' };

type Node =
	| { k: 'num'; v: number }
	| { k: 'str'; v: string }
	| { k: 'var'; name: string; box?: string }
	| { k: 'bin'; op: string; l: Node; r: Node }
	| { k: 'neg'; e: Node };

export type Value = number | string | boolean | null;
/** Resolves a variable (and optional checkbox index) to its current value. */
export type Resolver = (name: string, box?: string) => Value;

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
		} else if (c === '(') {
			out.push({ t: 'lp' });
			i++;
		} else if (c === ')') {
			out.push({ t: 'rp' });
			i++;
		} else if (c === "'" || c === '"') {
			const end = src.indexOf(c, i + 1);
			if (end < 0) throw new Error('Unterminated string');
			out.push({ t: 'str', v: src.slice(i + 1, end) });
			i = end + 1;
		} else if (/[0-9.]/.test(c)) {
			const m = /^\d*\.?\d+/.exec(src.slice(i));
			if (!m) throw new Error(`Bad number at ${i}`);
			out.push({ t: 'num', v: Number(m[0]) });
			i += m[0].length;
		} else if (/[A-Za-z_]/.test(c)) {
			const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
			i += m[0].length;
			const word = m[0].toLowerCase();
			if (word === 'and' || word === 'or') {
				out.push({ t: 'op', v: word });
				continue;
			}
			// checkbox ref: name(3)
			const box = /^\((\w+)\)/.exec(src.slice(i));
			if (box) {
				out.push({ t: 'id', v: m[0], box: box[1] });
				i += box[0].length;
			} else {
				out.push({ t: 'id', v: m[0] });
			}
		} else {
			const two = src.slice(i, i + 2);
			if (['<>', '!=', '<=', '>='].includes(two)) {
				out.push({ t: 'op', v: two });
				i += 2;
			} else if ('=<>+-*/'.includes(c)) {
				out.push({ t: 'op', v: c });
				i++;
			} else {
				throw new Error(`Unexpected "${c}"`);
			}
		}
	}
	return out;
}

function parse(src: string): Node {
	const toks = tokenize(src);
	let p = 0;
	const peek = () => toks[p];
	const isOp = (...ops: string[]) => {
		const t = peek();
		return t?.t === 'op' && ops.includes(t.v);
	};

	function primary(): Node {
		const t = toks[p++];
		if (!t) throw new Error('Unexpected end');
		if (t.t === 'num') return { k: 'num', v: t.v };
		if (t.t === 'str') return { k: 'str', v: t.v };
		if (t.t === 'id') return { k: 'var', name: t.v, box: t.box };
		if (t.t === 'lp') {
			const e = or();
			if (toks[p++]?.t !== 'rp') throw new Error('Expected )');
			return e;
		}
		throw new Error('Unexpected token');
	}
	function unary(): Node {
		if (isOp('-')) {
			p++;
			return { k: 'neg', e: unary() };
		}
		return primary();
	}
	function mul(): Node {
		let l = unary();
		while (isOp('*', '/')) l = { k: 'bin', op: (toks[p++] as { v: string }).v, l, r: unary() };
		return l;
	}
	function add(): Node {
		let l = mul();
		while (isOp('+', '-')) l = { k: 'bin', op: (toks[p++] as { v: string }).v, l, r: mul() };
		return l;
	}
	function cmp(): Node {
		let l = add();
		while (isOp('=', '<>', '!=', '<', '>', '<=', '>=')) l = { k: 'bin', op: (toks[p++] as { v: string }).v, l, r: add() };
		return l;
	}
	function and(): Node {
		let l = cmp();
		while (isOp('and')) {
			p++;
			l = { k: 'bin', op: 'and', l, r: cmp() };
		}
		return l;
	}
	function or(): Node {
		let l = and();
		while (isOp('or')) {
			p++;
			l = { k: 'bin', op: 'or', l, r: and() };
		}
		return l;
	}

	const ast = or();
	if (p < toks.length) throw new Error('Trailing input');
	return ast;
}

const cache = new Map<string, Node>();
const compile = (src: string) => {
	let n = cache.get(src);
	if (!n) cache.set(src, (n = parse(src)));
	return n;
};

const isNum = (v: Value): v is number => typeof v === 'number' && Number.isFinite(v);

function run(n: Node, get: Resolver): Value {
	switch (n.k) {
		case 'num':
		case 'str':
			return n.v;
		case 'var':
			return get(n.name, n.box);
		case 'neg': {
			const v = run(n.e, get);
			return isNum(v) ? -v : null;
		}
		case 'bin': {
			if (n.op === 'and' || n.op === 'or') {
				const l = !!run(n.l, get);
				return n.op === 'and' ? l && !!run(n.r, get) : l || !!run(n.r, get);
			}
			const l = run(n.l, get);
			const r = run(n.r, get);
			if ('+-*/'.includes(n.op)) {
				// Arithmetic propagates "missing": REDCap returns blank if any operand is blank.
				if (!isNum(l) || !isNum(r)) return null;
				return n.op === '+' ? l + r : n.op === '-' ? l - r : n.op === '*' ? l * r : r === 0 ? null : l / r;
			}
			// Comparisons are string-wise for equality (REDCap compares '0' and 0 as equal), numeric for ordering.
			const a = l == null ? '' : String(l);
			const b = r == null ? '' : String(r);
			if (n.op === '=') return a === b;
			if (n.op === '<>' || n.op === '!=') return a !== b;
			const x = Number(a);
			const y = Number(b);
			if (a === '' || b === '' || Number.isNaN(x) || Number.isNaN(y)) return false;
			return n.op === '<' ? x < y : n.op === '>' ? x > y : n.op === '<=' ? x <= y : x >= y;
		}
	}
}

/** Evaluates an expression; returns null on any parse/eval error or missing operand. */
export function evaluate(src: string, get: Resolver): Value {
	try {
		return run(compile(src), get);
	} catch {
		return null;
	}
}

/** Variable names an expression references (used to know which items feed a score). */
export function referencedVars(src: string): string[] {
	try {
		return tokenize(src)
			.filter((t): t is Extract<Tok, { t: 'id' }> => t.t === 'id')
			.map((t) => t.v);
	} catch {
		return [];
	}
}

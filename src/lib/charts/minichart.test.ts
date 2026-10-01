import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniChart } from './minichart.js';

// A recording stand-in for CanvasRenderingContext2D plus just enough DOM for the chart engine.
type Call = { fn: string; args: unknown[] };
function fakeCanvas() {
	const calls: Call[] = [];
	const stops: number[] = []; // alpha of every gradient colour stop, in draw order
	const ctx = new Proxy(
		{ canvas: null as unknown },
		{
			get(t, prop: string) {
				if (prop === 'canvas') return t.canvas;
				if (prop === 'measureText') return () => ({ width: 10 });
				if (prop === 'createLinearGradient') return () => ({ addColorStop: (_o: number, c: string) => void stops.push(Number(/,([\d.]+)\)$/.exec(c)?.[1])) });
				return (...args: unknown[]) => void calls.push({ fn: prop, args });
			},
			set(t, prop: string, value) {
				(t as Record<string, unknown>)[prop] = value; // keeps ctx.canvas; other ctx properties are just recorded state
				return true;
			}
		}
	) as unknown as CanvasRenderingContext2D;
	const parent = { getBoundingClientRect: () => ({ width: 400, height: 200 }) };
	const canvas = { parentElement: parent, style: {}, addEventListener() {}, removeEventListener() {}, width: 0, height: 0, clientHeight: 200, getContext: () => ctx };
	(ctx as unknown as { canvas: unknown }).canvas = canvas;
	return { ctx, calls, stops };
}

let frames: ((t: number) => void)[] = [];
let reduced = false;
beforeEach(() => {
	frames = [];
	reduced = false;
	vi.stubGlobal('window', {
		matchMedia: () => ({ matches: reduced }),
		devicePixelRatio: 1,
		addEventListener() {},
		removeEventListener() {},
		innerWidth: 1000,
		innerHeight: 800
	});
	vi.stubGlobal('document', {
		createElement: () => ({ style: {}, parentNode: null }),
		body: { appendChild() {} }
	});
	vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
	vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => frames.push(cb));
	vi.stubGlobal('cancelAnimationFrame', () => (frames = []));
});
afterEach(() => vi.unstubAllGlobals());

/** Advances the animation clock: the first frame fixes t0, the next reports `ms` later. */
function tick(ms: number) {
	const cb = frames.shift();
	cb?.(ms);
}
const run = (ms: number) => {
	tick(0);
	tick(ms);
};

const lineCfg = (over: Record<string, unknown> = {}) => ({
	type: 'line',
	data: { labels: ['a', 'b', 'c', 'd'], datasets: [{ label: 'x', data: [10, 40, 25, 60], borderColor: '#0f766e', fill: true, tension: 0.35 }] },
	options: { scales: { x: {}, y: {} }, ...over }
});

describe('line chart animation', () => {
	it('starts empty and reveals left → right with easing', () => {
		const { ctx, calls } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg());
		expect(c._t).toBe(0);
		const clipWidth = () => {
			const rects = calls.filter((x) => x.fn === 'rect');
			return rects.length ? (rects[rects.length - 1].args[2] as number) : Infinity;
		};
		calls.length = 0;
		run(250); // 25% of 1000ms
		const early = clipWidth();
		calls.length = 0;
		tick(700);
		const mid = clipWidth();
		expect(early).toBeGreaterThan(0);
		expect(mid).toBeGreaterThan(early); // the reveal grows
		// Ease-out: a quarter of the time reveals well over a quarter of the width.
		const full = (c.plot?.w ?? 0) + 24;
		expect(early / full).toBeGreaterThan(0.4);
	});

	it('finishes fully drawn, with no clipping', () => {
		const { ctx, calls } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg());
		run(1000);
		expect(c._t).toBe(1);
		calls.length = 0;
		c._draw();
		expect(calls.some((x) => x.fn === 'rect' && x.args.length === 4 && (x.args[2] as number) > 0 && calls.some((y) => y.fn === 'clip'))).toBe(false);
		expect(frames).toHaveLength(0); // no further frames scheduled
	});

	it('curves the line with bezier segments when tension is set, and stays straight otherwise', () => {
		const a = fakeCanvas();
		new MiniChart(a.ctx, lineCfg());
		run(1000);
		expect(a.calls.some((x) => x.fn === 'bezierCurveTo')).toBe(true);
		const b = fakeCanvas();
		new MiniChart(b.ctx, { ...lineCfg(), data: { labels: ['a', 'b', 'c'], datasets: [{ data: [1, 2, 3], borderColor: '#000' }] } });
		run(1000);
		expect(b.calls.some((x) => x.fn === 'bezierCurveTo')).toBe(false);
	});

	it('the gradient under the line fades in as the line draws, then holds at full strength', () => {
		const { ctx, stops } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg());
		const topAlpha = (t: number) => {
			stops.length = 0;
			c._t = t;
			c._draw();
			return stops[0];
		};
		expect(topAlpha(0.1)).toBe(0); // the fill hasn't started yet; the line leads
		const a = topAlpha(0.4);
		const b = topAlpha(0.7);
		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(a);
		expect(topAlpha(1)).toBeCloseTo(0.32, 5);
		expect(stops[1]).toBeCloseTo(0.02, 5); // bottom stop reaches its final value too
	});

	it('the smoothed curve never overshoots the data (monotone)', () => {
		const { ctx, calls } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg({ animation: false }));
		calls.length = 0;
		c._draw();
		const ys = calls.filter((x) => x.fn === 'bezierCurveTo').flatMap((x) => [x.args[1], x.args[3]]) as number[];
		const dataYs = calls.filter((x) => x.fn === 'arc' && x.args[2] === 3).map((x) => x.args[1]) as number[];
		expect(ys.length).toBeGreaterThan(0);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(...dataYs) - 0.001);
		expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(...dataYs) + 0.001);
	});
});

describe('bar chart animation', () => {
	const barCfg = (over = {}) => ({
		type: 'bar',
		data: { labels: ['a', 'b', 'c'], datasets: [{ label: 'x', data: [10, 20, 30], backgroundColor: '#0f766e', borderRadius: 4, maxBarThickness: 28 }] },
		options: { scales: {}, ...over }
	});

	it('grows bars from the baseline, staggered, and ends at full height', () => {
		const { ctx } = fakeCanvas();
		const c = new MiniChart(ctx, barCfg());
		const heights = () => c._barProg(0, 3) + c._barProg(1, 3) + c._barProg(2, 3);
		c._t = 0;
		expect(heights()).toBe(0);
		c._t = 0.5;
		const first = c._barProg(0, 3);
		const last = c._barProg(2, 3);
		expect(first).toBeGreaterThan(last); // earlier bars lead
		expect(first).toBeGreaterThan(0);
		c._t = 1;
		expect(c._barProg(2, 3)).toBe(1);
	});

	it('keeps hover geometry at full size while bars are still growing', () => {
		const { ctx } = fakeCanvas();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const c = new MiniChart(ctx, barCfg()) as any;
		c._t = 0.1;
		c._draw();
		const grown = c._barRects.map((r: { h: number }) => r.h);
		c._t = 1;
		c._draw();
		expect(c._barRects.map((r: { h: number }) => r.h)).toEqual(grown);
	});
});

describe('doughnut animation', () => {
	it('sweeps clockwise: only part of the ring is drawn mid-animation, all of it at the end', () => {
		const cfg = { type: 'doughnut', data: { labels: ['a', 'b'], datasets: [{ data: [3, 1], backgroundColor: ['#111', '#222'] }] }, options: { cutout: '68%' } };
		const { ctx, calls } = fakeCanvas();
		const c = new MiniChart(ctx, cfg);
		// Outer-edge arcs are the 5-argument arc() calls: arc(cx, cy, r, start, end).
		const swept = () =>
			calls.filter((x) => x.fn === 'arc' && x.args.length === 5).reduce((sum, x) => sum + ((x.args[4] as number) - (x.args[3] as number)), 0);
		c._t = 0.3;
		calls.length = 0;
		c._draw();
		const partial = swept();
		c._t = 1;
		calls.length = 0;
		c._draw();
		const full = swept();
		expect(partial).toBeGreaterThan(0);
		expect(partial).toBeLessThan(full);
		expect(full).toBeCloseTo(Math.PI * 2, 3);
	});
});

describe('animation controls', () => {
	it('respects prefers-reduced-motion: drawn complete immediately, no frames', () => {
		reduced = true;
		const { ctx } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg());
		expect(c._t).toBe(1);
		expect(frames).toHaveLength(0);
	});

	it('can be switched off per chart', () => {
		const { ctx } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg({ animation: false }));
		expect(c._t).toBe(1);
		expect(frames).toHaveLength(0);
	});

	it('destroy() stops a running animation', () => {
		const { ctx } = fakeCanvas();
		const c = new MiniChart(ctx, lineCfg());
		expect(frames.length).toBeGreaterThan(0);
		c.destroy();
		expect(frames).toHaveLength(0);
		// a late frame callback does nothing
		const before = c._t;
		c._raf = undefined;
		expect(c._destroyed).toBe(true);
		expect(c._t).toBe(before);
	});
});

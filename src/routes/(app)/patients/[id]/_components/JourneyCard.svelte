<script lang="ts">
	// The session journey: a winding path with a node for every day the patient trained (1, 2, 3 ...), shaded by how much of the
	// daily target was trained, and a small flag where an assessment happened. Click a node for that day.
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { buildJourney, layoutPath, perRowFor, type JourneyStep } from '$lib/journey';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, targetMinutes, openSession, goTab }: { data: PageData; targetMinutes: number; openSession: (id: string) => void; goTab: (t: string) => void } = $props();

	const steps = $derived(
		buildJourney({
			sessions: data.sessions,
			targetMinutes,
			milestones: [
				...data.assessments.map((a) => ({ kind: 'clinical' as const, label: a.typeId.toUpperCase(), date: a.date })),
				...data.roboticAssessments.map((a) => ({ kind: 'robotic' as const, label: `${a.device} ${a.timepoint}`, date: a.assessedAt }))
			]
		})
	);
	const trained = $derived(steps.filter((s) => s.type === 'session').length);

	let width = $state(0);
	const layout = $derived(layoutPath(steps.length, { width: Math.max(width, 280), perRow: perRowFor(width) }));
	let picked = $state<number | null>(null);
	const selected = $derived<JourneyStep | null>(picked != null && steps[picked] ? steps[picked] : null);
	// the newest training day is the one the path has reached
	const latest = $derived(steps.findLastIndex((s) => s.type === 'session'));

	const LEGEND = [1, 2, 3, 4] as const;
	const f = (n: number) => String(Math.round(n * 10) / 10);
	const label = (s: JourneyStep) => (s.type === 'session' ? `Session ${s.n}, ${fmtDateShort(s.date)}, ${f(s.minutes)} minutes` : `${s.caption}, ${fmtDateShort(s.date)}`);
	const pick = (i: number) => (picked = picked === i ? null : i);
</script>

<div class="card" style="margin-bottom:18px">
	<div class="card-head">
		<div><h3>Session journey</h3><div class="hint">one step for every day trained</div></div>
		<span class="hint">{trained} session{trained === 1 ? '' : 's'}</span>
	</div>
	<div class="card-body">
		{#if !steps.length}
			<EmptyState icon="activity" title="The journey starts with the first session" sub="Each day the patient trains adds a step to the path." />
		{:else}
			<div class="wrap" bind:clientWidth={width}>
				<svg width={Math.max(width, 280)} height={layout.height} role="group" aria-label="Session journey">
					<defs>
						<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0">
							<stop offset="0" stop-color="var(--accent)" stop-opacity="0.55" />
							<stop offset="1" stop-color="var(--accent)" />
						</linearGradient>
					</defs>
					{#if steps.length > 1}
						<path class="road" d={layout.d} />
						<path class="road-line" d={layout.d} />
						<path class="trail" d={layout.d} pathLength="1" />
					{/if}
					{#each steps as s, i (i)}
						{@const p = layout.points[i]}
						<g transform="translate({p.x},{p.y})">
							<g class="pop" style="--i:{i}">
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
								<g class="step" class:on={picked === i} role="button" tabindex="0" aria-label={label(s)} aria-pressed={picked === i} onclick={() => pick(i)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(i))}>
									{#if s.type === 'session'}
										{#if i === latest}<circle class="pulse" r="20" />{/if}
										<circle class="node l{s.level}" r={i === latest ? 22 : 19} />
										<text class="num l{s.level}" y="0.5">{s.n}</text>
										<title>{label(s)}</title>
									{:else}
										<rect class="flag" x="-10" y="-10" width="20" height="20" rx="4" transform="rotate(45)" />
										<text class="flag-mark" y="0.5">✓</text>
										<text class="flag-cap" y="30">{s.caption}</text>
										<title>{label(s)}</title>
									{/if}
								</g>
							</g>
						</g>
					{/each}
				</svg>
			</div>

			<div class="legend">
				Less
				{#each LEGEND as l (l)}<span class="sw l{l}"></span>{/each}
				Target met
				<span class="sep"></span>
				<span class="flag-sw"></span> assessment
			</div>

			{#if selected}
				<div class="detail">
					{#if selected.type === 'session'}
						<div class="d-head">
							<div><b>Session {selected.n}</b> <span class="muted">· {fmtDateShort(selected.date)}</span></div>
							<button class="btn btn-secondary btn-sm" onclick={() => openSession(selected.sessionId)}>Open session</button>
						</div>
						<div class="d-grid">
							<div>
								<div class="k-label">Time trained</div>
								<div class="big">{f(selected.minutes)} <span>of {targetMinutes} min</span></div>
								<div class="progress-track" style="margin-top:6px"><div class="progress-fill {selected.minutes >= targetMinutes ? 'good' : selected.minutes >= targetMinutes * 0.67 ? 'warning' : 'critical'}" style="width:{Math.min(100, (selected.minutes / targetMinutes) * 100)}%"></div></div>
							</div>
							<div>
								<div class="k-label">Accuracy</div>
								<div class="big">{selected.accuracy == null ? '—' : `${selected.accuracy}%`}</div>
							</div>
							<div>
								<div class="k-label">Devices</div>
								<div class="devs">{#each selected.byDevice as d (d.name)}<Badge text="{d.name} · {f(d.minutes)} min" tone="info" />{/each}</div>
								{#if selected.sessions > 1}<div class="muted" style="font-size:12px;margin-top:4px">{selected.sessions} sessions that day</div>{/if}
							</div>
						</div>
					{:else}
						<div class="d-head">
							<div><b>{selected.items.length === 1 ? 'Assessment' : 'Assessments'}</b> <span class="muted">· {fmtDateShort(selected.date)}</span></div>
							<button class="btn btn-secondary btn-sm" onclick={() => goTab('assessments')}>View assessments</button>
						</div>
						<div class="devs">{#each selected.items as it (it.label)}<Badge text={it.label} tone={it.kind === 'robotic' ? 'info' : 'accent'} />{/each}</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.wrap {
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
	}
	/* the road under the path, then the path that draws itself in */
	.road {
		fill: none;
		stroke: var(--surface-2);
		stroke-width: 22;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.road-line {
		fill: none;
		stroke: var(--surface);
		stroke-width: 2;
		stroke-dasharray: 2 7;
		stroke-linecap: round;
	}
	.trail {
		fill: none;
		stroke: url(#trail);
		stroke-width: 6;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 1.8s cubic-bezier(0.22, 0.7, 0.2, 1) 0.15s forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	.pop {
		transform-box: fill-box;
		transform-origin: center;
		animation: pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) both;
		animation-delay: calc(0.25s + var(--i) * 55ms);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.2);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	.step {
		cursor: pointer;
		outline: none;
	}
	.node {
		stroke: var(--surface);
		stroke-width: 3;
		filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.25));
		transition: transform 0.15s ease;
		transform-box: fill-box;
		transform-origin: center;
	}
	.step:hover .node,
	.step:focus-visible .node {
		transform: scale(1.12);
	}
	.step.on .node,
	.step:focus-visible .node {
		stroke: var(--ink-900);
	}
	.node.l1 {
		fill: color-mix(in srgb, var(--accent) 22%, var(--surface));
	}
	.node.l2 {
		fill: color-mix(in srgb, var(--accent) 48%, var(--surface));
	}
	.node.l3 {
		fill: color-mix(in srgb, var(--accent) 74%, var(--surface));
	}
	.node.l4 {
		fill: var(--accent);
	}
	.num {
		text-anchor: middle;
		dominant-baseline: central;
		font-size: 13px;
		font-weight: 700;
		pointer-events: none;
		fill: var(--ink-900);
	}
	.num.l3,
	.num.l4 {
		fill: #fff;
	}
	.pulse {
		fill: none;
		stroke: var(--accent);
		stroke-width: 2;
		transform-box: fill-box;
		transform-origin: center;
		animation: pulse 2.2s ease-out infinite;
	}
	@keyframes pulse {
		from {
			opacity: 0.6;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(1.9);
		}
	}
	.flag {
		fill: var(--ink-900);
		stroke: var(--surface);
		stroke-width: 2;
		filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.25));
	}
	.step.on .flag {
		fill: var(--accent);
	}
	.flag-mark {
		text-anchor: middle;
		dominant-baseline: central;
		font-size: 11px;
		fill: #fff;
		pointer-events: none;
	}
	.flag-cap {
		text-anchor: middle;
		font-size: 11px;
		font-weight: 600;
		fill: var(--ink-700);
		pointer-events: none;
	}
	.legend {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 8px;
		font-size: 12px;
		color: var(--ink-500);
	}
	.sw {
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	.sw.l1 {
		background: color-mix(in srgb, var(--accent) 22%, var(--surface));
	}
	.sw.l2 {
		background: color-mix(in srgb, var(--accent) 48%, var(--surface));
	}
	.sw.l3 {
		background: color-mix(in srgb, var(--accent) 74%, var(--surface));
	}
	.sw.l4 {
		background: var(--accent);
	}
	.sep {
		width: 14px;
	}
	.flag-sw {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--ink-900);
		transform: rotate(45deg);
		margin: 0 3px 0 4px;
	}
	.detail {
		margin-top: 14px;
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-m, 10px);
		background: var(--surface-2);
		animation: rise 0.25s ease both;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	.d-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.d-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 16px;
	}
	.big {
		font-size: 22px;
		font-weight: 600;
		color: var(--ink-900);
		line-height: 1.2;
		margin-top: 2px;
	}
	.big span {
		font-size: 13px;
		font-weight: 400;
		color: var(--ink-500);
	}
	.devs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
	@media (prefers-reduced-motion: reduce) {
		.trail,
		.pop,
		.pulse,
		.detail {
			animation: none;
		}
		.trail {
			stroke-dashoffset: 0;
		}
	}
</style>

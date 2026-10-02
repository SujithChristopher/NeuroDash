<script lang="ts">
	// The shared KPI + inflow + status-mix body rendered by both the Overview landing page and /analytics
	// (spec §7.8 — extracted so the two pages cannot drift apart).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import KpiCard from './KpiCard.svelte';
	import Chart from './Chart.svelte';
	import { statusTone } from '$lib/utils';

	interface Props {
		program: {
			total: number;
			active: number;
			newPatients: number;
			activePlans: number;
			statusMix: { status: string; count: number }[];
		};
		inflow: { labels: string[]; newValues: number[]; oldValues: number[]; overallValues: number[] };
		range: string;
	}
	let { program, inflow, range }: Props = $props();

	const RANGES = [
		['today', 'Today'],
		['week', 'Week'],
		['month', 'Month'],
		['year', 'Year']
	];
	const TONE_VAR: Record<string, string> = {
		good: 'var(--good)',
		warning: 'var(--warning)',
		critical: 'var(--critical)',
		accent: 'var(--accent)',
		info: 'var(--info)',
		neutral: 'var(--ink-400)',
		serious: 'var(--serious)'
	};
	const colors = $derived(program.statusMix.map((s) => TONE_VAR[statusTone(s.status)]));

	// Which inflow graph is shown: patients registered in the period, returning patients who trained in it, or both.
	const KINDS = [
		['new', 'New'],
		['old', 'Old'],
		['overall', 'Overall']
	] as const;
	const KIND_INFO = {
		new: { hint: 'Patients registered in each period', label: 'New patients', color: 'var(--accent)' },
		old: { hint: 'Returning patients (registered earlier) who trained in each period', label: 'Old patients', color: 'var(--series-2)' },
		overall: { hint: 'New and old patients together', label: 'All patients', color: 'var(--good)' }
	};
	let kind = $state<(typeof KINDS)[number][0]>('new');
	const values = $derived(kind === 'new' ? inflow.newValues : kind === 'old' ? inflow.oldValues : inflow.overallValues);

	function setRange(r: string) {
		const q = new URLSearchParams(page.url.searchParams);
		q.set('range', r);
		goto(`?${q}`, { noScroll: true, keepFocus: true });
	}
</script>

<div class="grid" style="margin-bottom:16px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
	<KpiCard label="Total Patients" value={program.total} icon="users" tone="accent" />
	<KpiCard label="Active Patients" value={program.active} icon="activity" tone="good" />
	<KpiCard label="New Patients (30d)" value={program.newPatients} icon="plus" tone="accent" />
	<KpiCard label="Active Plans" value={program.activePlans} icon="target" tone="good" />
	<KpiCard label="Completed / Discontinued" value="{program.statusMix.find((s) => s.status === 'Completed')?.count ?? 0} / {program.statusMix.find((s) => s.status === 'Discontinued')?.count ?? 0}" icon="check" tone="neutral" />
</div>

<div class="two-col">
	<div class="card">
		<div class="card-head">
			<div><h3>Patient inflow</h3><div class="hint">{KIND_INFO[kind].hint}</div></div>
			<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
			<div class="range-toggle" role="group" aria-label="Patients shown">
				{#each KINDS as [k, l] (k)}
					<button class:active={kind === k} onclick={() => (kind = k)}>{l}</button>
				{/each}
			</div>
			<div class="range-toggle">
				{#each RANGES as [k, l] (k)}
					<button class:active={range === k} onclick={() => setRange(k)}>{l}</button>
				{/each}
			</div>
			</div>
		</div>
		<div class="card-body">
			<Chart
				kind="area"
				labels={inflow.labels}
				datasets={[{ label: KIND_INFO[kind].label, data: values, color: KIND_INFO[kind].color }]}
				opts={{ maxTicksX: range === 'year' ? 12 : 8 }}
				height={220}
			/>
		</div>
	</div>
	<div class="card">
		<div class="card-head"><h3>Patient status mix</h3></div>
		<div class="card-body">
			{#if program.statusMix.length}
				<div style="display:flex;align-items:center;gap:18px">
					<div style="width:130px;flex-shrink:0">
						<Chart kind="donut" labels={program.statusMix.map((s) => s.status)} data={program.statusMix.map((s) => s.count)} {colors} height={130} />
					</div>
					<div class="legend-row" style="flex-direction:column;gap:8px">
						{#each program.statusMix as s, i (s.status)}
							<div class="legend-item"><span class="sw" style="background:{colors[i]}"></span>{s.status} <span class="mono muted">({s.count})</span></div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="muted" style="font-size:12.5px">No patients yet.</div>
			{/if}
		</div>
	</div>
</div>

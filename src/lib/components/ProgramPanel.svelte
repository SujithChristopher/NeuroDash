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
			totalSessions: number;
			therapyHours: number;
			assessments: number;
			statusMix: { status: string; count: number }[];
		};
		inflow: { labels: string[]; values: number[] };
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

	function setRange(r: string) {
		const q = new URLSearchParams(page.url.searchParams);
		q.set('range', r);
		goto(`?${q}`, { noScroll: true, keepFocus: true });
	}
</script>

<div class="grid grid-4" style="margin-bottom:16px">
	<KpiCard label="Total Patients" value={program.total} icon="users" tone="accent" />
	<KpiCard label="Active Patients" value={program.active} icon="activity" tone="good" />
	<KpiCard label="New Patients (30d)" value={program.newPatients} icon="plus" tone="accent" />
	<KpiCard label="Active Plans" value={program.activePlans} icon="target" tone="good" />
</div>
<div class="grid grid-4" style="margin-bottom:16px">
	<KpiCard label="Therapy Hours" value="{program.therapyHours}h" icon="clock" tone="info" />
	<KpiCard label="Total Sessions" value={program.totalSessions} icon="activity" tone="info" />
	<KpiCard label="Assessments Completed" value={program.assessments} icon="clipboard" tone="info" />
	<KpiCard label="Completed / Discontinued" value="{program.statusMix.find((s) => s.status === 'Completed')?.count ?? 0} / {program.statusMix.find((s) => s.status === 'Discontinued')?.count ?? 0}" icon="check" tone="neutral" />
</div>

<div class="two-col">
	<div class="card">
		<div class="card-head">
			<div><h3>Patient inflow</h3><div class="hint">New patient registrations over time</div></div>
			<div class="range-toggle">
				{#each RANGES as [k, l] (k)}
					<button class:active={range === k} onclick={() => setRange(k)}>{l}</button>
				{/each}
			</div>
		</div>
		<div class="card-body">
			<Chart
				kind="area"
				labels={inflow.labels}
				datasets={[{ label: 'New patients', data: inflow.values, color: 'var(--accent)' }]}
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

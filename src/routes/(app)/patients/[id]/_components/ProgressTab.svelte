<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { GAME_LABELS } from '$lib/constants';
	import { catColor } from '$lib/charts/config';
	import { daySeries } from './series';
	import type { PageData } from '../$types';
	import type { computePatientStats } from '$lib/patientStats';

	let { data, stats }: { data: PageData; stats: ReturnType<typeof computePatientStats> } = $props();

	let range = $state<'7' | '14' | 'all'>('all');

	const plan = $derived(stats.plan ? data.plans.find((p) => p.id === stats.plan!.id)! : null);
	const series = $derived.by(() => {
		const all = plan ? daySeries(plan.dayLog, data.sessions) : [];
		return range === 'all' ? all : all.slice(-Number(range));
	});
	const withAcc = $derived(series.filter((s) => s.accuracy !== null));

	const games = $derived.by(() => {
		const m = new Map<string, number>();
		for (const s of data.sessions) for (const t of s.trials) if (t.gameId) m.set(t.gameId, (m.get(t.gameId) ?? 0) + 1);
		return [...m.entries()];
	});
	const mechs = $derived.by(() => {
		const m = new Map<string, number>();
		for (const s of data.sessions) for (const t of s.trials) if (t.mechanism) m.set(t.mechanism, (m.get(t.mechanism) ?? 0) + 1);
		return [...m.entries()];
	});
</script>

{#if !plan}
	<div class="card"><EmptyState icon="trend" title="No progress data yet" sub="Progress charts appear once therapy sessions begin." /></div>
{:else}
	<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
		<div class="range-toggle">
			{#each [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['all', 'Full plan']] as [k, l] (k)}
				<button class:active={range === k} onclick={() => (range = k as typeof range)}>{l}</button>
			{/each}
		</div>
	</div>
	<div class="grid grid-2" style="margin-bottom:16px">
		<div class="card">
			<div class="card-head"><h3>Accuracy over time</h3></div>
			<div class="card-body">
				{#if withAcc.length}
					<Chart kind="area" labels={withAcc.map((s) => 'D' + s.day)} datasets={[{ label: 'Accuracy %', data: withAcc.map((s) => s.accuracy), color: 'var(--series-1)' }]} opts={{ suggestedMax: 100 }} height={210} />
				{:else}<EmptyState icon="trend" title="No sessions in this range" />{/if}
			</div>
		</div>
		<div class="card">
			<div class="card-head"><h3>Stars earned per day</h3></div>
			<div class="card-body">
				{#if series.length}
					<Chart kind="bar" labels={series.map((s) => 'D' + s.day)} datasets={[{ label: 'Stars', data: series.map((s) => s.stars), color: 'var(--warning)' }]} height={210} />
				{:else}<EmptyState icon="star" title="No days in this range" />{/if}
			</div>
		</div>
	</div>
	<div class="grid grid-2">
		<div class="card">
			<div class="card-head"><h3>Game distribution</h3></div>
			<div class="card-body">
				{#if games.length}
					<div style="display:flex;align-items:center;gap:18px">
						<div style="width:140px;flex-shrink:0">
							<Chart kind="donut" labels={games.map(([g]) => GAME_LABELS[g] ?? g)} data={games.map(([, n]) => n)} height={140} />
						</div>
						<div class="legend-row" style="flex-direction:column;gap:8px">
							{#each games as [g, n], i (g)}
								<div class="legend-item">
									<span class="sw" style="background:var(--series-{(i % 6) + 1})"></span>{GAME_LABELS[g] ?? g} <span class="mono muted">({n})</span>
								</div>
							{/each}
						</div>
					</div>
				{:else}<EmptyState icon="target" title="No game data recorded" />{/if}
			</div>
		</div>
		<div class="card">
			<div class="card-head"><h3>Mechanism usage</h3></div>
			<div class="card-body">
				{#if mechs.length}
					<Chart kind="bar" labels={mechs.map(([m]) => m)} datasets={[{ label: 'Trials', data: mechs.map(([, n]) => n), color: 'var(--series-3)' }]} opts={{ horizontal: true }} height={210} />
				{:else}<EmptyState icon="activity" title="No mechanism data recorded" />{/if}
			</div>
		</div>
	</div>
{/if}

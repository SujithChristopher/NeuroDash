<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import { GAME_LABELS, MECHANISM_LABELS, labelFor, movementTerm } from '$lib/constants';
	import { fmtHrsFromMin } from '$lib/utils';
	import { countTrials, deviceDaily, deviceTotals, devicesOf, durationByDay } from './series';
	import type { PageData } from '../$types';

	let { data }: { data: PageData } = $props();

	let range = $state<'7' | '14' | 'all'>('all');
	let picked = $state<string | null>(null);

	const lastDays = $derived(range === 'all' ? null : Number(range));
	const sessions = $derived(data.sessions);
	const devices = $derived(devicesOf(sessions));
	// Progress is per device: a PLUTO session and a MARS session measure different things, so they are never mixed.
	const active = $derived(devices.find((d) => d.typeId === picked) ?? devices[0]);

	const duration = $derived(durationByDay(sessions, devices, lastDays));
	const daily = $derived(active ? deviceDaily(sessions, active.typeId, lastDays) : []);
	const withAccuracy = $derived(daily.filter((d) => d.accuracy !== null));
	const totals = $derived(active ? deviceTotals(sessions, active.typeId) : null);
	const games = $derived(active ? countTrials(sessions, active.typeId, (t) => t.gameCode ?? t.gameId) : []);
	const mechanisms = $derived(active ? countTrials(sessions, active.typeId, (t) => t.mechanism) : []);
	const term = $derived(movementTerm(active?.typeId));
	const sessionCount = (typeId: string) => sessions.filter((s) => s.device.typeId === typeId).length;
</script>

{#if sessions.length === 0}
	<div class="card"><EmptyState icon="trend" title="No progress data yet" sub="Charts appear once the training devices upload sessions." /></div>
{:else}
	<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
		<div class="range-toggle">
			{#each [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['all', 'All time']] as [k, l] (k)}
				<button class:active={range === k} onclick={() => (range = k as typeof range)}>{l}</button>
			{/each}
		</div>
	</div>

	<div class="card" style="margin-bottom:20px">
		<div class="card-head">
			<div><h3>Therapy time per day</h3><div class="hint">Active minutes, stacked by device</div></div>
		</div>
		<div class="card-body">
			{#if duration.days.length}
				<Chart kind="bar" labels={duration.labels} datasets={duration.datasets} opts={{ stacked: true, legend: true, valueSuffix: ' min', thick: 26 }} height={240} />
			{:else}<EmptyState icon="activity" title="No sessions in this range" />{/if}
		</div>
	</div>

	{#if active && totals}
		<div class="section-title-row" style="margin-top:0">
			<h2>Progress by device</h2>
			<span class="muted" style="font-size:12px">Each device is measured on its own</span>
		</div>
		<div class="device-tabs" role="tablist" aria-label="Training device">
			{#each devices as d (d.typeId)}
				<button role="tab" aria-selected={d.typeId === active.typeId} class="device-tab" class:on={d.typeId === active.typeId} onclick={() => (picked = d.typeId)}>
					<span class="dot" style="background:{d.color}"></span>{d.name}<span class="n">{sessionCount(d.typeId)}</span>
				</button>
			{/each}
		</div>

		<div class="grid grid-4" style="margin:16px 0">
			<KpiCard label="{active.name} sessions" value={totals.sessions} icon="activity" tone="accent" />
			<KpiCard label="Therapy time" value={fmtHrsFromMin(totals.minutes)} icon="clock" tone="info" sub="{totals.trials} trials" />
			<KpiCard label="Stars earned" value={totals.stars} icon="star" tone="warning" />
			<KpiCard label="Hit rate" value={totals.accuracy === null ? '—' : `${totals.accuracy}%`} icon="gauge" tone="good" />
		</div>

		<div class="grid grid-2" style="margin-bottom:16px">
			<div class="card">
				<div class="card-head"><h3>Accuracy over time</h3></div>
				<div class="card-body">
					{#if withAccuracy.length}
						<Chart kind="area" labels={withAccuracy.map((s) => s.label)} datasets={[{ label: 'Accuracy %', data: withAccuracy.map((s) => s.accuracy), color: active.color }]} opts={{ suggestedMax: 100 }} height={210} />
					{:else}<EmptyState icon="trend" title="No {active.name} sessions in this range" />{/if}
				</div>
			</div>
			<div class="card">
				<div class="card-head"><h3>Stars earned per day</h3></div>
				<div class="card-body">
					{#if daily.length}
						<Chart kind="bar" labels={daily.map((s) => s.label)} datasets={[{ label: 'Stars', data: daily.map((s) => s.stars), color: 'var(--warning)' }]} height={210} />
					{:else}<EmptyState icon="star" title="No days in this range" />{/if}
				</div>
			</div>
		</div>

		<div class="grid grid-2">
			<div class="card">
				<div class="card-head"><h3>Games played</h3></div>
				<div class="card-body">
					{#if games.length}
						<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
							<div style="width:140px;flex-shrink:0">
								<Chart kind="donut" labels={games.map(([g]) => labelFor(GAME_LABELS, g))} data={games.map(([, n]) => n)} height={140} />
							</div>
							<div class="legend-row" style="flex-direction:column;gap:8px">
								{#each games as [g, n], i (g)}
									<div class="legend-item"><span class="sw" style="background:var(--series-{(i % 10) + 1})"></span>{labelFor(GAME_LABELS, g)} <span class="mono muted">({n})</span></div>
								{/each}
							</div>
						</div>
					{:else}<EmptyState icon="target" title="No game data recorded" />{/if}
				</div>
			</div>
			<div class="card">
				<div class="card-head"><h3>{term}s trained</h3><span class="hint">trials per {term.toLowerCase()}</span></div>
				<div class="card-body">
					{#if mechanisms.length}
						<Chart kind="bar" labels={mechanisms.map(([m]) => labelFor(MECHANISM_LABELS, m))} datasets={[{ label: 'Trials', data: mechanisms.map(([, n]) => n), color: active.color }]} opts={{ horizontal: true }} height={210} />
					{:else}<EmptyState icon="activity" title="No {term.toLowerCase()} data recorded" />{/if}
				</div>
			</div>
		</div>
	{/if}
{/if}

<style>
	.device-tabs {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.device-tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 8px 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink-700);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		cursor: pointer;
	}
	.device-tab:hover {
		background: var(--surface-2);
	}
	.device-tab.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent-soft-ink);
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.n {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--ink-500);
		background: var(--surface-3);
		border-radius: 999px;
		padding: 1px 7px;
	}
</style>

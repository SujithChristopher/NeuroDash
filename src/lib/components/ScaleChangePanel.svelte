<script lang="ts">
	// One graph per assessment scale: the average score of all patients from Day 1 to Day 30 of their treatment.
	import Chart from './Chart.svelte';
	import EmptyState from './EmptyState.svelte';
	import type { ScaleChange } from '$lib/scaleChanges';

	let { scales }: { scales: ScaleChange[] } = $props();
	const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
</script>

{#if scales.length === 0}
	<div class="card"><EmptyState icon="clipboard" title="No scored assessments yet" sub="Once patients have assessments, each scale's average change over the first 30 days appears here." /></div>
{:else}
	<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px">
		{#each scales as sc (sc.scaleId)}
			<div class="card">
				<div class="card-head">
					<h3>{sc.title}</h3>
					<span class="hint">{sc.patients} patient{sc.patients === 1 ? '' : 's'}</span>
				</div>
				<div class="card-body">
					{#if sc.points.length >= 2}
						<Chart kind="area" labels={sc.points.map((p) => p.label)} datasets={[{ label: 'Average score %', data: sc.points.map((p) => p.meanPct), color: 'var(--accent)' }]} opts={{ suggestedMax: 100 }} height={170} />
					{:else}
						<div class="muted" style="font-size:12.5px;padding:8px 0">Only one point so far ({sc.points[0].meanPct}% at {sc.points[0].label}). A trend needs at least two.</div>
					{/if}
					<div class="note">
						{#if sc.change}
							<b>{sc.change.pctPoints === 0 ? 'No change' : `Changed by ${sign(sc.change.pctPoints)} percentage points`}</b>
							on average ({sc.change.fromPct}% → {sc.change.toPct}%) across the {sc.change.patients} patient{sc.change.patients === 1 ? '' : 's'} assessed at the start and again within 30 days.
						{:else}
							Nobody has been assessed twice in the first 30 days yet.
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.note {
		font-size: 12.5px;
		color: var(--ink-700);
		background: var(--surface-2);
		border-radius: var(--radius-s);
		padding: 8px 10px;
		margin-top: 8px;
	}
</style>

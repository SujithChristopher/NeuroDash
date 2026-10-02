<script lang="ts">
	// One graph per selected assessment scale. Pick any number of scales with the chips; each gets its own chart.
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { scaleTrends } from './series';

	type A = Parameters<typeof scaleTrends>[0][number];
	let { assessments, height = 200 }: { assessments: A[]; height?: number } = $props();

	const trends = $derived(scaleTrends(assessments));
	// Selected scale ids; null means "not chosen yet" and shows the first scale.
	let chosen = $state<string[] | null>(null);
	const selected = $derived(chosen ?? (trends[0] ? [trends[0].typeId] : []));
	const shown = $derived(trends.filter((t) => selected.includes(t.typeId)));

	function toggle(id: string) {
		chosen = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}
</script>

{#if trends.length === 0}
	<EmptyState icon="clipboard" title="No scored assessments yet" sub="Record an assessment with a score to see its trend." />
{:else}
	<div class="chips" role="group" aria-label="Scales to graph">
		{#each trends as t (t.typeId)}
			<button type="button" class="chip" class:on={selected.includes(t.typeId)} aria-pressed={selected.includes(t.typeId)} onclick={() => toggle(t.typeId)}>
				{#if selected.includes(t.typeId)}<Icon name="check" size={12} />{/if}<span class="dot" style="background:{t.color}"></span>{t.typeName}
			</button>
		{/each}
	</div>
	{#if shown.length === 0}
		<div class="muted" style="font-size:12.5px;padding:8px 0">Choose a scale above to see its graph.</div>
	{/if}
	{#each shown as t (t.typeId)}
		<div class="trend">
			<div class="trend-head"><strong>{t.typeName}</strong><span class="muted">{t.count} assessment{t.count === 1 ? '' : 's'} · score %</span></div>
			{#if t.count >= 2}
				<Chart kind="area" labels={t.labels} datasets={[{ label: t.typeName, data: t.data, color: t.color }]} opts={{ suggestedMax: 100 }} {height} />
			{:else}
				<div class="muted" style="font-size:12.5px;padding:10px 0">One assessment so far ({t.data[0]}%). A trend needs at least two.</div>
			{/if}
		</div>
	{/each}
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 4px 12px;
		font: inherit;
		font-size: 12.5px;
		color: var(--ink-700);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		cursor: pointer;
	}
	.chip.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent-soft-ink);
		font-weight: 600;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.trend + .trend {
		margin-top: 18px;
	}
	.trend-head {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 13px;
		margin-bottom: 6px;
	}
</style>

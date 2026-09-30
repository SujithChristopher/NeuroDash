<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Chart from '$lib/components/Chart.svelte';
	import { fmtHrsFromMin } from '$lib/utils';

	let { data } = $props();
	const top = $derived(data.rows.slice(0, 8));
</script>

<PageHead title="Device Usage" sub="Comparative operational usage across all connected devices." />

<div class="card" style="margin-bottom:18px">
	<div class="card-head"><h3>Usage time by device</h3></div>
	<div class="card-body">
		<Chart
			kind="bar"
			labels={top.map((r) => r.displayCode)}
			datasets={[{ label: 'Hours used', data: top.map((r) => +(r.totalMin / 60).toFixed(1)), color: 'var(--accent)' }]}
			opts={{ horizontal: true, thick: 18 }}
			height={280}
		/>
	</div>
</div>

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead><tr><th>Device</th><th>Type</th><th>Sessions</th><th>Time</th><th>Avg Accuracy</th><th>Stars</th></tr></thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr class="clickable" onclick={() => goto(`/devices/${r.id}`)}>
						<td class="mono dt-name">{r.displayCode}</td><td>{r.category}</td><td>{r.sessions}</td>
						<td>{fmtHrsFromMin(r.totalMin)}</td><td class="mono">{r.avgAccuracy}%</td><td>{r.totalStars}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { adherenceTone } from '$lib/utils';

	let { data } = $props();
</script>

<PageHead title="Therapy Plans" sub="{data.rows.length} plan record{data.rows.length === 1 ? '' : 's'}." />

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead>
				<tr><th>Patient</th><th>Plan</th><th>Devices</th><th>Day</th><th>Adherence</th><th>Completion</th><th>Status</th></tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr class="clickable" onclick={() => goto(`/patients/${r.patient.id}?tab=plan`)}>
						<td><div class="dt-name">{r.patient.name}</div><div class="dt-sub">{r.patient.displayCode}</div></td>
						<td>{r.name}</td>
						<td class="muted">{r.devices.join(', ')}</td>
						<td class="mono">{r.currentDay}/{r.durationDays}</td>
						<td><Badge text="{r.adherence}%" tone={adherenceTone(r.adherence)} /></td>
						<td>
							<div class="progress-row" style="max-width:120px">
								<div class="progress-track"><div class="progress-fill" style="width:{Math.min(100, r.completionPct)}%"></div></div>
								<span class="pv mono">{r.completionPct}%</span>
							</div>
						</td>
						<td><Badge text={r.status} /></td>
					</tr>
				{:else}
					<tr><td colspan="7"><EmptyState icon="target" title="No therapy plans created yet" /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

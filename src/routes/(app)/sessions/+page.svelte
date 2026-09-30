<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SessionDrawer from '$lib/components/SessionDrawer.svelte';
	import { fmtDateTime, fmtMin } from '$lib/utils';

	let { data } = $props();
	let open = $state<string | null>(null);
</script>

<PageHead
	title="Sessions"
	sub="{data.total} device-assisted therapy session{data.total === 1 ? '' : 's'} recorded. Click any session for targets, accuracy, stars and the trial-by-trial breakdown."
/>

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead><tr><th>Patient</th><th>Date</th><th>Device</th><th>Duration</th><th></th></tr></thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr class="clickable" onclick={() => (open = r.id)}>
						<td><div class="dt-name">{r.patient.name}</div><div class="dt-sub">{r.patient.displayCode}</div></td>
						<td class="mono">{fmtDateTime(r.startTime)}</td>
						<td class="mono">{r.deviceCode}</td>
						<td>{fmtMin(r.durationMinutes ?? 0)}</td>
						<td class="row-chevron"><Icon name="chevron" size={14} /></td>
					</tr>
				{:else}
					<tr><td colspan="5"><EmptyState icon="activity" title="No sessions found" /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

{#if open}<SessionDrawer sessionId={open} onclose={() => (open = null)} />{/if}

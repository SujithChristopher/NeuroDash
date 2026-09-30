<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toastEnhance } from '$lib/enhance';
	import { fmtDateShort } from '$lib/utils';

	let { data } = $props();
	let logging = $state(false);
	let deviceId = $state('');
	const today = new Date().toISOString().slice(0, 10);
</script>

<PageHead title="Maintenance" sub="Scheduled and completed maintenance across the device fleet.">
	{#snippet actions()}
		{#if data.canLog}
			<button class="btn btn-primary" onclick={() => (logging = true)}><Icon name="plus" size={15} /> Log maintenance</button>
		{/if}
	{/snippet}
</PageHead>

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead><tr><th>Device</th><th>Type</th><th>Date</th><th>Engineer</th><th>Notes</th></tr></thead>
			<tbody>
				{#each data.records as m (m.id)}
					<tr>
						<td><a class="mono dt-name" href="/devices/{m.device.id}?tab=maintenance">{m.device.displayCode}</a></td>
						<td>{m.type}</td><td class="mono">{fmtDateShort(m.date)}</td><td>{m.engineer}</td><td class="muted">{m.notes ?? '—'}</td>
					</tr>
				{:else}
					<tr><td colspan="5"><EmptyState icon="wrench" title="No maintenance recorded yet" /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

{#if logging}
	<Modal title="Log maintenance" onclose={() => (logging = false)}>
		<form
			id="log-maint"
			method="POST"
			action={deviceId ? `/devices/${deviceId}?/logMaintenance` : undefined}
			use:enhance={toastEnhance({ onSuccess: () => (logging = false), reset: true })}
		>
			<div class="field">
				<label for="lm-dev">Device</label>
				<select id="lm-dev" bind:value={deviceId} required>
					<option value="">Select a device…</option>
					{#each data.devices as d (d.id)}<option value={d.id}>{d.displayCode}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label for="lm-type">Maintenance type</label>
				<select id="lm-type" name="maintenanceType" required>{#each data.types as t (t)}<option>{t}</option>{/each}</select>
			</div>
			<div class="field"><label for="lm-date">Date</label><input id="lm-date" name="maintenanceDate" type="date" value={today} max={today} required /></div>
			<div class="field"><label for="lm-notes">Notes</label><textarea id="lm-notes" name="notes" maxlength="2000"></textarea></div>
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (logging = false)}>Cancel</button>
			<button class="btn btn-primary" form="log-maint" disabled={!deviceId}>Save</button>
		{/snippet}
	</Modal>
{/if}

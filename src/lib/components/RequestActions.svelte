<script lang="ts">
	// Engineer actions for a device request. Posts to the /device-requests form actions
	// from anywhere (the requests page and the Issues page), then refreshes the current page.
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast';
	import { REQUEST_CLEARED, REQUEST_PENDING } from '$lib/constants';

	let {
		request,
		available
	}: {
		request: { id: string; status: string; deviceType: { id: string } };
		available: { id: string; displayCode: string; deviceTypeId: string }[];
	} = $props();

	const units = $derived(available.filter((d) => d.deviceTypeId === request.deviceType.id));
	let deviceId = $state('');

	const submit = () => async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
		const d = result.data as { message?: string; error?: string } | undefined;
		if (result.type === 'success') toast(d?.message ?? 'Done.');
		else if (result.type === 'failure') toast(d?.error ?? 'Could not complete that.', 'critical');
		await invalidateAll();
	};
</script>

{#if request.status === REQUEST_PENDING}
	<div style="display:flex;gap:6px">
		<form method="POST" action="/device-requests?/clear" use:enhance={submit}>
			<input type="hidden" name="id" value={request.id} />
			<button class="btn btn-secondary btn-sm">Inspect &amp; Clear</button>
		</form>
		<form method="POST" action="/device-requests?/decline" use:enhance={submit}>
			<input type="hidden" name="id" value={request.id} />
			<button class="btn btn-ghost btn-sm">Decline</button>
		</form>
	</div>
{:else if request.status === REQUEST_CLEARED}
	<form method="POST" action="/device-requests?/assign" use:enhance={submit} style="display:flex;gap:6px;align-items:center">
		<input type="hidden" name="id" value={request.id} />
		<select name="deviceId" class="filter-select" bind:value={deviceId} required aria-label="Unit to assign">
			<option value="">{units.length ? 'Pick a unit…' : 'No unit available'}</option>
			{#each units as u (u.id)}<option value={u.id}>{u.displayCode}</option>{/each}
		</select>
		<button class="btn btn-primary btn-sm" disabled={!deviceId}>Assign</button>
	</form>
{:else}
	<span class="muted" style="font-size:12px">—</span>
{/if}

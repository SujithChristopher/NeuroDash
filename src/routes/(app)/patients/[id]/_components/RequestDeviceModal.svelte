<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from '../$types';

	let { data, form, onclose }: { data: PageData; form: unknown; onclose: () => void } = $props();
	const err = $derived((form as { requestError?: string } | null)?.requestError);
	let busy = $state(false);
</script>

<Modal title="Request device — {data.patient.name}" {onclose}>
	<form
		id="req-device"
		method="POST"
		action="?/requestDevice"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				busy = false;
				if (result.type === 'success') onclose();
			};
		}}
	>
		<div class="field">
			<label for="rq-type">Device type</label>
			<select id="rq-type" name="deviceTypeId" required>
				<option value="">Select a device type…</option>
				{#each data.deviceTypes as d (d.id)}<option value={d.id}>{d.name} — {d.category}</option>{/each}
			</select>
			<div class="field-hint">Engineering reviews the request, clears a specific unit and assigns it.</div>
		</div>
		<div class="field"><label for="rq-notes">Notes for engineering</label><textarea id="rq-notes" name="notes" maxlength="1000"></textarea></div>
		{#if err}<div class="alert alert-critical"><Icon name="alert" size={15} /><span>{err}</span></div>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={onclose}>Cancel</button>
		<button class="btn btn-primary" form="req-device" disabled={busy}>Send request</button>
	{/snippet}
</Modal>

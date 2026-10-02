<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { PLAN_STATUSES } from '$lib/constants';
	import type { PageData } from '../$types';

	import { untrack } from 'svelte';

	let {
		plan,
		data,
		form,
		onclose
	}: { plan: PageData['plans'][number]; data: PageData; form: unknown; onclose: () => void } = $props();

	// Devices and side start at the plan's current values; the therapist adds or removes devices here.
	let picked = $state<string[]>(untrack(() => plan.devices.map((d) => d.id)));
	const toggle = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

	const f = $derived(form as { editError?: string; ok?: boolean; message?: string } | null);
	let busy = $state(false);
</script>

<Modal title="Modify Therapy Plan" {onclose}>
	<form
		id="edit-plan"
		method="POST"
		action="?/editPlan"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				busy = false;
				if (result.type === 'success') onclose();
			};
		}}
	>
		<input type="hidden" name="planId" value={plan.id} />
		<div class="form-grid">
			<div class="field">
				<label for="ep-status">Plan status</label>
				<select id="ep-status" name="status" value={plan.status}>
					{#each PLAN_STATUSES as s (s)}<option>{s}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label for="ep-side">Affected side to train</label>
				<select id="ep-side" name="trainingSide" value={plan.trainingSide ?? 'Left'}><option>Left</option><option>Right</option><option>Both</option></select>
			</div>
			<div class="field full">
				<span style="display:block;font-size:12.5px;font-weight:600;color:var(--ink-700);margin-bottom:6px">Devices</span>
				<div style="display:flex;gap:8px;flex-wrap:wrap">
					{#each data.allDeviceTypes as d (d.id)}
						<label class="demo-acct" class:active={picked.includes(d.id)} style="cursor:pointer;display:block;min-height:44px">
							<input type="checkbox" name="deviceTypeIds" value={d.id} checked={picked.includes(d.id)} onchange={() => toggle(d.id)} style="width:auto;margin-right:6px" />
							<span class="da-name" style="display:inline">{d.name}</span>
						</label>
					{/each}
				</div>
				<div class="field-hint">Adding or removing a device updates the patient's training devices and patients.json for the laptops.</div>
			</div>
			<div class="field"><label for="ep-target">Daily target (minutes)</label><input id="ep-target" name="dailyTargetMinutes" type="number" min="1" max="600" value={plan.dailyTargetMinutes} required /></div>
			<div class="field"><label for="ep-sess">Target sessions</label><input id="ep-sess" name="targetSessions" type="number" min="1" value={plan.targetSessions ?? ''} required /></div>
			<div class="field full"><label for="ep-notes">Plan notes</label><textarea id="ep-notes" name="notes">{plan.notes ?? ''}</textarea></div>
			<div class="field full">
				<label for="ep-reason">Reason for modification <span class="muted">(required)</span></label>
				<textarea id="ep-reason" name="reason" placeholder="Clinical rationale for this change…" required></textarea>
			</div>
		</div>
		<div class="confirm-box">
			<Icon name="alert" size={14} /> This is a clinically significant change. It is recorded in the plan’s history with your name, role and timestamp — the previous value is preserved, never overwritten.
		</div>
		{#if f?.editError}<div class="alert alert-critical"><Icon name="alert" size={15} /><span>{f.editError}</span></div>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={onclose}>Cancel</button>
		<button class="btn btn-primary" form="edit-plan" disabled={busy || picked.length === 0}><Icon name="check" size={14} /> Save Modification</button>
	{/snippet}
</Modal>

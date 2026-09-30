<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { PLAN_STATUSES } from '$lib/constants';
	import type { PageData } from '../$types';

	let {
		plan,
		form,
		onclose
	}: { plan: PageData['plans'][number]; form: unknown; onclose: () => void } = $props();

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
		<button class="btn btn-primary" form="edit-plan" disabled={busy}><Icon name="check" size={14} /> Save Modification</button>
	{/snippet}
</Modal>

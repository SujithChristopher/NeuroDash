<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from '../$types';

	let { data, form, onclose }: { data: PageData; form: unknown; onclose: () => void } = $props();

	const err = $derived((form as { planError?: string } | null)?.planError);
	const today = new Date().toISOString().slice(0, 10);
	let busy = $state(false);
	let selected = $state<string[]>([]);
	let duration = $state(29);

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}
</script>

<Modal title="Create Therapy Plan — {data.patient.name}" wide {onclose}>
	<form
		id="new-plan"
		method="POST"
		action="?/createPlan"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<div class="form-grid">
			<div class="field"><label for="pl-name">Plan name</label><input id="pl-name" name="name" type="text" value="Upper-Limb Motor Recovery Plan" required /></div>
			<div class="field"><label for="pl-start">Start date</label><input id="pl-start" name="startDate" type="date" value={today} required /></div>
			<div class="field"><label for="pl-dur">Duration (days)</label><input id="pl-dur" name="durationDays" type="number" min="1" max="365" bind:value={duration} required /></div>
			<div class="field"><label for="pl-target">Daily target duration (minutes)</label><input id="pl-target" name="dailyTargetMinutes" type="number" min="1" max="600" value="60" required /></div>
			<div class="field"><label for="pl-sessions">Target number of sessions</label><input id="pl-sessions" name="targetSessions" type="number" min="1" value={duration} /></div>
			<div class="field full">
				<span class="field-label" style="display:block;font-size:12.5px;font-weight:600;color:var(--ink-700);margin-bottom:6px">Devices involved</span>
				<div style="display:flex;gap:8px;flex-wrap:wrap">
					{#each data.deviceTypes as d (d.id)}
						<label class="demo-acct" class:active={selected.includes(d.id)} style="cursor:pointer;display:block">
							<input type="checkbox" name="deviceTypeIds" value={d.id} checked={selected.includes(d.id)} onchange={() => toggle(d.id)} style="width:auto;margin-right:6px" />
							<span class="da-name" style="display:inline">{d.name}</span>
							<div class="da-role">{d.category}</div>
						</label>
					{/each}
				</div>
				<div class="field-hint">Select one or more device types for this plan.</div>
			</div>
			<div class="field full"><label for="pl-goals">Therapy goals</label><input id="pl-goals" name="goals" type="text" value={data.patient.therapyGoals.join('; ')} /></div>
			<div class="field full"><label for="pl-notes">Notes</label><textarea id="pl-notes" name="notes">Progressive intensity plan with device-assisted repetitive task training.</textarea></div>
		</div>
		{#if err}<div class="alert alert-critical" style="margin-top:12px"><Icon name="alert" size={15} /><span>{err}</span></div>{/if}
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={onclose}>Cancel</button>
		<button class="btn btn-primary" form="new-plan" disabled={busy || selected.length === 0}><Icon name="check" size={14} /> Create Plan</button>
	{/snippet}
</Modal>

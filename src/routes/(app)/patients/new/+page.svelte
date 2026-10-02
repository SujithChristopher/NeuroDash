<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { ageFrom } from '$lib/utils';

	let { data, form } = $props();
	let busy = $state(false);
	let dob = $state('');
	const age = $derived(dob ? ageFrom(dob) : null);
	const today = new Date().toISOString().slice(0, 10);
</script>

<PageHead title="New Patient" sub="Register a patient with their hospital Patient ID.">
	{#snippet actions()}<a class="btn btn-ghost" href="/patients">Cancel</a>{/snippet}
</PageHead>

<form
	class="card card-pad"
	method="POST"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	}}
>
	<div class="form-grid">
		<div class="field">
			<label for="f-pid">Patient ID</label>
			<input id="f-pid" name="patientId" type="text" required maxlength="40" pattern="[A-Za-z0-9_\-]+" placeholder="Hospital ID, e.g. HOCMCV002" autocomplete="off" />
			<div class="field-hint">
				The ID entered on the training devices.{#if data.folderEnabled} A folder with this name is created on the local server.{/if} Letters, digits, - and _ only.
			</div>
		</div>
		<div class="field">
			<label for="f-gender">Gender</label>
			<select id="f-gender" name="gender" required><option>Female</option><option>Male</option><option>Other</option></select>
		</div>
		<div class="field">
			<label for="f-dob">Date of birth</label>
			<input id="f-dob" name="dob" type="date" required max={today} bind:value={dob} />
		</div>
		<div class="field">
			<label for="f-age">Age</label>
			<input id="f-age" type="text" value={age != null ? `${age} years` : ''} placeholder="Calculated from date of birth" readonly tabindex="-1" />
		</div>
		<div class="field">
			<label for="f-side">Affected side</label>
			<select id="f-side" name="affectedSide" required><option>Left</option><option>Right</option><option>Bilateral</option></select>
		</div>
		<div class="field"><label for="f-stroke">Stroke / injury date</label><input id="f-stroke" name="strokeDate" type="date" max={today} /></div>
	</div>

	{#if form?.error}
		<div class="alert alert-critical" style="margin:14px 0"><Icon name="alert" size={15} /><span>{form.error}</span></div>
	{/if}
	<div style="display:flex;justify-content:flex-end;gap:10px;padding-top:8px;margin-top:14px;border-top:1px solid var(--border)">
		<a class="btn btn-secondary" href="/patients">Cancel</a>
		<button class="btn btn-primary" disabled={busy}><Icon name="check" size={15} /> Create Patient</button>
	</div>
</form>

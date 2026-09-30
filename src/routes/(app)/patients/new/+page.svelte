<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { DIAGNOSES, MOBILITY } from '$lib/constants';

	let { form } = $props();

	let busy = $state(false);
	let diagnosis = $state(DIAGNOSES[0].label);
	let side = $state(DIAGNOSES[0].side);
	let files = $state<File[]>([]);
	let picker = $state<HTMLInputElement>();

	function onDiagnosis() {
		side = DIAGNOSES.find((d) => d.label === diagnosis)?.side ?? side;
	}

	function pick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		files = [...files, ...Array.from(input.files ?? [])];
		input.value = '';
	}

	function buildData(fd: FormData) {
		fd.delete('documents');
		for (const f of files) fd.append('documents', f);
	}
</script>

<PageHead title="New Patient" sub="Register a new patient and capture clinical intake information.">
	{#snippet actions()}<a class="btn btn-ghost" href="/patients">Cancel</a>{/snippet}
</PageHead>

<form
	class="card card-pad"
	method="POST"
	enctype="multipart/form-data"
	use:enhance={({ formData }) => {
		busy = true;
		buildData(formData);
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	}}
>
	<div class="form-section">
		<div class="form-section-head"><span class="num">1</span><h3>Patient Information</h3></div>
		<div class="form-grid">
			<div class="field"><label for="f-name">Full name</label><input id="f-name" name="name" type="text" required placeholder="e.g. Ananya R." /></div>
			<div class="field"><label for="f-dob">Date of birth</label><input id="f-dob" name="dob" type="date" required /></div>
			<div class="field">
				<label for="f-gender">Gender</label>
				<select id="f-gender" name="gender"><option>Female</option><option>Male</option><option>Other</option></select>
			</div>
			<div class="field"><label for="f-phone">Contact number</label><input id="f-phone" name="contactPhone" type="text" required placeholder="+91 98765 43210" /></div>
			<div class="field full"><label for="f-emerg">Emergency contact</label><input id="f-emerg" name="emergencyContact" type="text" required placeholder="Name (Relation) · Phone" /></div>
			<div class="field full"><label for="f-clin">Relevant clinical information</label><input id="f-clin" name="clinicalInfo" type="text" placeholder="e.g. Hypertension, controlled on medication" /></div>
			<div class="field full"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" placeholder="Any additional intake notes…"></textarea></div>
		</div>
	</div>

	<div class="form-section">
		<div class="form-section-head"><span class="num">2</span><h3>Rehabilitation Information</h3></div>
		<div class="form-grid">
			<div class="field">
				<label for="f-diag">Diagnosis</label>
				<select id="f-diag" name="diagnosis" bind:value={diagnosis} onchange={onDiagnosis}>
					{#each DIAGNOSES as d (d.label)}<option>{d.label}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label for="f-side">Affected side</label>
				<select id="f-side" name="affectedSide" bind:value={side}><option>Left</option><option>Right</option><option>Bilateral</option></select>
			</div>
			<div class="field"><label for="f-stroke">Stroke / injury date (if applicable)</label><input id="f-stroke" name="strokeDate" type="date" /></div>
			<div class="field">
				<label for="f-mob">Mobility status</label>
				<select id="f-mob" name="mobilityStatus">{#each MOBILITY as m (m)}<option>{m}</option>{/each}</select>
			</div>
			<div class="field full">
				<label for="f-goals">Therapy goals</label>
				<input id="f-goals" name="therapyGoals" type="text" placeholder="Separate goals with ; e.g. Improve functional grasp; Restore reach" />
			</div>
			<div class="field full"><label for="f-obs">Initial observations</label><textarea id="f-obs" name="initialObservations" placeholder="Baseline observations at intake…"></textarea></div>
		</div>
	</div>

	<div class="form-section">
		<div class="form-section-head"><span class="num">3</span><h3>Documents</h3></div>
		<input bind:this={picker} type="file" multiple hidden onchange={pick} accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" />
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dropzone" onclick={() => picker?.click()}>
			<Icon name="upload" size={22} />
			<div style="margin-top:8px;font-weight:600;color:var(--ink-700)">Click to attach referral letters, clinical notes or medical reports</div>
			<div style="margin-top:2px">Scans or photos: PDF, PNG, JPEG, GIF or WebP · up to 10 MB each</div>
		</div>
		<div style="margin-top:12px">
			{#each files as f, i (f.name + i)}
				<div class="doc-row">
					<div class="doc-ic"><Icon name="file" size={16} /></div>
					<div style="flex:1">
						<div class="doc-name">{f.name}</div>
						<div class="doc-meta">{Math.max(1, Math.round(f.size / 1024))} KB</div>
					</div>
					<button type="button" class="icon-btn" aria-label="Remove" onclick={() => (files = files.filter((_, j) => j !== i))}>
						<Icon name="x" size={14} />
					</button>
				</div>
			{:else}
				<div class="muted" style="font-size:12.5px">No documents attached yet.</div>
			{/each}
		</div>
	</div>

	{#if form?.error}
		<div class="alert alert-critical" style="margin-bottom:14px"><Icon name="alert" size={15} /><span>{form.error}</span></div>
	{/if}
	<div style="display:flex;justify-content:flex-end;gap:10px;padding-top:8px;border-top:1px solid var(--border)">
		<a class="btn btn-secondary" href="/patients">Cancel</a>
		<button class="btn btn-primary" disabled={busy}><Icon name="check" size={15} /> Create Patient</button>
	</div>
</form>

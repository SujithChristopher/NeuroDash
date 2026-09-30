<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from './Modal.svelte';
	import Icon from './Icon.svelte';
	import { toastEnhance } from '$lib/enhance';
	import { ISSUE_SEVERITIES } from '$lib/constants';
	import { ISSUE_TYPES } from '$lib/deviceEvents';

	let {
		devices,
		deviceId = null,
		onclose
	}: { devices: { id: string; displayCode: string }[]; deviceId?: string | null; onclose: () => void } = $props();

	const fixed = $derived(devices.find((d) => d.id === deviceId));
	const SEV_HINT: Record<string, string> = {
		Low: 'minor, does not affect use',
		Medium: 'affects some functionality',
		High: 'device unsafe or unusable',
		Critical: 'safety risk, stop use immediately'
	};
</script>

<Modal title="Report Device Issue{fixed ? ` — ${fixed.displayCode}` : ''}" wide {onclose}>
	<form id="report-issue" method="POST" action="/device-issues?/report" use:enhance={toastEnhance({ onSuccess: onclose, reset: true })}>
		<div class="form-grid">
			<div class="field">
				<label for="ri-device">Device</label>
				{#if fixed}
					<input type="text" value={fixed.displayCode} disabled />
					<input type="hidden" name="deviceId" value={fixed.id} />
				{:else}
					<select id="ri-device" name="deviceId" required>
						<option value="">Select a device…</option>
						{#each devices as d (d.id)}<option value={d.id}>{d.displayCode}</option>{/each}
					</select>
				{/if}
			</div>
			<div class="field">
				<label for="ri-sev">Severity</label>
				<select id="ri-sev" name="severity">
					{#each ISSUE_SEVERITIES as s (s)}<option value={s} selected={s === 'Medium'}>{s} — {SEV_HINT[s]}</option>{/each}
				</select>
			</div>
			<div class="field full">
				<label for="ri-type">Issue type</label>
				<select id="ri-type" name="issueType"><option value="">Other (describe below)</option>{#each ISSUE_TYPES as t (t)}<option>{t}</option>{/each}</select>
			</div>
			<div class="field full">
				<label for="ri-desc">Description</label>
				<textarea id="ri-desc" name="description" maxlength="2000" placeholder="What happened, when it started, any error messages…"></textarea>
			</div>
		</div>
		<div class="alert alert-warning"><Icon name="alert" size={15} /><span>Reporting an issue flags this device as needing inspection. Do not use it with patients until an engineer clears it.</span></div>
	</form>
	{#snippet footer()}
		<button class="btn btn-secondary" onclick={onclose}>Cancel</button>
		<button class="btn btn-primary" form="report-issue"><Icon name="alert" size={14} /> Report Issue</button>
	{/snippet}
</Modal>

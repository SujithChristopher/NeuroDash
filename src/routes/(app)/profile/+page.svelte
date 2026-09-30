<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { ROLE_LABEL } from '$lib/utils';

	let { data } = $props();
	const u = $derived(data.user);

	const PERMS = {
		THERAPIST: [
			'Register patients — you become their primary therapist',
			'See every patient at your location, so colleagues can cover for each other',
			'Enter assessments and create therapy plans for your own patients',
			'Edit therapy plans for patients at your location, as a covering therapist (the primary therapist is notified)',
			'Request devices and report device issues',
			'Analytics, reports and the AI Assistant, scoped to your location'
		],
		CONSULTANT: [
			'View patients, assessments, sessions and therapy plans at your location',
			'Add notes to patients and to therapy sessions — that is the only thing you can change',
			'Cannot create or edit patients, assessments, plans, statuses or device records',
			'Analytics, reports and the AI Assistant, scoped to your location'
		],
		ENGINEER: [
			'Register devices and assign them to patients',
			'Clear, decline and assign device requests',
			'Investigate, resolve and clear device issues',
			'Log device maintenance',
			'Fleet-wide usage, maintenance and history; no access to clinical assessment detail'
		],
		ADMIN: [
			'View every patient, device, session and plan across all locations',
			'Create and manage user accounts and locations',
			'View the audit log and system activity',
			'View-only for clinical and device records — cannot create or modify them'
		]
	};
</script>

<PageHead title="My Profile" />

<div class="card card-pad" style="margin-bottom:18px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">
	<div class="ph-av" style="width:64px;height:64px;font-size:22px">{u.initials ?? u.name[0]}</div>
	<div>
		<div style="font-size:18px;font-weight:700;font-family:var(--font-display)">{u.name}</div>
		{#if u.title}<div class="muted" style="margin-top:2px">{u.title}</div>{/if}
		<div class="mono muted" style="font-size:12px;margin-top:4px">{u.email} · {u.displayCode}</div>
		{#if u.location}<div class="muted" style="font-size:12px;margin-top:2px">{u.location.name}</div>{/if}
	</div>
	<div style="margin-left:auto"><Badge text={ROLE_LABEL[u.role]} tone="accent" /></div>
</div>

<div class="card">
	<div class="card-head">
		<h3>Your permissions</h3>
		<span class="hint">Enforced by role — provisioned by your system administrator</span>
	</div>
	<div class="card-body">
		<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:9px">
			{#each PERMS[u.role] as p (p)}<li style="font-size:13px;color:var(--ink-700)">{p}</li>{/each}
		</ul>
	</div>
</div>

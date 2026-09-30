<script lang="ts">
	// One device issue with its troubleshooting log and the engineer workflow actions.
	// Forms post to /device-issues so the same card works on the Issues page and the device detail page.
	import { enhance } from '$app/forms';
	import Badge from './Badge.svelte';
	import Icon from './Icon.svelte';
	import { toastEnhance } from '$lib/enhance';
	import { fmtDateTime, timeAgo } from '$lib/utils';

	export interface IssueView {
		id: string;
		device: { id: string; displayCode: string };
		description: string;
		severity: string;
		status: string;
		openedAt: string;
		openedBy: string;
		engineer: string | null;
		resolution: string | null;
		partsReplaced: string | null;
		log: { id: string; at: string; by: string; note: string }[];
	}

	let {
		issue,
		role,
		showDevice = true
	}: { issue: IssueView; role: 'THERAPIST' | 'CONSULTANT' | 'ENGINEER' | 'ADMIN'; showDevice?: boolean } = $props();

	const isEngineer = $derived(role === 'ENGINEER');
	const canClear = $derived(role === 'ENGINEER');
	let resolving = $state(false);
	let logging = $state(false);
	const act = toastEnhance();
	const actAndClose = toastEnhance({ onSuccess: () => ((resolving = false), (logging = false)), reset: true });
</script>

<div class="card card-pad" style="margin-bottom:12px">
	<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
		<div style="flex:1;min-width:220px">
			<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
				{#if showDevice}<a class="dt-name mono" href="/devices/{issue.device.id}">{issue.device.displayCode}</a>{/if}
				<Badge text={issue.severity} /><Badge text={issue.status} />
			</div>
			<p style="margin-top:6px;font-size:13px">{issue.description}</p>
			<div class="dt-sub" style="margin-top:4px">
				Opened {timeAgo(issue.openedAt)} by {issue.openedBy}{issue.engineer ? ` · Engineer ${issue.engineer}` : ''}
			</div>
		</div>
		<div style="display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap">
			{#if isEngineer && issue.status === 'Open'}
				<form method="POST" action="/device-issues?/investigate" use:enhance={act}>
					<input type="hidden" name="id" value={issue.id} />
					<button class="btn btn-secondary btn-sm"><Icon name="search" size={13} /> Investigate</button>
				</form>
			{/if}
			{#if isEngineer && issue.status === 'Investigating'}
				<button class="btn btn-secondary btn-sm" onclick={() => (logging = !logging)}><Icon name="edit" size={13} /> Add note</button>
				<button class="btn btn-primary btn-sm" onclick={() => (resolving = !resolving)}><Icon name="check" size={13} /> Resolve</button>
			{/if}
			{#if canClear && issue.status === 'Resolved'}
				<form method="POST" action="/device-issues?/clear" use:enhance={act}>
					<input type="hidden" name="id" value={issue.id} />
					<button class="btn btn-primary btn-sm"><Icon name="shield" size={13} /> Verify &amp; clear</button>
				</form>
			{/if}
		</div>
	</div>

	{#if logging}
		<form method="POST" action="/device-issues?/log" use:enhance={actAndClose} style="margin-top:12px">
			<input type="hidden" name="id" value={issue.id} />
			<textarea name="note" placeholder="Troubleshooting note…" required maxlength="2000"></textarea>
			<div style="text-align:right;margin-top:8px"><button class="btn btn-primary btn-sm">Save note</button></div>
		</form>
	{/if}
	{#if resolving}
		<form method="POST" action="/device-issues?/resolve" use:enhance={actAndClose} style="margin-top:12px">
			<input type="hidden" name="id" value={issue.id} />
			<div class="field"><label for="res-{issue.id}">Resolution</label><textarea id="res-{issue.id}" name="resolution" required maxlength="2000" placeholder="What was done to fix it…"></textarea></div>
			<div class="field"><label for="parts-{issue.id}">Parts replaced <span class="muted">(optional)</span></label><input id="parts-{issue.id}" name="partsReplaced" type="text" maxlength="500" /></div>
			<div class="confirm-box">Resolving preserves the full troubleshooting record. The device stays out of service until it is verified and cleared.</div>
			<div style="text-align:right"><button class="btn btn-primary btn-sm">Mark resolved</button></div>
		</form>
	{/if}

	{#if issue.resolution}
		<div class="dt-sub" style="margin-top:8px"><b>Resolution:</b> {issue.resolution}{issue.partsReplaced ? ` · Parts: ${issue.partsReplaced}` : ''}</div>
	{/if}
	{#if issue.log.length}
		<hr class="sep" />
		<div class="eyebrow" style="margin-bottom:6px">Troubleshooting log</div>
		{#each issue.log as l (l.id)}
			<div class="kv-row" style="margin-bottom:5px"><span class="kl">{fmtDateTime(l.at)} · {l.by}</span><span class="kv" style="font-weight:500;text-align:right">{l.note}</span></div>
		{/each}
	{/if}
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import Drawer from './Drawer.svelte';
	import EmptyState from './EmptyState.svelte';
	import Badge from './Badge.svelte';
	import Icon from './Icon.svelte';
	import { fmtDateTime, fmtMin, fmtTime } from '$lib/utils';

	interface Detail {
		id: string;
		sessionNumber: number | null;
		patient: { name: string; displayCode: string };
		device: { displayCode: string; category: string };
		startTime: string;
		endTime: string | null;
		durationMinutes: number | null;
		totalTargets: number;
		totalHits: number;
		totalStars: number;
		accuracyPct: number | null;
		canAddNote: boolean;
		trials: { id: string; number: number; type: string; label: string; mechanism: string | null; targets: number; hits: number; stars: number; accuracyPct: number | null }[];
		notes: { id: string; author: string; text: string; imageDataUrl: string | null; createdAt: string }[];
	}

	let { sessionId, patientName, onclose }: { sessionId: string; patientName?: string; onclose: () => void } = $props();

	let detail = $state<Detail | null>(null);
	let loadError = $state('');
	let text = $state('');
	let image = $state<string | null>(null);
	let noteError = $state('');
	let posting = $state(false);
	let fileInput = $state<HTMLInputElement>();

	onMount(async () => {
		const res = await fetch(`/api/sessions/${sessionId}`);
		if (res.ok) detail = await res.json();
		else loadError = 'Session not found.';
	});

	function pickPhoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		noteError = '';
		if (!file.type.startsWith('image/')) return (noteError = 'Choose an image file.');
		if (file.size > 2 * 1024 * 1024) return (noteError = 'Photo must be 2 MB or smaller.');
		const reader = new FileReader();
		reader.onload = () => (image = reader.result as string);
		reader.readAsDataURL(file);
	}

	async function postNote() {
		if (!detail || !text.trim()) return;
		posting = true;
		noteError = '';
		const res = await fetch(`/api/sessions/${sessionId}/notes`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text, imageDataUrl: image })
		});
		posting = false;
		const body = await res.json();
		if (!res.ok) return (noteError = body.error ?? 'Could not save note.');
		detail.notes = [body, ...detail.notes];
		text = '';
		image = null;
	}
</script>

<Drawer title={detail ? `Session #${detail.sessionNumber ?? '—'}` : 'Session'} {onclose}>
	{#if loadError}
		<EmptyState icon="activity" title={loadError} />
	{:else if !detail}
		<div class="skel" style="height:120px"></div>
	{:else}
		<div class="kv-list" style="margin-bottom:16px">
			<div class="kv-row"><span class="kl">Patient</span><span class="kv">{detail.patient.name ?? patientName} ({detail.patient.displayCode})</span></div>
			<div class="kv-row">
				<span class="kl">Date / Time</span>
				<span class="kv">{fmtDateTime(detail.startTime)}{detail.endTime ? ` – ${fmtTime(detail.endTime)}` : ''}</span>
			</div>
			<div class="kv-row"><span class="kl">Device</span><span class="kv mono">{detail.device.displayCode} · {detail.device.category}</span></div>
			<div class="kv-row"><span class="kl">Duration</span><span class="kv">{fmtMin(detail.durationMinutes ?? 0)}</span></div>
		</div>
		<div class="grid grid-3" style="margin-bottom:16px">
			<div class="card card-pad" style="padding:12px"><div class="k-label">Accuracy</div><div class="k-val" style="font-size:19px">{detail.accuracyPct ?? '—'}{detail.accuracyPct != null ? '%' : ''}</div></div>
			<div class="card card-pad" style="padding:12px"><div class="k-label">Hits / Targets</div><div class="k-val" style="font-size:19px">{detail.totalHits}/{detail.totalTargets}</div></div>
			<div class="card card-pad" style="padding:12px"><div class="k-label">Stars</div><div class="k-val" style="font-size:19px">{detail.totalStars}</div></div>
		</div>

		<div class="section-title-row" style="margin-top:0"><h2 style="font-size:13.5px">Trial detail</h2></div>
		<div class="table-wrap">
			<table class="dt" style="min-width:0">
				<thead><tr><th>#</th><th>Type</th><th>Game / Mech.</th><th>Targets</th><th>Hits</th><th>Acc.</th><th>Stars</th></tr></thead>
				<tbody>
					{#each detail.trials as t (t.id)}
						<tr>
							<td class="mono">{t.number}</td>
							<td><Badge text={t.type} tone="neutral" /></td>
							<td style="font-size:12px">{t.label}{#if t.mechanism && t.mechanism !== t.label}<div class="dt-sub">{t.mechanism}</div>{/if}</td>
							<td class="mono">{t.targets}</td>
							<td class="mono">{t.hits}</td>
							<td class="mono">{t.accuracyPct ?? '—'}{t.accuracyPct != null ? '%' : ''}</td>
							<td class="mono">{t.stars}</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="muted" style="text-align:center;padding:18px">No trials recorded.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="section-title-row"><h2 style="font-size:13.5px">Session notes</h2></div>
		{#if detail.canAddNote}
			<div class="card card-pad" style="margin-bottom:12px">
				<textarea bind:value={text} placeholder="Add a clinical note for this session…" maxlength="4000"></textarea>
				{#if image}
					<div style="margin-top:10px;position:relative;display:inline-block">
						<img src={image} alt="Attached preview" style="max-height:90px;border-radius:8px;border:1px solid var(--border)" />
						<button class="icon-btn" style="position:absolute;top:-10px;right:-10px;background:var(--surface);border:1px solid var(--border)" aria-label="Remove photo" onclick={() => (image = null)}>
							<Icon name="x" size={12} />
						</button>
					</div>
				{/if}
				{#if noteError}<div class="alert alert-critical" style="margin-top:10px"><Icon name="alert" size={15} /><span>{noteError}</span></div>{/if}
				<div style="display:flex;justify-content:space-between;margin-top:10px">
					<input bind:this={fileInput} type="file" accept="image/*" hidden onchange={pickPhoto} />
					<button class="btn btn-secondary btn-sm" onclick={() => fileInput?.click()}><Icon name="upload" size={13} /> Attach photo</button>
					<button class="btn btn-primary btn-sm" disabled={posting || !text.trim()} onclick={postNote}><Icon name="plus" size={13} /> Add note</button>
				</div>
			</div>
		{/if}
		{#each detail.notes as n (n.id)}
			<div class="card card-pad" style="margin-bottom:10px">
				<div style="display:flex;justify-content:space-between">
					<b style="font-size:13px">{n.author}</b><span class="mono muted" style="font-size:11.5px">{fmtDateTime(n.createdAt)}</span>
				</div>
				<p style="margin-top:6px;font-size:13px;color:var(--ink-700);white-space:pre-wrap">{n.text}</p>
				{#if n.imageDataUrl}
					<img src={n.imageDataUrl} alt="Session attachment" style="margin-top:8px;max-width:100%;border-radius:8px;border:1px solid var(--border)" />
				{/if}
			</div>
		{:else}
			<div class="muted" style="font-size:12.5px">No notes for this session yet.</div>
		{/each}
	{/if}
</Drawer>

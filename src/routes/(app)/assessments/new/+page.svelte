<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ScaleForm from '$lib/components/scale/ScaleForm.svelte';
	import type { Answers } from '$lib/scales/types';

	let { data, form } = $props();

	const today = new Date().toISOString().slice(0, 10);
	let answers = $state<Answers>({});
	let examinerId = $state('');
	let date = $state(today);
	let busy = $state(false);
	let filter = $state('');
	let files = $state<File[]>([]);
	let picker = $state<HTMLInputElement>();

	$effect(() => {
		if (!examinerId) examinerId = data.examiners[0]?.id ?? '';
	});

	const visibleScales = $derived(
		data.scales.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()))
	);
	const back = $derived(`/patients/${data.patient.id}?tab=assessments`);
	const draftKey = $derived(`nd.scale.${data.patient.id}.${data.scale?.id ?? ''}`);

	function pick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		files = [...files, ...Array.from(input.files ?? [])];
		input.value = '';
	}
	const size = (f: File) => (f.size > 1024 * 1024 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`);
</script>

<PageHead title="New Assessment" sub="{data.patient.name} ({data.patient.displayCode}) — entered directly in NeuroDash, click-only.">
	{#snippet actions()}<a class="btn btn-ghost" href={back}>Cancel</a>{/snippet}
</PageHead>

{#if !data.scale}
	<div class="card card-pad">
		<div class="form-section-head"><span class="num">1</span><h3>Select a scale</h3></div>
		<div class="search-box" style="max-width:320px;margin-bottom:14px">
			<Icon name="search" size={14} />
			<input placeholder="Filter scales…" bind:value={filter} aria-label="Filter scales" />
		</div>
		<div class="scale-list" role="listbox" aria-label="Assessment scales">
			{#each visibleScales as s (s.id)}
				<button
					type="button"
					role="option"
					aria-selected="false"
					class="scale-row"
					onclick={() => ((answers = {}), goto(`?patient=${data.patient.id}&scale=${s.id}`))}
				>
					<span class="dt-name" style="font-size:13.5px">{s.title}</span>
					<span class="dt-sub">{s.answerable} items{s.computed ? ` · ${s.computed} auto-scored` : ''}</span>
					<Icon name="chevron" size={14} />
				</button>
			{:else}
				<EmptyState icon="search" title="No scales match" />
			{/each}
		</div>
	</div>
{:else}
	<form
		class="card card-pad"
		method="POST"
		enctype="multipart/form-data"
		use:enhance={({ formData }) => {
			busy = true;
			formData.set('answers', JSON.stringify(answers));
			formData.delete('scans');
			for (const f of files) formData.append('scans', f);
			return async ({ result, update }) => {
				if (result.type === 'redirect') {
					try {
						localStorage.removeItem(draftKey);
					} catch {
						/* ignore */
					}
				}
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<input type="hidden" name="scaleId" value={data.scale.id} />

		<div class="form-section-head">
			<span class="num">1</span><h3>{data.scale.title}</h3>
			<a class="link-btn" style="margin-left:auto" href="?patient={data.patient.id}" onclick={() => (answers = {})}>Change scale</a>
		</div>

		<div class="form-grid" style="margin-bottom:18px">
			<div class="field">
				<label for="am-date">Assessment date</label>
				<input id="am-date" name="assessmentDate" type="date" bind:value={date} max={today} required />
			</div>
			{#if data.isBaseline}
				<div class="field">
					<span class="lbl">Assessment</span>
					<div><Badge text="Baseline" tone="accent" /> <span class="muted" style="font-size:12px">first {data.scale.title} for this patient</span></div>
				</div>
			{/if}
		</div>

		<div class="form-section-head"><span class="num">2</span><h3>Responses</h3></div>
		<ScaleForm
			def={data.scale}
			bind:answers
			bind:examinerId
			examiners={data.examiners}
			patientCode={data.patient.displayCode}
			primary={data.primary}
			{draftKey}
			missing={(form as { itemId?: string } | null)?.itemId ?? null}
		/>
		<input type="hidden" name="examinerId" value={examinerId} />

		<div class="form-section-head" style="margin-top:26px"><span class="num">3</span><h3>Scanned documents <span class="muted" style="font-weight:400">(optional)</span></h3></div>
		<input bind:this={picker} type="file" multiple hidden accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" onchange={pick} />
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dropzone" onclick={() => picker?.click()}>
			<Icon name="upload" size={20} />
			<div style="margin-top:6px;font-weight:600;color:var(--ink-700)">Attach scoring sheets or any supporting scan</div>
			<div>PDF, PNG, JPEG, GIF or WebP · up to 10 MB each</div>
		</div>
		<div style="margin-top:10px">
			{#each files as f, i (f.name + i)}
				<div class="doc-row">
					<div class="doc-ic"><Icon name="file" size={16} /></div>
					<div style="flex:1"><div class="doc-name">{f.name}</div><div class="doc-meta">{size(f)}</div></div>
					<button type="button" class="icon-btn" aria-label="Remove {f.name}" onclick={() => (files = files.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
				</div>
			{/each}
		</div>

		{#if form?.error}
			<div class="alert alert-critical" style="margin:14px 0"><Icon name="alert" size={15} /><span>{form.error}</span></div>
		{/if}
		<div style="display:flex;justify-content:flex-end;gap:10px;padding-top:16px;margin-top:14px;border-top:1px solid var(--border)">
			<a class="btn btn-secondary" href={back}>Cancel</a>
			<button class="btn btn-primary" disabled={busy}><Icon name="check" size={15} /> Save Assessment</button>
		</div>
	</form>
{/if}

<style>
	.scale-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		overflow: hidden;
	}
	.scale-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 10px 14px;
		text-align: left;
		font: inherit;
		background: var(--surface);
		border: none;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
	}
	.scale-row:last-child {
		border-bottom: none;
	}
	.scale-row .dt-name {
		flex: 1;
	}
	.scale-row:hover {
		background: var(--accent-soft);
	}
	.lbl {
		display: block;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-700);
		margin-bottom: 6px;
	}
</style>

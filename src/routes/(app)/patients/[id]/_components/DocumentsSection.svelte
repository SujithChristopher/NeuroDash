<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, form }: { data: PageData; form: unknown } = $props();

	let picker = $state<HTMLInputElement>();
	let formEl = $state<HTMLFormElement>();
	const err = $derived((form as { docError?: string } | null)?.docError);
</script>

{#if data.perms.isOwner}
	<form bind:this={formEl} method="POST" action="?/addDocument" enctype="multipart/form-data" use:enhance={() => async ({ update }) => update()}>
		<input bind:this={picker} type="file" name="document" hidden accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" onchange={() => formEl?.requestSubmit()} />
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dropzone" style="margin-bottom:18px" onclick={() => picker?.click()}>
			<Icon name="upload" size={20} />
			<div style="margin-top:6px;font-weight:600;color:var(--ink-700)">Upload a clinical document</div>
			<div>Scans or photos: PDF, PNG, JPEG, GIF or WebP · up to 10 MB each</div>
		</div>
	</form>
	{#if err}<div class="alert alert-critical" style="margin-bottom:14px"><Icon name="alert" size={15} /><span>{err}</span></div>{/if}
{/if}

{#each data.documents as d (d.id)}
	<div class="doc-row">
		<div class="doc-ic"><Icon name="file" size={17} /></div>
		<div style="flex:1">
			<div class="doc-name">{d.name}</div>
			<div class="doc-meta">{d.docType ?? 'FILE'} · {d.sizeKb ? (d.sizeKb > 1024 ? `${(d.sizeKb / 1024).toFixed(1)} MB` : `${d.sizeKb} KB`) : '—'} · Uploaded {fmtDateShort(d.uploadDate)} by {d.by}{d.fromAssessment ? ' · with an assessment' : ''}</div>
		</div>
		<a class="btn btn-ghost btn-sm" href="/api/documents/{d.id}" target="_blank" rel="noopener"><Icon name="eye" size={13} /> View</a>
		<a class="btn btn-ghost btn-sm" href="/api/documents/{d.id}?download=1" aria-label="Download {d.name}"><Icon name="download" size={13} /></a>
	</div>
{:else}
	<div class="card"><EmptyState icon="file" title="No documents uploaded" sub="Referral letters, clinical notes and reports will appear here." /></div>
{/each}

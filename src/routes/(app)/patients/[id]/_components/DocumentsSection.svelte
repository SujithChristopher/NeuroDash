<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Section from './Section.svelte';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, form }: { data: PageData; form: unknown } = $props();

	let picker = $state<HTMLInputElement>();
	let formEl = $state<HTMLFormElement>();
	const err = $derived((form as { docError?: string } | null)?.docError);
</script>

<Section id="documents" title="Documents" count={data.documents.length}>
	<div class="pd-cols">
		{#if data.perms.isOwner}
			<div class="s4">
				<form bind:this={formEl} method="POST" action="?/addDocument" enctype="multipart/form-data" use:enhance={() => async ({ update }) => update()}>
					<input bind:this={picker} type="file" name="document" hidden accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" onchange={() => formEl?.requestSubmit()} />
					<button type="button" class="dropzone pd-drop" style="width:100%" onclick={() => picker?.click()}>
						<Icon name="upload" size={20} />
						<span>
							<span style="display:block;font-weight:600;color:var(--ink-700)">Upload a clinical document</span>
							<span>PDF, PNG, JPEG, GIF or WebP · up to 10 MB</span>
						</span>
					</button>
				</form>
				{#if err}<div class="alert alert-critical" style="margin-top:10px"><Icon name="alert" size={15} /><span>{err}</span></div>{/if}
			</div>
		{/if}

		<div class={data.perms.isOwner ? 's8' : ''}>
			{#each data.documents as d (d.id)}
				<div class="doc-row">
					<div class="doc-ic"><Icon name="file" size={17} /></div>
					<div style="flex:1;min-width:0">
						<div class="doc-name">{d.name}</div>
						<div class="doc-meta">{d.docType ?? 'FILE'} · {d.sizeKb ? (d.sizeKb > 1024 ? `${(d.sizeKb / 1024).toFixed(1)} MB` : `${d.sizeKb} KB`) : '—'} · Uploaded {fmtDateShort(d.uploadDate)} by {d.by}{d.fromAssessment ? ' · with an assessment' : ''}</div>
					</div>
					<a class="btn btn-ghost btn-sm" href="/api/documents/{d.id}" target="_blank" rel="noopener"><Icon name="eye" size={13} /> View</a>
					<a class="btn btn-ghost btn-sm" href="/api/documents/{d.id}?download=1" aria-label="Download {d.name}"><Icon name="download" size={13} /></a>
				</div>
			{:else}
				<div class="card"><EmptyState icon="file" title="No documents uploaded" sub="Referral letters, clinical notes and reports will appear here." /></div>
			{/each}
		</div>
	</div>
</Section>

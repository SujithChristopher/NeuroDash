<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, form }: { data: PageData; form: unknown } = $props();
	const err = $derived((form as { noteError?: string } | null)?.noteError);
</script>

<form method="POST" action="?/addNote" use:enhance class="card card-pad" style="margin-bottom:16px">
	<textarea name="text" placeholder="Add a clinical note about this patient's session or progress…" required maxlength="4000"></textarea>
	{#if err}<div class="alert alert-critical" style="margin-top:10px"><Icon name="alert" size={15} /><span>{err}</span></div>{/if}
	<div style="text-align:right;margin-top:10px">
		<button class="btn btn-primary btn-sm"><Icon name="plus" size={13} /> Add Note</button>
	</div>
</form>

{#each data.notes as n (n.id)}
	<div class="card card-pad" style="margin-bottom:10px">
		<div style="display:flex;justify-content:space-between">
			<b style="font-size:13px">{n.author}</b><span class="mono muted" style="font-size:11.5px">{fmtDateShort(n.date)}</span>
		</div>
		<p style="margin-top:6px;font-size:13px;color:var(--ink-700);white-space:pre-wrap">{n.text}</p>
	</div>
{:else}
	<div class="card"><EmptyState icon="edit" title="No notes recorded yet" /></div>
{/each}

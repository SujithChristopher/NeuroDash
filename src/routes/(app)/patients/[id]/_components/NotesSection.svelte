<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Section from './Section.svelte';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	const SHOWN = 4;

	let { data, form }: { data: PageData; form: unknown } = $props();
	const err = $derived((form as { noteError?: string } | null)?.noteError);

	let all = $state(false);
	const rows = $derived(data.notes.slice(0, all ? undefined : SHOWN));
</script>

<Section id="notes" title="Notes" count={data.notes.length}>
	<div class="pd-cols">
		<form method="POST" action="?/addNote" use:enhance class="card card-pad pd-compose s5">
			<textarea id="note-text" name="text" placeholder="Add a clinical note about this patient's session or progress…" required maxlength="4000"></textarea>
			{#if err}<div class="alert alert-critical" style="margin-top:10px"><Icon name="alert" size={15} /><span>{err}</span></div>{/if}
			<div style="text-align:right;margin-top:10px">
				<button class="btn btn-primary btn-sm"><Icon name="plus" size={13} /> Add note</button>
			</div>
		</form>

		<div class="card s7">
			{#each rows as n (n.id)}
				<div class="pd-note">
					<div class="pd-note-h"><b>{n.author}</b><span class="mono muted">{fmtDateShort(n.date)}</span></div>
					<p>{n.text}</p>
				</div>
			{:else}
				<EmptyState icon="edit" title="No notes recorded yet" />
			{/each}
			{#if data.notes.length > SHOWN}
				<div class="pd-more">
					<button class="btn btn-ghost btn-sm" onclick={() => (all = !all)}>
						{all ? 'Show latest only' : `Show all ${data.notes.length}`}
					</button>
				</div>
			{/if}
		</div>
	</div>
</Section>

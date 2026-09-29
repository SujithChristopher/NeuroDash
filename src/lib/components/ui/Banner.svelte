<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tag from './Tag.svelte';
	let {
		title,
		idChips = [],
		tags = [],
		actions
	}: {
		title: string;
		idChips?: { label: string; value: string }[];
		tags?: { text: string; tone?: string }[];
		actions?: Snippet;
	} = $props();
</script>

<div class="banner">
	<div>
		<h1>{title}</h1>
		{#if idChips.length}
			<div class="ids">
				{#each idChips as c (c.label)}<span><b>{c.label}</b> {c.value}</span>{/each}
			</div>
		{/if}
		{#if tags.length}
			<div class="chips">
				{#each tags as t (t.text)}<Tag text={t.text} tone={t.tone} />{/each}
			</div>
		{/if}
	</div>
	<span class="sp"></span>
	{#if actions}{@render actions()}{/if}
</div>

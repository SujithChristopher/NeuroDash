<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		title,
		sub,
		flush = false,
		right,
		children
	}: { title?: string; sub?: string; flush?: boolean; right?: Snippet; children: Snippet } = $props();
</script>

<section class="card">
	{#if title}
		<div class="card-h">
			<h2>{title}</h2>
			{#if sub}<span class="sub">{sub}</span>{/if}
			<span class="sp"></span>
			{#if right}{@render right()}{/if}
		</div>
	{/if}
	<div class="card-b {flush ? 'flush' : ''}">{@render children()}</div>
</section>

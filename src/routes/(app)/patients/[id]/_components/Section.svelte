<script lang="ts">
	import type { Snippet } from 'svelte';

	// One block of the single-page patient profile. `id` is the anchor the section nav and old `?tab=` links target.
	let {
		id,
		title,
		count = null,
		actions,
		children
	}: { id: string; title: string; count?: number | null; actions?: Snippet; children: Snippet } = $props();
</script>

<section {id} class="pd-sec" aria-labelledby="{id}-h">
	<header class="pd-sec-h">
		<h2 id="{id}-h">
			{title}
			{#if count != null}<span class="pd-nav-n">{count}</span>{/if}
		</h2>
		{#if actions}<div class="pd-sec-a">{@render actions()}</div>{/if}
	</header>
	{@render children()}
</section>

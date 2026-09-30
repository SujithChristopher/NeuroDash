<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, sub = '', actions }: { title: string; sub?: string; actions?: Snippet } = $props();
</script>

<div class="page-head">
	<div>
		<h1>{title}</h1>
		{#if sub}<div class="sub">{sub}</div>{/if}
	</div>
	{#if actions}<div class="page-actions">{@render actions()}</div>{/if}
</div>

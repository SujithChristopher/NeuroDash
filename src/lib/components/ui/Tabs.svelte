<script lang="ts">
	interface Item {
		key: string;
		label: string;
		count?: number;
	}
	let { base, items, current }: { base: string; items: Item[]; current: string } = $props();
</script>

<nav class="tabs">
	{#each items as it (it.key)}
		<a href="{base}/{it.key}" class={it.key === current ? 'on' : ''}>
			{it.label}
			{#if it.count}<span class="c">{it.count}</span>{/if}
		</a>
	{/each}
</nav>

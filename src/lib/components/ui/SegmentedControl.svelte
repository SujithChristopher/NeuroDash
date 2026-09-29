<script lang="ts">
	interface Item {
		value: string;
		label: string;
		count?: number;
	}
	let {
		items,
		current,
		onSelect
	}: { items: Item[]; current: string; onSelect: (v: string) => void } = $props();
</script>

<div class="segs">
	{#each items as it (it.value)}
		<button type="button" class={it.value === current ? 'on' : ''} onclick={() => onSelect(it.value)}>
			{it.label}
			{#if it.count != null}<span class="c">{it.count}</span>{/if}
		</button>
	{/each}
</div>

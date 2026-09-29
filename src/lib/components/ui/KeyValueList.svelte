<script lang="ts">
	let { rows }: { rows: { label: string; value: string }[] } = $props();
</script>

<dl class="kv">
	{#each rows as r (r.label)}
		<dt>{r.label}</dt>
		<dd>{r.value}</dd>
	{/each}
</dl>

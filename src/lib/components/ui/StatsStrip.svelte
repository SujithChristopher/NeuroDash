<script lang="ts">
	interface Stat {
		label: string;
		value: string;
		footer?: string;
		href?: string;
		tone?: 'bad' | 'warnv' | '';
	}
	let { items }: { items: Stat[] } = $props();
</script>

<div class="stats">
	{#each items as s (s.label)}
		{#if s.href}
			<a class="stat link {s.tone || ''}" href={s.href}>
				<div class="l">{s.label}</div>
				<div class="v">{s.value}</div>
				{#if s.footer}<div class="f">{s.footer}</div>{/if}
			</a>
		{:else}
			<div class="stat {s.tone || ''}">
				<div class="l">{s.label}</div>
				<div class="v">{s.value}</div>
				{#if s.footer}<div class="f">{s.footer}</div>{/if}
			</div>
		{/if}
	{/each}
</div>

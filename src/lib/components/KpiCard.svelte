<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		label,
		value,
		icon,
		tone = 'accent',
		sub = ''
	}: { label: string; value: string | number; icon: string; tone?: string; sub?: string } = $props();
</script>

<div class="card kpi">
	<div class="k-top">
		<span class="k-label">{label}</span>
		<span class="k-icon" style="background:var(--{tone}-soft);color:var(--{tone})">
			<Icon name={icon} size={14} />
		</span>
	</div>
	<div class="k-val">{value}</div>
	{#if sub}<div class="k-sub">{sub}</div>{/if}
</div>

<script lang="ts">
	import Icon from './Icon.svelte';

	let { icon = 'info', title, sub = '' }: { icon?: string; title: string; sub?: string } = $props();
</script>

<div class="empty-state">
	<Icon name={icon} size={30} />
	<div class="es-title">{title}</div>
	{#if sub}<div class="es-sub">{sub}</div>{/if}
</div>

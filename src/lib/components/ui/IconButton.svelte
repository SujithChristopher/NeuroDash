<script lang="ts">
	import Icon from './Icon.svelte';
	let {
		icon,
		title = '',
		dotBadge = false,
		onclick
	}: { icon: string; title?: string; dotBadge?: boolean; onclick?: () => void } = $props();
</script>

<button type="button" class="icon-btn" {title} {onclick}>
	<Icon name={icon} size={17} />
	{#if dotBadge}<span class="dot"></span>{/if}
</button>

<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	let { backHref, backLabel }: { backHref?: string; backLabel?: string } = $props();
</script>

{#if backHref}
	<a class="back" href={backHref}>
		<Icon name="chev" size={13} />
		{backLabel}
	</a>
{/if}

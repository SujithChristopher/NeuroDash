<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		title,
		onclose,
		wide = false,
		children,
		footer
	}: {
		title: string;
		onclose: () => void;
		wide?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay modal-center" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="modal" class:modal-wide={wide} role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-head">
			<h3>{title}</h3>
			<button class="close-x" type="button" onclick={onclose} aria-label="Close">
				<Icon name="x" />
			</button>
		</div>
		<div class="modal-body">{@render children()}</div>
		{#if footer}<div class="modal-foot">{@render footer()}</div>{/if}
	</div>
</div>

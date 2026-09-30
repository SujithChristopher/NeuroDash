<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } =
		$props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay drawer-right" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="drawer" role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-head">
			<h3>{title}</h3>
			<button class="close-x" type="button" onclick={onclose} aria-label="Close">
				<Icon name="x" />
			</button>
		</div>
		<div class="modal-body" style="flex:1">{@render children()}</div>
	</div>
</div>

<style>
	.drawer {
		animation: slide-in 0.2s ease-out;
	}
	@keyframes slide-in {
		from {
			transform: translateX(40px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
</style>

<script lang="ts">
	import { toasts } from '$lib/stores/ui';
	import Icon from './Icon.svelte';
</script>

{#each $toasts as t (t.id)}
	<div class="toast"><Icon name="check" size={15} />{t.message}</div>
{/each}

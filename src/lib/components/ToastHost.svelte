<script lang="ts">
	import { toasts } from '$lib/stores/toast';
</script>

<div id="toast-host" aria-live="polite">
	{#each $toasts as t (t.id)}
		<div class="toast">
			<span class="dot" style="background:var(--{t.tone})"></span><span>{t.msg}</span>
		</div>
	{/each}
</div>

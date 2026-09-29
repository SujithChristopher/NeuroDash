<script lang="ts">
	import { modal, closeModal } from '$lib/stores/ui';
	import Icon from './Icon.svelte';

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!$modal) return;
		const fd = new FormData(e.target as HTMLFormElement);
		const data: Record<string, string> = {};
		for (const [k, v] of fd.entries()) data[k] = String(v);
		const result = $modal.onSubmit(data);
		if (result !== false) closeModal();
	}
</script>

{#if $modal}
	<div class="scrim" onclick={(e) => e.target === e.currentTarget && closeModal()}>
		<form class="modal" autocomplete="off" onsubmit={handleSubmit}>
			<div class="modal-h">
				<div class="grow">
					<h3>{$modal.title}</h3>
					{#if $modal.sub}<p>{$modal.sub}</p>{/if}
				</div>
				<button type="button" class="icon-btn" onclick={closeModal}><Icon name="x" /></button>
			</div>
			<div class="modal-b">{@html $modal.body}</div>
			<div class="modal-f">
				<button type="button" class="btn" onclick={closeModal}>Cancel</button>
				<button class="btn pri" type="submit">{$modal.submitLabel || 'Save'}</button>
			</div>
		</form>
	</div>
{/if}

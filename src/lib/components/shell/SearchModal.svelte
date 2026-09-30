<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { initials } from '$lib/utils';

	let { onclose }: { onclose: () => void } = $props();

	interface Results {
		patients: { id: string; name: string; displayCode: string; diagnosis: string | null }[];
		devices: { id: string; displayCode: string; serialNumber: string; deviceType: { category: string } }[];
	}

	let q = $state('');
	let results = $state<Results>({ patients: [], devices: [] });
	let input: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout>;
	let seq = 0;

	onMount(() => input.focus());

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const mine = ++seq;
			if (!q.trim()) {
				results = { patients: [], devices: [] };
				return;
			}
			const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
			if (res.ok && mine === seq) results = await res.json();
		}, 150);
	}

	async function go(path: string) {
		onclose();
		await goto(path);
	}

	const empty = $derived(results.patients.length === 0 && results.devices.length === 0);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay modal-center" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="modal search-modal" role="dialog" aria-modal="true" aria-label="Search">
		<div class="search-input-row">
			<Icon name="search" />
			<input
				bind:this={input}
				bind:value={q}
				oninput={onInput}
				type="text"
				placeholder="Search patients and devices…"
			/>
			<button class="close-x" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
		</div>
		<div style="max-height:56vh;overflow-y:auto">
			{#if !q.trim()}
				<EmptyState icon="search" title="Start typing to search" sub="Try a patient name or a device ID." />
			{:else if empty}
				<EmptyState icon="search" title="No results found" sub="Try a different search term." />
			{/if}

			{#if results.patients.length}
				<div class="search-group-label">Patients</div>
				{#each results.patients as p (p.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="search-result" onclick={() => go(`/patients/${p.id}`)}>
						<div class="ph-av" style="width:30px;height:30px;font-size:12px">{initials(p.name)}</div>
						<div>
							<div style="font-weight:600;font-size:13px">{p.name}</div>
							<div class="dt-sub">{p.displayCode} · {p.diagnosis ?? '—'}</div>
						</div>
					</div>
				{/each}
			{/if}

			{#if results.devices.length}
				<div class="search-group-label">Devices</div>
				{#each results.devices as d (d.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="search-result" onclick={() => go(`/devices/${d.id}`)}>
						<Icon name="device" />
						<div>
							<div style="font-weight:600;font-size:13px">{d.displayCode}</div>
							<div class="dt-sub">{d.deviceType.category} · {d.serialNumber}</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

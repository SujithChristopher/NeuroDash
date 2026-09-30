<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { EVENT_ICON, EVENT_TONE } from '$lib/deviceEvents';
	import { fmtDate } from '$lib/utils';

	let { data } = $props();
</script>

<PageHead title="Device History" sub="Chronological event log across the entire device fleet (most recent 100)." />

<div class="card card-pad">
	{#if data.events.length === 0}
		<EmptyState icon="history" title="No device events yet" />
	{:else}
		<div class="timeline">
			{#each data.events as e (e.id)}
				<div class="tl-item">
					<span class="tl-dot" style="background:var(--{EVENT_TONE[e.type] ?? 'neutral'}-soft);color:var(--{EVENT_TONE[e.type] ?? 'neutral'})">
						<Icon name={EVENT_ICON[e.type] ?? 'info'} size={10} />
					</span>
					<div class="tl-date">{fmtDate(e.date)} · <a class="mono" href="/devices/{e.device.id}?tab=history">{e.device.displayCode}</a></div>
					<div class="tl-title" style="text-transform:capitalize">{e.type}</div>
					<div class="tl-desc">{e.description}</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

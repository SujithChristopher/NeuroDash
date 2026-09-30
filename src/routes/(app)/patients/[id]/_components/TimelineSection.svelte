<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Section from './Section.svelte';
	import { fmtDate } from '$lib/utils';
	import { buildTimeline } from './timeline';
	import type { PageData } from '../$types';

	const SHOWN = 6;

	let { data }: { data: PageData } = $props();
	const events = $derived(buildTimeline(data));

	let all = $state(false);
	const rows = $derived(events.slice(0, all ? undefined : SHOWN));
</script>

<Section id="timeline" title="Timeline" count={events.length}>
	{#if events.length === 0}
		<div class="card"><EmptyState icon="history" title="No activity recorded yet" /></div>
	{:else}
		<div class="card card-pad">
			<div class="timeline">
				{#each rows as e, i (i)}
					<div class="tl-item">
						<span class="tl-dot" style="background:var(--{e.tone}-soft);color:var(--{e.tone})"><Icon name={e.icon} size={10} /></span>
						<div class="tl-date">{fmtDate(e.date)}</div>
						<div class="tl-title">{e.title}</div>
						<div class="tl-desc">{e.desc}</div>
					</div>
				{/each}
			</div>
			{#if events.length > SHOWN}
				<div class="pd-more" style="margin-top:12px;padding-bottom:0">
					<button class="btn btn-ghost btn-sm" onclick={() => (all = !all)}>
						{all ? 'Show latest only' : `Show all ${events.length}`}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</Section>

<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDate } from '$lib/utils';
	import { buildTimeline } from './timeline';
	import type { PageData } from '../$types';

	let { data }: { data: PageData } = $props();
	const events = $derived(buildTimeline(data));
</script>

{#if events.length === 0}
	<div class="card"><EmptyState icon="history" title="No activity recorded yet" /></div>
{:else}
	<div class="card card-pad">
		<div class="timeline">
			{#each events as e, i (i)}
				<div class="tl-item">
					<span class="tl-dot" style="background:var(--{e.tone}-soft);color:var(--{e.tone})"><Icon name={e.icon} size={10} /></span>
					<div class="tl-date">{fmtDate(e.date)}</div>
					<div class="tl-title">{e.title}</div>
					<div class="tl-desc">{e.desc}</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtTime } from '$lib/utils';
	import { buildTimeline } from './timeline';
	import type { PageData } from '../$types';

	let { data }: { data: PageData } = $props();
	const events = $derived(buildTimeline(data));

	// Events with a real time show it in the viewer's own time zone; date-only events (assessments) show just the date.
	const day = (e: { date: string; hasTime: boolean }) =>
		new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(e.hasTime ? {} : { timeZone: 'UTC' }) });
</script>

{#if events.length === 0}
	<div class="card"><EmptyState icon="history" title="No activity recorded yet" /></div>
{:else}
	<div class="card card-pad">
		<div class="timeline-dated">
			{#each events as e, i (i)}
				<div class="tl-row">
					<div class="tl-when">
						<div class="tl-day">{day(e)}</div>
						{#if e.hasTime}<div class="tl-time">{fmtTime(e.date)}</div>{/if}
					</div>
					<div class="tl-rail">
						<span class="tl-dot" style="background:var(--{e.tone}-soft);color:var(--{e.tone})"><Icon name={e.icon} size={10} /></span>
					</div>
					<div class="tl-body">
						<div class="tl-title">{e.title}</div>
						<div class="tl-desc">{e.desc}</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	/* date and time on the left of the line, the event on the right */
	.timeline-dated {
		display: flex;
		flex-direction: column;
	}
	.tl-row {
		display: grid;
		grid-template-columns: 112px 22px 1fr;
		column-gap: 12px;
		padding-bottom: 22px;
	}
	.tl-row:last-child {
		padding-bottom: 0;
	}
	.tl-when {
		text-align: right;
		padding-top: 1px;
	}
	.tl-day {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-700);
		text-transform: uppercase;
	}
	.tl-time {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-500);
		margin-top: 2px;
	}
	.tl-rail {
		position: relative;
		display: flex;
		justify-content: center;
	}
	/* the line runs through every row, joining the dots */
	.tl-rail::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: -22px;
		width: 2px;
		background: var(--border);
	}
	.tl-row:last-child .tl-rail::before {
		bottom: 0;
	}
	.tl-dot {
		position: relative;
		z-index: 1;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--surface);
		margin-top: 1px;
	}
	.tl-title {
		font-weight: 700;
		font-size: 13.5px;
	}
	.tl-desc {
		font-size: 12.5px;
		color: var(--ink-700);
		margin-top: 2px;
	}
	@media (max-width: 480px) {
		.tl-row {
			grid-template-columns: 88px 22px 1fr;
			column-gap: 8px;
		}
	}
</style>

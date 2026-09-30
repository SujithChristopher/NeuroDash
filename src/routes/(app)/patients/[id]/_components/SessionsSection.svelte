<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Section from './Section.svelte';
	import { fmtDateTime, fmtMin, pct } from '$lib/utils';
	import type { PageData } from '../$types';

	const SHOWN = 8;

	let { data, openSession }: { data: PageData; openSession: (id: string) => void } = $props();

	let all = $state(false);
	const rows = $derived(data.sessions.slice(0, all ? undefined : SHOWN));
</script>

<Section id="sessions" title="Sessions" count={data.sessions.length}>
	{#if data.sessions.length === 0}
		<div class="card"><EmptyState icon="activity" title="No sessions found" sub="Sessions will appear here once therapy begins." /></div>
	{:else}
		<div class="card">
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Session</th><th>Started</th><th>Device</th><th>Duration</th><th>Accuracy</th><th>Stars</th><th></th></tr></thead>
					<tbody>
						{#each rows as s (s.id)}
							<tr class="clickable" onclick={() => openSession(s.id)}>
								<td class="dt-name mono">#{s.sessionNumber ?? '—'}</td>
								<td>{fmtDateTime(s.startTime)}</td>
								<td class="mono">{s.device.displayCode}</td>
								<td class="mono">{fmtMin(s.durationMinutes ?? 0)}</td>
								<td class="mono">{s.totalTargets ? `${pct(s.totalHits, s.totalTargets)}%` : '—'}</td>
								<td class="mono">{s.totalStars}</td>
								<td class="row-chevron"><Icon name="chevron" size={14} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.sessions.length > SHOWN}
				<div class="pd-more">
					<button class="btn btn-ghost btn-sm" onclick={() => (all = !all)}>
						{all ? 'Show latest only' : `Show all ${data.sessions.length}`}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</Section>

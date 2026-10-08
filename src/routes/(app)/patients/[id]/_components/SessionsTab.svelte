<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateTime, fmtMin } from '$lib/utils';
	import JourneyCard from './JourneyCard.svelte';
	import type { PageData } from '../$types';

	let { data, openSession, goTab }: { data: PageData; openSession: (id: string) => void; goTab: (t: string) => void } = $props();

	// The journey shades each step by the daily target of the patient's plan (60 minutes when there is none)
	const target = $derived((data.plans.find((p) => p.status === 'Active') ?? data.plans[0])?.dailyTargetMinutes ?? 60);
</script>

{#if data.sessions.length === 0}
	<div class="card"><EmptyState icon="activity" title="No sessions found" sub="Sessions will appear here once therapy begins." /></div>
{:else}
	<JourneyCard {data} targetMinutes={target} {openSession} {goTab} />

	<div class="section-title-row"><h2>All sessions</h2></div>
	<div class="muted" style="font-size:11.5px;margin-bottom:8px">
		Click any session to see targets, accuracy, stars and the full trial-by-trial breakdown.
	</div>
	<div class="card">
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Session</th><th></th></tr></thead>
				<tbody>
					{#each data.sessions as s (s.id)}
						<tr class="clickable" onclick={() => openSession(s.id)}>
							<td>
								<div class="dt-name" style="font-weight:500;font-size:13px">
									#{s.sessionNumber ?? '—'} · {s.device.displayCode}
								</div>
								<div class="dt-sub">{fmtDateTime(s.startTime)} · {fmtMin(s.durationMinutes ?? 0)}</div>
							</td>
							<td class="row-chevron"><Icon name="chevron" size={14} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

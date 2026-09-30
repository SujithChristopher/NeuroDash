<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateTime, fmtMin } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, openSession }: { data: PageData; openSession: (id: string) => void } = $props();
</script>

{#if data.sessions.length === 0}
	<div class="card"><EmptyState icon="activity" title="No sessions found" sub="Sessions will appear here once therapy begins." /></div>
{:else}
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

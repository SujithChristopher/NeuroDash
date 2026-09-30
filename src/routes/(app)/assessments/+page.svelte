<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { fmtDateShort } from '$lib/utils';

	let { data } = $props();
</script>

<PageHead
	title="Assessments"
	sub="{data.rows.length} clinical assessment{data.rows.length === 1 ? '' : 's'} recorded across {data.patientCount} patient{data.patientCount === 1 ? '' : 's'}."
/>

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead>
				<tr><th>Patient</th><th>Assessment</th><th>Date</th><th>Therapist</th><th>Score</th><th>Trend</th></tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr class="clickable" onclick={() => goto(`/patients/${r.patient.id}?tab=assessments`)}>
						<td><div class="dt-name">{r.patient.name}</div><div class="dt-sub">{r.patient.displayCode}</div></td>
						<td>{r.typeName}{#if r.label}<div class="dt-sub">{r.label}</div>{/if}</td>
						<td class="mono">{fmtDateShort(r.date)}</td>
						<td>{r.by}</td>
						<td class="mono">
							{#if r.score == null}<span class="muted">—</span>{:else}{r.score}{r.maxScore != null ? `/${r.maxScore}` : ''}{r.percentage != null ? ` (${r.percentage}%)` : ''}{/if}
							{#if r.scans}<span class="pill" style="margin-left:6px" title="Scanned documents attached">{r.scans} scan{r.scans === 1 ? '' : 's'}</span>{/if}
						</td>
						<td>
							{#if r.delta === null}
								<span class="muted">{r.score == null ? '' : 'First / baseline'}</span>
							{:else}
								<span style="color:{r.delta >= 0 ? 'var(--good)' : 'var(--critical)'};font-weight:600">{r.delta >= 0 ? '+' : ''}{r.delta}</span>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="6"><EmptyState icon="clipboard" title="No assessments recorded yet" /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

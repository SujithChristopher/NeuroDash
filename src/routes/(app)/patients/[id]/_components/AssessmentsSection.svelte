<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Section from './Section.svelte';
	import { fmtDateShort } from '$lib/utils';
	import { assessmentSeries } from './series';
	import type { PageData } from '../$types';

	const SHOWN = 6;

	let { data, openAssessment }: { data: PageData; openAssessment: (id: string) => void } = $props();

	const list = $derived(data.assessments);
	const series = $derived(assessmentSeries(list));
	// Headline comparison uses the assessments that have a score (some scales have none, e.g. BBT).
	const scored = $derived(list.filter((a) => a.score != null && a.maxScore != null && a.percentage != null));
	const baseline = $derived(scored[0]);
	const latest = $derived(scored[scored.length - 1]);
	const change = $derived(baseline && latest ? latest.score! - baseline.score! : 0);
	const href = $derived(`/assessments/new?patient=${data.patient.id}`);

	let all = $state(false);
	const rows = $derived([...list].reverse().slice(0, all ? undefined : SHOWN));
</script>

<Section id="assessments" title="Assessments" count={list.length}>
	{#snippet actions()}
		{#if data.perms.isOwner}
			<a class="btn btn-primary btn-sm" {href}><Icon name="plus" size={13} /> New assessment</a>
		{/if}
	{/snippet}

	{#if list.length === 0}
		<div class="card">
			<EmptyState icon="clipboard" title="No assessments recorded yet" sub="Create the first assessment to establish a clinical baseline." />
		</div>
	{:else}
		<div class="pd-cols">
			<div class="card s5">
				<div class="card-head">
					<h3>Score trend</h3>
					<span class="hint">% of maximum score</span>
				</div>
				{#if baseline && latest && baseline !== latest}
					<div class="pd-delta">
						<b>{baseline.score} → {latest.score}</b> of {latest.maxScore}
						<span class="pd-chip" class:down={change < 0}>{change >= 0 ? '+' : ''}{change} pts</span>
						<span>{fmtDateShort(baseline.date)} to {fmtDateShort(latest.date)}</span>
					</div>
				{/if}
				<div class="card-body">
					{#if series.labels.length >= 2}
						<Chart kind="line" labels={series.labels} datasets={series.datasets} opts={{ legend: true, suggestedMax: 100 }} height={170} />
					{:else}
						<EmptyState icon="trend" title="Not enough data" sub="A trend needs at least two assessments." />
					{/if}
				</div>
			</div>
			<div class="card s7">
				<div class="table-wrap">
					<table class="dt">
						<thead><tr><th>Assessment</th><th>Date</th><th>Score</th><th></th></tr></thead>
						<tbody>
							{#each rows as a (a.id)}
								<tr class="clickable" onclick={() => openAssessment(a.id)}>
									<td>
										<div class="dt-name">{a.typeName}</div>
										<div class="dt-sub">{a.label ? `${a.label} · ` : ''}v{a.version} · {a.by}{#if a.documents.length} · {a.documents.length} scan{a.documents.length === 1 ? '' : 's'}{/if}</div>
									</td>
									<td class="mono">{fmtDateShort(a.date)}</td>
									<td class="mono">
										{a.score == null ? '—' : `${a.score}${a.maxScore != null ? `/${a.maxScore}` : ''}`}
										{#if a.percentage != null}<span class="muted">· {a.percentage}%</span>{/if}
									</td>
									<td class="row-chevron"><Icon name="chevron" size={14} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if list.length > SHOWN}
					<div class="pd-more">
						<button class="btn btn-ghost btn-sm" onclick={() => (all = !all)}>
							{all ? 'Show latest only' : `Show all ${list.length}`}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</Section>

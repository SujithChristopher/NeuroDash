<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateShort } from '$lib/utils';
	import { assessmentSeries } from './series';
	import type { PageData } from '../$types';

	let { data, openAssessment }: { data: PageData; openAssessment: (id: string) => void } = $props();

	const list = $derived(data.assessments);
	const series = $derived(assessmentSeries(list));
	// Headline comparison uses the assessments that have a score (some scales have none, e.g. BBT).
	const scored = $derived(list.filter((a) => a.score != null && a.maxScore != null && a.percentage != null));
	const baseline = $derived(scored[0]);
	const latest = $derived(scored[scored.length - 1]);
	const href = $derived(`/assessments/new?patient=${data.patient.id}`);
</script>

{#if list.length === 0}
	<div class="card">
		<EmptyState icon="clipboard" title="No assessments recorded yet" sub="Create the first assessment to establish a clinical baseline." />
		{#if data.perms.isOwner}
			<div style="text-align:center;padding-bottom:24px">
				<a class="btn btn-primary" {href}><Icon name="plus" size={14} /> New Assessment</a>
			</div>
		{/if}
	</div>
{:else}
	<div class="page-actions" style="justify-content:flex-end;margin-bottom:16px">
		{#if data.perms.isOwner}
			<a class="btn btn-primary btn-sm" {href}><Icon name="plus" size={13} /> New Assessment</a>
		{/if}
	</div>
	{#if baseline && latest}
	<div class="grid grid-3" style="margin-bottom:18px">
		<div class="card card-pad">
			<div class="k-label">Baseline</div>
			<div class="k-val" style="font-size:22px;margin-top:6px">{baseline.score} / {baseline.maxScore}</div>
			<div class="k-sub">{fmtDateShort(baseline.date)} · {baseline.typeName}</div>
		</div>
		<div class="card card-pad">
			<div class="k-label">Latest</div>
			<div class="k-val" style="font-size:22px;margin-top:6px">{latest.score} / {latest.maxScore}</div>
			<div class="k-sub">{fmtDateShort(latest.date)} · {latest.typeName}</div>
		</div>
		<div class="card card-pad">
			<div class="k-label">Change</div>
			<div class="k-val" style="font-size:22px;margin-top:6px;color:{latest.score! >= baseline.score! ? 'var(--good)' : 'var(--critical)'}">
				{latest.score! - baseline.score! >= 0 ? '+' : ''}{latest.score! - baseline.score!} pts
			</div>
			<div class="k-sub">{latest.percentage! - baseline.percentage! >= 0 ? '+' : ''}{latest.percentage! - baseline.percentage!}% overall</div>
		</div>
	</div>
	{/if}
	<div class="card" style="margin-bottom:18px">
		<div class="card-head"><h3>Score trend</h3><span class="hint">Comparison across all recorded assessments</span></div>
		<div class="card-body">
			{#if series.labels.length >= 2}
				<Chart kind="area" labels={series.labels} datasets={series.datasets} opts={{ legend: true, suggestedMax: 100 }} height={230} />
			{:else}
				<EmptyState icon="trend" title="Not enough data" sub="A trend needs at least two assessments." />
			{/if}
		</div>
	</div>
	<div class="section-title-row"><h2>Assessment history</h2></div>
	<div class="card">
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Assessment</th><th>Date</th><th>Therapist</th><th>Score</th><th>%</th><th></th></tr></thead>
				<tbody>
					{#each [...list].reverse() as a (a.id)}
						<tr class="clickable" onclick={() => openAssessment(a.id)}>
							<td>
								<div class="dt-name">{a.typeName}</div>
								<div class="dt-sub">{a.label ?? ''}{a.label ? ' · ' : ''}v{a.version}{#if a.documents.length} · {a.documents.length} scan{a.documents.length === 1 ? '' : 's'}{/if}</div>
							</td>
							<td class="mono">{fmtDateShort(a.date)}</td>
							<td>{a.by}</td>
							<td class="mono">{a.score == null ? '—' : `${a.score}${a.maxScore != null ? `/${a.maxScore}` : ''}`}</td>
							<td class="mono">{a.percentage == null ? '—' : `${a.percentage}%`}</td>
							<td><button class="btn btn-ghost btn-sm"><Icon name="eye" size={13} /> View</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

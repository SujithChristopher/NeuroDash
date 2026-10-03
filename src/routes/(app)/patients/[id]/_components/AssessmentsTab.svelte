<script lang="ts">
	// Pick ONE assessment scale and see its graph, how it changed from baseline, and its own history.
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, openAssessment }: { data: PageData; openAssessment: (id: string) => void } = $props();

	const list = $derived(data.assessments);
	const href = $derived(`/assessments/new?patient=${data.patient.id}`);

	// The scales this patient has been assessed on, most recently assessed first.
	const scales = $derived.by(() => {
		const m = new Map<string, { typeId: string; name: string; count: number; last: string }>();
		for (const a of list) {
			const cur = m.get(a.typeId) ?? { typeId: a.typeId, name: a.typeName, count: 0, last: a.date };
			cur.count++;
			if (a.date > cur.last) cur.last = a.date;
			m.set(a.typeId, cur);
		}
		return [...m.values()].sort((x, y) => y.last.localeCompare(x.last));
	});

	let picked = $state<string | null>(null);
	const scaleId = $derived(scales.find((s) => s.typeId === picked)?.typeId ?? scales[0]?.typeId ?? null);
	const scale = $derived(scales.find((s) => s.typeId === scaleId) ?? null);

	// Everything below is about the chosen scale only. History lists newest first; the graph and the change go oldest first.
	const mine = $derived(list.filter((a) => a.typeId === scaleId));
	const scored = $derived(mine.filter((a) => a.score != null && a.maxScore != null && a.percentage != null));
	const baseline = $derived(scored[0]);
	const latest = $derived(scored[scored.length - 1]);
	const change = $derived(baseline && latest && scored.length >= 2 ? { pts: latest.score! - baseline.score!, pct: latest.percentage! - baseline.percentage! } : null);
	const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
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
	<div class="page-actions" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
		<div class="chips" role="radiogroup" aria-label="Assessment scale">
			{#each scales as sc (sc.typeId)}
				<button type="button" role="radio" aria-checked={sc.typeId === scaleId} class="chip" class:on={sc.typeId === scaleId} onclick={() => (picked = sc.typeId)}>
					{#if sc.typeId === scaleId}<Icon name="check" size={12} />{/if}{sc.name} <span class="count">{sc.count}</span>
				</button>
			{/each}
		</div>
		{#if data.perms.isOwner}
			<a class="btn btn-primary btn-sm" {href}><Icon name="plus" size={13} /> New Assessment</a>
		{/if}
	</div>

	{#if scale}
		{#if baseline && latest}
			<div class="grid grid-3" style="margin-bottom:18px">
				<div class="card card-pad">
					<div class="k-label">Baseline</div>
					<div class="k-val" style="font-size:22px;margin-top:6px">{baseline.score} / {baseline.maxScore}</div>
					<div class="k-sub">{fmtDateShort(baseline.date)} · {baseline.percentage}%</div>
				</div>
				<div class="card card-pad">
					<div class="k-label">Latest</div>
					<div class="k-val" style="font-size:22px;margin-top:6px">{latest.score} / {latest.maxScore}</div>
					<div class="k-sub">{fmtDateShort(latest.date)} · {latest.percentage}%</div>
				</div>
				<div class="card card-pad">
					<div class="k-label">Change</div>
					{#if change}
						<div class="k-val" style="font-size:22px;margin-top:6px;color:{change.pts >= 0 ? 'var(--good)' : 'var(--critical)'}">{sign(change.pts)} pts</div>
						<div class="k-sub">{sign(change.pct)}% of the scale since baseline</div>
					{:else}
						<div class="k-val" style="font-size:22px;margin-top:6px">—</div>
						<div class="k-sub">needs a second assessment</div>
					{/if}
				</div>
			</div>
		{/if}

		<div class="card" style="margin-bottom:18px">
			<div class="card-head"><h3>{scale.name}: score trend</h3><span class="hint">{scored.length} scored assessment{scored.length === 1 ? '' : 's'}</span></div>
			<div class="card-body">
				{#if scored.length >= 2}
					<Chart kind="area" labels={scored.map((a) => a.label ?? fmtDateShort(a.date))} datasets={[{ label: scale.name, data: scored.map((a) => a.percentage as number), color: 'var(--accent)' }]} opts={{ suggestedMax: 100 }} height={230} />
				{:else}
					<EmptyState icon="trend" title="Not enough data" sub={scored.length === 1 ? 'A trend needs at least two scored assessments of this scale.' : 'This scale has no headline score to chart.'} />
				{/if}
			</div>
		</div>

		<div class="section-title-row"><h2>{scale.name}: history</h2></div>
		<div class="card">
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Date</th><th>Therapist</th><th>Score</th><th>%</th><th></th></tr></thead>
					<tbody>
						{#each [...mine].reverse() as a (a.id)}
							<tr class="clickable" onclick={() => openAssessment(a.id)}>
								<td>
									<span class="mono">{fmtDateShort(a.date)}</span>
									{#if a.label === 'Baseline'}<Badge text="Baseline" tone="accent" />{/if}
									<div class="dt-sub">v{a.version}{#if a.documents.length} · {a.documents.length} scan{a.documents.length === 1 ? '' : 's'}{/if}</div>
								</td>
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
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 38px;
		padding: 4px 14px;
		font: inherit;
		font-size: 13px;
		color: var(--ink-700);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		cursor: pointer;
	}
	.chip.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent-soft-ink);
		font-weight: 600;
	}
	.count {
		font-size: 11px;
		color: var(--ink-500);
	}
</style>

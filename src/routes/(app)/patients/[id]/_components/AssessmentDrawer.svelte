<script lang="ts">
	import Drawer from '$lib/components/Drawer.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateShort } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, assessmentId, onclose }: { data: PageData; assessmentId: string; onclose: () => void } = $props();

	const a = $derived(data.assessments.find((x) => x.id === assessmentId));
	// "vs previous" compares with the prior scored assessment of the same scale.
	const prev = $derived.by(() => {
		if (!a || a.score == null) return null;
		const same = data.assessments.filter((x) => x.typeId === a.typeId && x.score != null);
		const i = same.findIndex((x) => x.id === a.id);
		return i > 0 ? same[i - 1] : null;
	});
</script>

<Drawer title={a?.typeName ?? 'Assessment'} {onclose}>
	{#if !a}
		<EmptyState icon="clipboard" title="Assessment not found" />
	{:else}
		<div class="kv-list" style="margin-bottom:16px">
			<div class="kv-row"><span class="kl">Patient</span><span class="kv">{data.patient.name} ({data.patient.displayCode})</span></div>
			<div class="kv-row"><span class="kl">Date</span><span class="kv">{fmtDateShort(a.date)}{a.label ? ` · ${a.label}` : ''}</span></div>
			<div class="kv-row"><span class="kl">Examiner</span><span class="kv">{a.by}</span></div>
			<div class="kv-row"><span class="kl">Scale version</span><span class="kv mono">v{a.version}</span></div>
		</div>

		{#if a.score != null}
			<div class="grid grid-3" style="margin-bottom:16px">
				<div class="card card-pad" style="padding:12px"><div class="k-label">Score</div><div class="k-val" style="font-size:19px">{a.score}{a.maxScore != null ? `/${a.maxScore}` : ''}</div></div>
				<div class="card card-pad" style="padding:12px"><div class="k-label">Percentage</div><div class="k-val" style="font-size:19px">{a.percentage == null ? '—' : `${a.percentage}%`}</div></div>
				<div class="card card-pad" style="padding:12px">
					<div class="k-label">vs Previous</div>
					<div class="k-val" style="font-size:19px;color:{prev ? (a.score >= prev.score! ? 'var(--good)' : 'var(--critical)') : 'var(--ink-500)'}">
						{prev ? (a.score - prev.score! >= 0 ? '+' : '') + Math.round((a.score - prev.score!) * 100) / 100 : '—'}
					</div>
				</div>
			</div>
		{/if}

		{#if a.scores.length}
			<div class="section-title-row" style="margin-top:0"><h2 style="font-size:13.5px">Calculated scores <span class="muted" style="font-weight:400">(auto)</span></h2></div>
			<div class="kv-list" style="margin-bottom:16px">
				{#each a.scores as s (s.label)}
					<div class="kv-row"><span class="kl">{s.label}</span><span class="kv mono">{s.value}</span></div>
				{/each}
			</div>
		{/if}

		{#if a.documents.length}
			<div class="section-title-row" style="margin-top:0"><h2 style="font-size:13.5px">Scanned documents</h2></div>
			{#each a.documents as d (d.id)}
				<div class="doc-row">
					<div class="doc-ic"><Icon name="file" size={16} /></div>
					<div style="flex:1"><div class="doc-name">{d.name}</div><div class="doc-meta">{d.docType ?? 'FILE'} · {d.sizeKb ?? '—'} KB</div></div>
					<a class="btn btn-ghost btn-sm" href="/api/documents/{d.id}" target="_blank" rel="noopener"><Icon name="eye" size={13} /> View</a>
					<a class="btn btn-ghost btn-sm" href="/api/documents/{d.id}?download=1" aria-label="Download {d.name}"><Icon name="download" size={13} /></a>
				</div>
			{/each}
		{/if}

		<div class="section-title-row"><h2 style="font-size:13.5px">Responses</h2></div>
		{#each a.sections as sec, i (i)}
			{#if sec.title}<div class="eyebrow" style="margin:12px 0 6px">{sec.title}</div>{/if}
			{#each sec.rows as r (r.label)}
				<div class="kv-row" style="margin-bottom:6px"><span class="kl" style="max-width:62%">{r.label}</span><span class="kv">{r.value}</span></div>
			{/each}
		{:else}
			<div class="muted" style="font-size:12.5px">No item responses recorded.</div>
		{/each}
	{/if}
</Drawer>

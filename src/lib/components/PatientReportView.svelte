<script lang="ts">
	// One patient report, used three ways: live (notes editable), print, and as a saved snapshot (read-only).
	import Chart from './Chart.svelte';
	import Badge from './Badge.svelte';
	import KpiCard from './KpiCard.svelte';
	import EmptyState from './EmptyState.svelte';
	import { MECHANISM_LABELS, labelFor, movementTerm } from '$lib/constants';
	import { adherenceTone, fmtDateShort, fmtHrsFromMin } from '$lib/utils';
	import type { PatientReportData, ReportNotes } from '$lib/patientReport';

	let {
		report,
		notes = $bindable(),
		editable = false
	}: { report: PatientReportData; notes: ReportNotes; editable?: boolean } = $props();

	const r = $derived(report);
	const color = (series: string | null) => `var(--${series ?? 'series-1'})`;
	const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
</script>

{#snippet noteBox(label: string, value: string, set: (v: string) => void, id: string)}
	{#if editable}
		<div class="field no-print" style="margin-top:12px">
			<label for={id}>{label}</label>
			<textarea {id} rows="3" maxlength="4000" {value} oninput={(e) => set(e.currentTarget.value)} placeholder="Add a note…"></textarea>
		</div>
	{/if}
	{#if value}
		<div class="report-note" class:print-only={editable}><div class="k-label">{label}</div><p>{value}</p></div>
	{/if}
{/snippet}

<div class="report">
	<div class="report-head">
		<div>
			<h2 style="font-size:20px">Patient report <span class="mono muted" style="font-size:13px;font-weight:400">{r.patient.displayCode}</span></h2>
			<div class="sub">
				Primary therapist {r.patient.therapist} · <Badge text={r.patient.status} />
				· Generated {fmtDateShort(r.generatedAt)}
				· {#if r.period}<b>Period: {r.period.from ? fmtDateShort(r.period.from) : 'start'} to {r.period.to ? fmtDateShort(r.period.to) : 'today'}</b>{:else}All time{/if}
			</div>
			<div class="sub" style="margin-top:4px">
				{r.patient.age != null ? `${r.patient.age} yrs` : 'Age —'} · {r.patient.gender ?? '—'} · Affected side {r.patient.affectedSide ?? '—'}
				{#if r.patient.strokeDate}· Stroke / injury {fmtDateShort(r.patient.strokeDate)}{/if}
			</div>
		</div>
	</div>

	<div class="grid grid-4" style="margin-bottom:16px">
		<KpiCard label="Therapy Time" value={fmtHrsFromMin(r.totals.minutes)} icon="clock" tone="info" sub="{r.totals.sessions} sessions" />
		<KpiCard label="Devices Used" value={r.totals.devices} icon="device" tone="accent" sub={r.devices.map((d) => d.name).join(', ') || '—'} />
		<KpiCard label="Plan Adherence" value={r.plan ? `${r.plan.adherence}%` : '—'} icon="target" tone={r.plan ? adherenceTone(r.plan.adherence) : 'neutral'} sub={r.plan ? (r.period ? 'in this period' : `Day ${r.plan.currentDay} of ${r.plan.durationDays}`) : 'No plan'} />
		<KpiCard label="Scales Assessed" value={r.scales.length} icon="clipboard" tone="info" />
	</div>

	{#if r.plan}
		<div class="card card-pad" style="margin-bottom:16px">
			<div class="k-label">Therapy plan</div>
			<div class="k-sub" style="margin-top:6px">
				Training the <b>{r.plan.trainingSide ?? '—'}</b> side · {r.plan.dailyTargetMinutes} min/day target · started {fmtDateShort(r.plan.startDate)} ·
				planned devices: {r.plan.devices.join(', ') || '—'} · status {r.plan.status}
			</div>
		</div>
	{/if}

	<div class="section-title-row"><h2>Devices used</h2></div>
	{#if r.devices.length === 0}
		<div class="card" style="margin-bottom:16px"><EmptyState icon="device" title="No device sessions yet" sub="Sessions appear once the training devices upload them." /></div>
	{:else}
		<div class="card" style="margin-bottom:16px">
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Device</th><th>Time used</th><th>Sessions</th><th>First used</th><th>Last used</th></tr></thead>
					<tbody>
						{#each r.devices as d (d.typeId)}
							<tr>
								<td class="dt-name"><span class="swatch" style="background:{color(d.colorSeries)}"></span>{d.name}</td>
								<td class="mono">{fmtHrsFromMin(d.minutes)}</td>
								<td class="mono">{d.sessions}</td>
								<td class="mono">{d.firstDay ? fmtDateShort(d.firstDay) : '—'}</td>
								<td class="mono">{d.lastDay ? fmtDateShort(d.lastDay) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
		<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:8px">
			{#each r.devices as d (d.typeId)}
				{@const term = movementTerm(d.typeId)}
				<div class="card">
					<div class="card-head"><h3>{d.name}: {term.toLowerCase()}s trained</h3><span class="hint">trials</span></div>
					<div class="card-body">
						{#if d.movements.length}
							<Chart kind="bar" labels={d.movements.map((m) => labelFor(MECHANISM_LABELS, m.code))} datasets={[{ label: 'Trials', data: d.movements.map((m) => m.trials), color: color(d.colorSeries) }]} opts={{ horizontal: true }} height={Math.max(120, d.movements.length * 44 + 40)} />
							<table class="dt" style="margin-top:8px">
								<thead><tr><th>{term}</th><th>Trials</th><th>Time</th></tr></thead>
								<tbody>
									{#each d.movements as m (m.code)}
										<tr><td>{labelFor(MECHANISM_LABELS, m.code)}</td><td class="mono">{m.trials}</td><td class="mono">{m.minutes} min</td></tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<EmptyState icon="activity" title="No {term.toLowerCase()} data recorded" />
						{/if}
					</div>
				</div>
			{/each}
		</div>
		{@render noteBox('Notes on device use', notes.devices, (v) => (notes.devices = v), 'rn-devices')}
	{/if}

	<div class="section-title-row"><h2>Assessments</h2></div>
	{#if r.scales.length === 0}
		<div class="card" style="margin-bottom:16px"><EmptyState icon="clipboard" title="No scored assessments yet" /></div>
	{/if}
	{#each r.scales as sc (sc.scaleId)}
		<div class="card report-scale" style="margin-bottom:16px">
			<div class="card-head">
				<h3>{sc.title}</h3>
				<span class="hint">{sc.points.length} assessment{sc.points.length === 1 ? '' : 's'}</span>
			</div>
			<div class="card-body">
				{#if sc.change}
					<div class="change" class:up={sc.change.direction === 'improved'} class:down={sc.change.direction === 'declined'}>
						{#if sc.change.direction === 'unchanged'}
							No change: {sc.change.fromScore}/{sc.change.max} at baseline and {sc.change.toScore}/{sc.change.max} now ({sc.change.toPct}%).
						{:else}
							<b>{sc.change.direction === 'improved' ? 'Improved' : 'Declined'} by {Math.abs(sc.change.pctPoints)} percentage points</b>
							({sign(sc.change.toScore - sc.change.fromScore)} points): {sc.change.fromScore}/{sc.change.max} ({sc.change.fromPct}%) → {sc.change.toScore}/{sc.change.max} ({sc.change.toPct}%).
						{/if}
					</div>
				{:else}
					<div class="change">One assessment so far ({sc.points[0].score}/{sc.points[0].max}, {sc.points[0].pct}%). A change needs at least two.</div>
				{/if}
				{#if sc.points.length >= 2}
					<Chart kind="area" labels={sc.points.map((p) => p.label)} datasets={[{ label: sc.title, data: sc.points.map((p) => p.pct), color: 'var(--accent)' }]} opts={{ suggestedMax: 100 }} height={190} />
				{/if}
				<table class="dt" style="margin-top:8px">
					<thead><tr><th>Timepoint</th><th>Date</th><th>Score</th><th>%</th></tr></thead>
					<tbody>
						{#each sc.points as p, i (i)}
							<tr><td>{p.label}</td><td class="mono">{fmtDateShort(p.date)}</td><td class="mono">{p.score}/{p.max}</td><td class="mono">{p.pct}%</td></tr>
						{/each}
					</tbody>
				</table>
				{@render noteBox(`Notes on ${sc.title}`, notes.scales[sc.scaleId] ?? '', (v) => (notes.scales[sc.scaleId] = v), `rn-${sc.scaleId}`)}
			</div>
		</div>
	{/each}

	<div class="section-title-row"><h2>Summary</h2></div>
	{#if editable}
		{@render noteBox('Therapist summary', notes.summary, (v) => (notes.summary = v), 'rn-summary')}
	{:else if notes.summary}
		{@render noteBox('Therapist summary', notes.summary, () => {}, 'rn-summary')}
	{:else}
		<div class="muted" style="font-size:12.5px">No summary was written.</div>
	{/if}
</div>

<style>
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		margin-right: 8px;
	}
	.report-head {
		margin-bottom: 14px;
	}
	.change {
		font-size: 13px;
		padding: 10px 12px;
		border-radius: var(--radius-s);
		background: var(--surface-2);
		margin-bottom: 10px;
	}
	.change.up {
		background: var(--good-soft);
	}
	.change.down {
		background: var(--critical-soft);
	}
	.report-note {
		margin-top: 12px;
		padding: 10px 12px;
		border-left: 3px solid var(--accent);
		background: var(--surface-2);
		white-space: pre-wrap;
		font-size: 13px;
	}
	.report-note p {
		margin: 4px 0 0;
	}
</style>

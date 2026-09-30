<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { downloadCsv, toCsv } from '$lib/csv';
	import { adherenceTone, fmtHrsFromMin } from '$lib/utils';

	let { data } = $props();

	const VIEWS = [
		['patient', 'Patient Report', 'users'],
		['device', 'Device Usage Report', 'device'],
		['inflow', 'Patient Inflow Report', 'trend']
	] as const;
	const RANGES = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']];

	function nav(params: Record<string, string>) {
		const q = new URLSearchParams({ view: data.view, ...params });
		goto(`?${q}`, { noScroll: true, keepFocus: true });
	}

	const r = $derived(data.patientReport);

	function exportSessions() {
		if (!r) return;
		downloadCsv(
			`sessions-${r.patient.displayCode}.csv`,
			toCsv(
				['Date', 'Device', 'Duration (min)', 'Targets', 'Hits', 'Accuracy (%)', 'Stars'],
				r.sessions.map((s) => [s.date, s.device.displayCode, s.durationMinutes, s.targets, s.hits, s.accuracyPct, s.stars])
			)
		);
	}
	function exportDevices() {
		downloadCsv(
			'device-usage.csv',
			toCsv(
				['Device', 'Type', 'Sessions', 'Minutes', 'Avg accuracy (%)', 'Stars'],
				data.deviceRows.map((d) => [d.displayCode, d.category, d.sessions, d.totalMin, d.avgAccuracy, d.totalStars])
			)
		);
	}
	function exportInflow() {
		if (!data.inflow) return;
		downloadCsv(
			`patient-inflow-${data.range}.csv`,
			toCsv(['Period', 'New patients'], data.inflow.labels.map((l, i) => [l, data.inflow!.values[i]]))
		);
	}
</script>

<PageHead title="Reports" sub="Patient, device and inflow reports, exportable as CSV." />

<div class="tabs">
	{#each VIEWS as [id, label, icon] (id)}
		<button class="tab-btn" class:active={data.view === id} onclick={() => goto(`?view=${id}`, { noScroll: true })}>
			<Icon name={icon} size={14} />{label}
		</button>
	{/each}
</div>

{#if data.view === 'patient'}
	<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
		<select class="filter-select" style="min-width:260px" value={data.patientId ?? ''} onchange={(e) => e.currentTarget.value ? nav({ patient: e.currentTarget.value }) : nav({})} aria-label="Patient">
			<option value="">Select a patient…</option>
			{#each data.patients as p (p.id)}<option value={p.id}>{p.name} ({p.displayCode})</option>{/each}
		</select>
		{#if r}<button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick={exportSessions}><Icon name="download" size={13} /> Export sessions CSV</button>{/if}
	</div>

	{#if !r}
		<div class="card"><EmptyState icon="report" title="Select a patient" sub="Choose a patient above to generate a report." /></div>
	{:else}
		<div class="page-head" style="margin-bottom:14px">
			<div>
				<h2 style="font-size:18px">{r.patient.name} <span class="mono muted" style="font-size:12px;font-weight:400">{r.patient.displayCode}</span></h2>
				<div class="sub">Primary therapist {r.patient.therapist} · <Badge text={r.patient.status} /></div>
			</div>
		</div>
		<div class="grid grid-4" style="margin-bottom:16px">
			<KpiCard label="Plan Adherence" value={r.plan ? `${r.adherence}%` : '—'} icon="target" tone={r.plan ? adherenceTone(r.adherence) : 'neutral'} sub={r.plan ? r.plan.name : 'No plan'} />
			<KpiCard label="Sessions" value={r.sessionsCount} icon="activity" tone="info" sub="Avg accuracy {r.avgAccuracy}%" />
			<KpiCard label="Therapy Hours" value={fmtHrsFromMin(r.totalMin)} icon="clock" tone="info" />
			<KpiCard label="Devices Used" value={r.devicesUsed.length} icon="device" tone="accent" sub={r.devicesUsed.join(', ') || '—'} />
		</div>
		<div class="card card-pad">
			<div class="k-label">Assessment change</div>
			{#if r.assessment}
				<div class="k-val" style="font-size:22px;margin-top:6px;color:{r.assessment.latest >= r.assessment.baseline ? 'var(--good)' : 'var(--critical)'}">
					{r.assessment.latest - r.assessment.baseline >= 0 ? '+' : ''}{r.assessment.latest - r.assessment.baseline}%
				</div>
				<div class="k-sub">{r.assessment.type}: baseline {r.assessment.baselineScore} ({r.assessment.baseline}%) → latest {r.assessment.latestScore} ({r.assessment.latest}%) across {r.assessment.count} assessments</div>
			{:else}
				<div class="k-sub" style="margin-top:6px">No assessments recorded.</div>
			{/if}
		</div>
	{/if}
{:else if data.view === 'device'}
	<div class="card">
		<div class="card-head"><h3>Device usage comparison</h3><button class="btn btn-secondary btn-sm" onclick={exportDevices}><Icon name="download" size={13} /> Export CSV</button></div>
		<div class="card-body">
			<Chart kind="bar" labels={data.deviceRows.slice(0, 8).map((d) => d.displayCode)} datasets={[{ label: 'Hours used', data: data.deviceRows.slice(0, 8).map((d) => +(d.totalMin / 60).toFixed(1)), color: 'var(--accent)' }]} opts={{ horizontal: true, thick: 18 }} height={260} />
		</div>
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Device</th><th>Type</th><th>Sessions</th><th>Time</th><th>Avg Accuracy</th><th>Stars</th></tr></thead>
				<tbody>
					{#each data.deviceRows as d (d.id)}
						<tr><td class="mono dt-name">{d.displayCode}</td><td>{d.category}</td><td>{d.sessions}</td><td>{fmtHrsFromMin(d.totalMin)}</td><td class="mono">{d.avgAccuracy}%</td><td>{d.totalStars}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else if data.inflow}
	<div class="card">
		<div class="card-head">
			<div><h3>Patient inflow</h3><div class="hint">New patient registrations over time</div></div>
			<div style="display:flex;gap:10px;align-items:center">
				<div class="range-toggle">
					{#each RANGES as [k, l] (k)}<button class:active={data.range === k} onclick={() => nav({ range: k })}>{l}</button>{/each}
				</div>
				<button class="btn btn-secondary btn-sm" onclick={exportInflow}><Icon name="download" size={13} /> Export CSV</button>
			</div>
		</div>
		<div class="card-body">
			<Chart kind="area" labels={data.inflow.labels} datasets={[{ label: 'New patients', data: data.inflow.values, color: 'var(--accent)' }]} opts={{ maxTicksX: data.range === 'year' ? 12 : 8 }} height={260} />
		</div>
	</div>
{/if}

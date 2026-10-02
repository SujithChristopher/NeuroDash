<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { deserialize, enhance } from '$app/forms';
	import PatientReportView from '$lib/components/PatientReportView.svelte';
	import { emptyNotes, type ReportNotes } from '$lib/patientReport';
	import { toastEnhance } from '$lib/enhance';
	import { toast } from '$lib/stores/toast';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { downloadCsv, toCsv } from '$lib/csv';
	import { fmtDateTime, fmtHrsFromMin } from '$lib/utils';

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

	// Notes typed on the report; they start empty for every patient and are saved together with the report.
	let notes = $state<ReportNotes>(emptyNotes());
	let title = $state('');
	$effect(() => {
		void data.patientId;
		notes = emptyNotes();
		title = '';
	});

	// The period the report covers. Empty = everything. Changing it reloads the report for that period.
	let from = $state('');
	let to = $state('');
	$effect(() => {
		from = data.period.from ?? '';
		to = data.period.to ?? '';
	});
	const periodParams = () => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
	const today = new Date().toISOString().slice(0, 10);
	const ago = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
	function setPeriod(f: string, t: string) {
		from = f;
		to = t;
		apply();
	}
	function apply() {
		if (data.patientId) nav({ patient: data.patientId, ...periodParams() });
	}

	// What was last saved, so printing the same report twice does not save it twice.
	const contentKey = () => JSON.stringify([data.patientId, from, to, title, notes]);
	let lastSaved = $state('');
	let printing = $state(false);

	/** Print saves the report first (when this user can), so whatever was printed can always be found again. */
	async function printReport() {
		if (printing) return;
		printing = true;
		try {
			if (data.canSave && data.storageReady && data.patientId && contentKey() !== lastSaved) {
				const fd = new FormData();
				fd.set('patientId', data.patientId);
				fd.set('from', from);
				fd.set('to', to);
				fd.set('title', title);
				fd.set('notes', JSON.stringify(notes));
				try {
					const res = await fetch('?/saveReport', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
					const result = deserialize(await res.text());
					if (result.type === 'success') {
						lastSaved = contentKey();
						toast('Report saved, printing…');
						await invalidateAll(); // refreshes the Saved reports list
					} else {
						toast('Could not save the report first; printing anyway.', 'critical');
					}
				} catch {
					toast('Could not save the report first; printing anyway.', 'critical');
				}
			}
		} finally {
			printing = false;
		}
		window.print();
	}

	function exportSessions() {
		if (!r) return;
		downloadCsv(
			`sessions-${r.patient.displayCode}.csv`,
			toCsv(
				['Date', 'Device', 'Duration (min)'],
				data.sessions.map((s) => [s.date, s.device, s.minutes])
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

<PageHead title="Reports" sub="Patient, device and inflow reports. Patient reports can be annotated, printed and saved." />

<div class="tabs">
	{#each VIEWS as [id, label, icon] (id)}
		<button class="tab-btn" class:active={data.view === id} onclick={() => goto(`?view=${id}`, { noScroll: true })}>
			<Icon name={icon} size={14} />{label}
		</button>
	{/each}
</div>

{#if data.view === 'patient'}
	<div class="card card-pad no-print" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
		<select class="filter-select" style="min-width:260px" value={data.patientId ?? ''} onchange={(e) => e.currentTarget.value ? nav({ patient: e.currentTarget.value, ...periodParams() }) : nav({})} aria-label="Patient">
			<option value="">Select a patient…</option>
			{#each data.patients as p (p.id)}<option value={p.id}>{p.name} ({p.displayCode})</option>{/each}
		</select>
		{#if r}
			<div style="flex-basis:100%;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
				<div class="field" style="margin:0"><label for="rp-from">From</label><input id="rp-from" type="date" bind:value={from} max={to || today} onchange={apply} /></div>
				<div class="field" style="margin:0"><label for="rp-to">To</label><input id="rp-to" type="date" bind:value={to} min={from} max={today} onchange={apply} /></div>
				<div class="range-toggle" role="group" aria-label="Quick periods">
					<button class:active={!from && !to} onclick={() => setPeriod('', '')}>All time</button>
					<button onclick={() => setPeriod(ago(7), '')}>Last 7 days</button>
					<button onclick={() => setPeriod(ago(30), '')}>Last 30 days</button>
					<button onclick={() => setPeriod(ago(90), '')}>Last 90 days</button>
				</div>
			</div>
			<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
				<button class="btn btn-secondary btn-sm" onclick={exportSessions}><Icon name="download" size={13} /> Sessions CSV</button>
				<button class="btn btn-secondary btn-sm" onclick={printReport} disabled={printing}><Icon name="report" size={13} /> Print</button>
			</div>
		{/if}
	</div>

	{#if !r}
		<div class="card"><EmptyState icon="report" title="Select a patient" sub="Choose a patient above to generate a report." /></div>
	{:else}
		<PatientReportView report={r} bind:notes editable={data.canSave} />

		{#if data.canSave}
			<form class="card card-pad no-print" style="margin:16px 0;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap" method="POST" action="?/saveReport" use:enhance={toastEnhance({ onSuccess: () => (lastSaved = contentKey()) })}>
				<input type="hidden" name="patientId" value={data.patientId} />
				<input type="hidden" name="from" value={from} />
				<input type="hidden" name="to" value={to} />
				<input type="hidden" name="notes" value={JSON.stringify(notes)} />
				<div class="field" style="flex:1;min-width:220px;margin:0">
					<label for="rp-title">Report title <span class="muted">(optional)</span></label>
					<input id="rp-title" name="title" type="text" maxlength="120" bind:value={title} placeholder="e.g. 4-week review" />
				</div>
				<button class="btn btn-primary" disabled={!data.storageReady}><Icon name="check" size={14} /> Save report</button>
				{#if !data.storageReady}<div class="field-hint" style="flex-basis:100%">Report storage is not set up: set NEURODASH_DATA_DIR (or REPORTS_DIR) to save reports.</div>{/if}
			</form>
		{/if}

		<div class="section-title-row no-print"><h2>Saved reports</h2><span class="muted" style="font-size:12px">snapshots with their notes, kept on the local server. Printing saves one automatically.</span></div>
		<div class="card no-print">
			{#if data.savedReports.length === 0}
				<EmptyState icon="report" title="No saved reports yet" sub="Add notes above and press Save report to keep one." />
			{:else}
				<div class="table-wrap">
					<table class="dt">
						<thead><tr><th>Report</th><th>Saved by</th><th>Saved</th><th></th></tr></thead>
						<tbody>
							{#each data.savedReports as sr (sr.id)}
								<tr class="clickable" onclick={() => goto(`/reports/saved/${sr.id}`)}>
									<td class="dt-name">{sr.title}</td><td>{sr.by}</td><td class="mono">{fmtDateTime(sr.createdAt)}</td><td class="row-chevron"><Icon name="chevron" size={14} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
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

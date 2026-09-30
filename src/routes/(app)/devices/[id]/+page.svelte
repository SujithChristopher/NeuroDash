<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IssueCard from '$lib/components/IssueCard.svelte';
	import ReportIssueModal from '$lib/components/ReportIssueModal.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { crumbDetail } from '$lib/stores/page';
	import { toastEnhance } from '$lib/enhance';
	import { EVENT_ICON, EVENT_TONE } from '$lib/deviceEvents';
	import { fmtDate, fmtDateShort, fmtDateTime, fmtMin, timeAgo } from '$lib/utils';

	let { data, form } = $props();

	const TABS = [
		['overview', 'Overview', 'home'],
		['usage', 'Usage', 'bar'],
		['assignments', 'Assignments', 'link'],
		['issues', 'Issues', 'alert'],
		['maintenance', 'Maintenance', 'wrench'],
		['history', 'History', 'history']
	] as const;

	const d = $derived(data.device);
	const tab = $derived.by(() => {
		const t = page.url.searchParams.get('tab');
		return TABS.some((x) => x[0] === t) ? t : 'overview';
	});
	const openIssues = $derived(data.issues.filter((i) => !['Resolved', 'Cleared'].includes(i.status)));
	const seriesIdx = $derived(['PLUTO', 'MARS', 'ORION', 'VEGA', 'COSMOS', 'ATLAS'].indexOf(d.type.id) + 1 || 1);

	let reporting = $state(false);
	let logging = $state(false);
	let assigning = $state(false);
	const today = new Date().toISOString().slice(0, 10);

	$effect(() => {
		crumbDetail.set(d.displayCode);
	});
</script>

<div class="patient-header">
	<div class="ph-top">
		<div class="ph-id">
			<div class="ph-av" style="background:var(--series-{seriesIdx});color:#fff"><Icon name="device" size={24} /></div>
			<div>
				<div class="ph-name mono">{d.displayCode}</div>
				<div class="ph-meta">
					<span>{d.type.category}</span><span class="sep"></span><span>SN {d.serialNumber}</span><span class="sep"></span><span>FW {d.firmwareVersion ?? '—'}</span>
				</div>
			</div>
		</div>
		<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
			<Badge text={d.status} />
			{#if data.perms.canReport}
				<button class="btn btn-secondary btn-sm" onclick={() => (reporting = true)}><Icon name="alert" size={13} /> Report Issue</button>
			{/if}
			{#if data.perms.isEngineer}
				<button class="btn btn-secondary btn-sm" onclick={() => (logging = true)}><Icon name="wrench" size={13} /> Log maintenance</button>
				{#if d.status === 'Available'}
					<button class="btn btn-primary btn-sm" onclick={() => (assigning = true)}><Icon name="link" size={13} /> Assign</button>
				{:else if d.status === 'In Use'}
					<form method="POST" action="?/returnDevice" use:enhance={toastEnhance()}>
						<button class="btn btn-secondary btn-sm">Return to inventory</button>
					</form>
				{/if}
			{/if}
		</div>
	</div>
	<div class="ph-facts">
		<div class="ph-fact"><div class="fl">Location</div><div class="fv">{d.location ?? '—'}</div></div>
		<div class="ph-fact">
			<div class="fl">Current Patient</div>
			<div class="fv">{#if d.currentPatient && !data.perms.isEngineer}<a href="/patients/{d.currentPatient.id}">{d.currentPatient.label}</a>{:else}{d.currentPatient?.label ?? '—'}{/if}</div>
		</div>
		<div class="ph-fact"><div class="fl">Last Sync</div><div class="fv">{d.lastSyncAt ? timeAgo(d.lastSyncAt) : '—'}</div></div>
		<div class="ph-fact"><div class="fl">Open Issues</div><div class="fv">{openIssues.length}</div></div>
		<div class="ph-fact"><div class="fl">Registered</div><div class="fv">{fmtDateShort(d.registeredOn)}</div></div>
	</div>
</div>

<div class="tabs" role="tablist">
	{#each TABS as [id, label, icon] (id)}
		<button class="tab-btn" class:active={tab === id} role="tab" aria-selected={tab === id} onclick={() => goto(`?tab=${id}`, { noScroll: true, keepFocus: true })}>
			<Icon name={icon} size={14} />{label}
		</button>
	{/each}
</div>

{#if tab === 'overview'}
	<div class="grid grid-4" style="margin-bottom:18px">
		<KpiCard label="Total Sessions" value={data.stats.sessions} icon="activity" tone="accent" />
		<KpiCard label="Total Trials" value={data.stats.totalTrials} icon="target" tone="info" />
		<KpiCard label="Avg Hit Rate" value="{data.stats.avgAccuracy}%" icon="gauge" tone="good" />
		<KpiCard label="Stars Earned" value={data.stats.totalStars} icon="star" tone="warning" />
	</div>
	<div class="two-col">
		<div class="card">
			<div class="card-head"><h3>Utilization — last 14 days</h3></div>
			<div class="card-body">
				<Chart kind="bar" labels={data.utilization.labels.map((k) => fmtDateShort(k))} datasets={[{ label: 'Minutes used', data: data.utilization.minutes, color: `var(--series-${seriesIdx})` }]} height={210} />
			</div>
		</div>
		<div class="card">
			<div class="card-head"><h3>Mechanisms &amp; games supported</h3></div>
			<div class="card-body">
				<div style="margin-bottom:12px">
					<div class="eyebrow" style="margin-bottom:6px">Mechanisms</div>
					{#each d.type.mechanisms as m (m)}<span class="pill" style="margin:2px 4px 2px 0">{m}</span>{/each}
				</div>
				<div>
					<div class="eyebrow" style="margin-bottom:6px">Games</div>
					{#each d.type.games as g (g)}<span class="pill" style="margin:2px 4px 2px 0">{g}</span>{:else}<span class="muted" style="font-size:12px">No games for this device type.</span>{/each}
				</div>
				<hr class="sep" />
				<div class="kv-row"><span class="kl">Patients using this device</span><span class="kv">{data.stats.patientsUsing.length}</span></div>
			</div>
		</div>
	</div>
{:else if tab === 'usage'}
	{#if data.stats.sessions === 0}
		<div class="card"><EmptyState icon="activity" title="No usage recorded for this device yet" /></div>
	{:else}
		<div class="two-col" style="margin-bottom:16px">
			<div class="card">
				<div class="card-head"><h3>Game distribution</h3></div>
				<div class="card-body">
					{#if data.games.length}
						<div style="display:flex;align-items:center;gap:16px">
							<div style="width:130px;flex-shrink:0"><Chart kind="donut" labels={data.games.map((g) => g.label)} data={data.games.map((g) => g.count)} height={130} /></div>
							<div class="legend-row" style="flex-direction:column;gap:8px">
								{#each data.games as g, i (g.label)}
									<div class="legend-item"><span class="sw" style="background:var(--series-{(i % 6) + 1})"></span>{g.label} <span class="mono muted">({g.count})</span></div>
								{/each}
							</div>
						</div>
					{:else}<EmptyState icon="target" title="No game trials recorded" />{/if}
				</div>
			</div>
			<div class="card">
				<div class="card-head"><h3>Patients using this device</h3></div>
				<div class="card-body">
					{#each data.stats.patientsUsing as p (p.id)}
						<div class="kv-row" style="margin-bottom:8px"><span class="kl">{p.label}</span><span class="kv mono">{p.code}</span></div>
					{/each}
				</div>
			</div>
		</div>
		<div class="section-title-row"><h2>Recent sessions on this device</h2></div>
		<div class="card">
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Patient</th><th>Date</th><th>Duration</th><th>Accuracy</th><th>Stars</th></tr></thead>
					<tbody>
						{#each data.recentSessions as s (s.id)}
							<tr>
								<td>{s.patient}</td><td class="mono">{fmtDateTime(s.startTime)}</td><td>{fmtMin(s.durationMinutes ?? 0)}</td>
								<td class="mono">{s.totalTargets ? Math.round((s.totalHits / s.totalTargets) * 100) : 0}%</td><td class="mono">{s.totalStars}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
{:else if tab === 'assignments'}
	<div class="card">
		{#if data.assignments.length === 0}
			<EmptyState icon="link" title="No assignments yet" />
		{:else}
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Patient</th><th>Assigned</th><th>Returned</th><th>Status</th></tr></thead>
					<tbody>
						{#each data.assignments as a (a.id)}
							<tr>
								<td>{a.patient}</td><td class="mono">{fmtDateShort(a.assignedDate)}</td>
								<td class="mono">{a.returnedDate ? fmtDateShort(a.returnedDate) : '—'}</td><td><Badge text={a.status} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{:else if tab === 'issues'}
	{#each data.issues as i (i.id)}
		<IssueCard issue={i} role={data.user.role} showDevice={false} />
	{:else}
		<div class="card"><EmptyState icon="check" title="No issues recorded for this device" /></div>
	{/each}
{:else if tab === 'maintenance'}
	<div class="card">
		{#if data.maintenance.length === 0}
			<EmptyState icon="wrench" title="No maintenance history recorded" />
		{:else}
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Date</th><th>Type</th><th>Engineer</th><th>Notes</th></tr></thead>
					<tbody>
						{#each data.maintenance as m (m.id)}
							<tr><td class="mono">{fmtDateShort(m.date)}</td><td>{m.type}</td><td>{m.engineer}</td><td class="muted">{m.notes ?? '—'}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{:else}
	<div class="card card-pad">
		{#if data.events.length === 0}
			<EmptyState icon="history" title="No events recorded" />
		{:else}
			<div class="timeline">
				{#each data.events as e (e.id)}
					<div class="tl-item">
						<span class="tl-dot" style="background:var(--{EVENT_TONE[e.type] ?? 'neutral'}-soft);color:var(--{EVENT_TONE[e.type] ?? 'neutral'})"><Icon name={EVENT_ICON[e.type] ?? 'info'} size={10} /></span>
						<div class="tl-date">{fmtDate(e.date)}</div>
						<div class="tl-title" style="text-transform:capitalize">{e.type}</div>
						<div class="tl-desc">{e.description}</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

{#if reporting}
	<ReportIssueModal devices={[{ id: d.id, displayCode: d.displayCode }]} deviceId={d.id} onclose={() => (reporting = false)} />
{/if}

{#if logging}
	<Modal title="Log maintenance — {d.displayCode}" onclose={() => (logging = false)}>
		<form id="log-maint" method="POST" action="?/logMaintenance" use:enhance={toastEnhance({ onSuccess: () => (logging = false), reset: true })}>
			<div class="field">
				<label for="lm-type">Maintenance type</label>
				<select id="lm-type" name="maintenanceType" required>{#each data.maintenanceTypes as t (t)}<option>{t}</option>{/each}</select>
			</div>
			<div class="field"><label for="lm-date">Date</label><input id="lm-date" name="maintenanceDate" type="date" value={today} max={today} required /></div>
			<div class="field"><label for="lm-notes">Notes</label><textarea id="lm-notes" name="notes" maxlength="2000"></textarea></div>
			{#if form?.error}<div class="alert alert-critical"><Icon name="alert" size={15} /><span>{form.error}</span></div>{/if}
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (logging = false)}>Cancel</button>
			<button class="btn btn-primary" form="log-maint">Save</button>
		{/snippet}
	</Modal>
{/if}

{#if assigning}
	<Modal title="Assign {d.displayCode} to a patient" onclose={() => (assigning = false)}>
		<form id="assign-dev" method="POST" action="?/assign" use:enhance={toastEnhance({ onSuccess: () => (assigning = false), reset: true })}>
			<div class="field">
				<label for="as-patient">Patient</label>
				<select id="as-patient" name="patientId" required>
					<option value="">Select a patient…</option>
					{#each data.patients as p (p.id)}<option value={p.id}>{p.displayCode}</option>{/each}
				</select>
				<div class="field-hint">For a therapist-initiated request, use the Device Requests workflow instead.</div>
			</div>
			{#if form?.error}<div class="alert alert-critical"><Icon name="alert" size={15} /><span>{form.error}</span></div>{/if}
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (assigning = false)}>Cancel</button>
			<button class="btn btn-primary" form="assign-dev">Assign device</button>
		{/snippet}
	</Modal>
{/if}

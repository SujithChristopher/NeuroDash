<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import SessionDrawer from '$lib/components/SessionDrawer.svelte';
	import { crumbDetail } from '$lib/stores/page';
	import { computePatientStats } from '$lib/patientStats';
	import { PATIENT_STATUSES } from '$lib/constants';
	import { ageFrom, fmtDateShort, fmtHrsFromMin, initials } from '$lib/utils';
	import { toast } from '$lib/stores/toast';

	import OverviewTab from './_components/OverviewTab.svelte';
	import AssessmentsTab from './_components/AssessmentsTab.svelte';
	import PlanTab from './_components/PlanTab.svelte';
	import SessionsTab from './_components/SessionsTab.svelte';
	import DevicesTab from './_components/DevicesTab.svelte';
	import ProgressTab from './_components/ProgressTab.svelte';
	import DocumentsTab from './_components/DocumentsTab.svelte';
	import NotesTab from './_components/NotesTab.svelte';
	import TimelineTab from './_components/TimelineTab.svelte';
	import AssessmentDrawer from './_components/AssessmentDrawer.svelte';

	let { data, form } = $props();

	const TABS = [
		['overview', 'Overview', 'home'],
		['assessments', 'Assessments', 'clipboard'],
		['plan', 'Therapy Plan', 'target'],
		['sessions', 'Sessions', 'activity'],
		['devices', 'Devices', 'device'],
		['progress', 'Progress', 'trend'],
		['documents', 'Documents', 'file'],
		['notes', 'Notes', 'edit'],
		['timeline', 'Timeline', 'history']
	] as const;

	const p = $derived(data.patient);
	const tab = $derived.by(() => {
		const t = page.url.searchParams.get('tab');
		return TABS.some((x) => x[0] === t) ? (t as (typeof TABS)[number][0]) : 'overview';
	});
	const stats = $derived(
		computePatientStats(
			{ therapyPlans: data.plans },
			data.sessions.map((s) => ({
				durationMinutes: s.durationMinutes,
				accuracyPct: s.accuracyPct,
				device: { displayCode: s.device.displayCode }
			}))
		)
	);
	const age = $derived(ageFrom(p.dob));

	let sessionId = $state<string | null>(null);
	let assessmentId = $state<string | null>(null);

	$effect(() => {
		crumbDetail.set(p.name);
	});

	let lastMsg: string | undefined;
	$effect(() => {
		const msg = (form as { message?: string } | null)?.message;
		if (msg && msg !== lastMsg) toast(msg);
		lastMsg = msg;
	});

	function setTab(t: string) {
		goto(`?tab=${t}`, { noScroll: true, keepFocus: true });
	}
	const openSession = (id: string) => (sessionId = id);
	const openAssessment = (id: string) => (assessmentId = id);
</script>

<div class="patient-header">
	<div class="ph-top">
		<div class="ph-id">
			<div class="ph-av">{initials(p.name)}</div>
			<div>
				<div class="ph-name">
					{p.name}{#if p.name !== p.displayCode} <span class="mono muted" style="font-size:13px;font-weight:400">{p.displayCode}</span>{/if}
				</div>
				<div class="ph-meta">
					<span>{age != null ? `${age} yrs · ` : ''}{p.gender ?? '—'}</span><span class="sep"></span>
					<span>{p.diagnosis ?? '—'}</span><span class="sep"></span>
					<span>Affected: {p.affectedSide ?? '—'}</span>
				</div>
				{#if data.liveSession}
					<div class="live-pill" role="status" title="A session file arrived in the last few minutes. Other laptops are told this patient is in use.">
						<span class="live-dot"></span>In session now · {data.liveSession.device} · {data.liveSession.secondsAgo < 90 ? 'just now' : `${Math.round(data.liveSession.secondsAgo / 60)} min ago`}
					</div>
				{/if}
			</div>
		</div>
		<div class="ph-actions" role="group" aria-label="Patient actions">
			{#if data.perms.canManage}
				<form method="POST" action="?/setStatus" use:enhance={() => async ({ update }) => update({ reset: false })}>
					<select
						name="status"
						class="filter-select"
						value={p.status}
						aria-label="Patient status"
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						{#each PATIENT_STATUSES as s (s)}<option value={s}>{s}</option>{/each}
					</select>
				</form>
			{:else}
				<Badge text={p.status} />
			{/if}
			{#if data.perms.isOwner}
				<span class="ph-actions-sep" aria-hidden="true"></span>
				<button class="btn btn-secondary btn-sm" onclick={() => setTab('notes')}>
					<Icon name="edit" size={13} /> Add Note
				</button>
				<a class="btn btn-primary btn-sm" href="/assessments/new?patient={p.id}">
					<Icon name="plus" size={13} /> New Assessment
				</a>
			{/if}
		</div>
	</div>
	<div class="ph-facts">
		<div class="ph-fact"><div class="fl">Therapist</div><div class="fv">{p.therapist.name}</div></div>
		<div class="ph-fact"><div class="fl">Current Plan</div><div class="fv">{stats.plan?.name ?? '—'}</div></div>
		<div class="ph-fact">
			<div class="fl">Therapy Day</div>
			<div class="fv">{stats.plan ? `${stats.currentDay} / ${stats.plan.durationDays}` : '—'}</div>
		</div>
		<div class="ph-fact">
			<div class="fl">Overall Progress</div>
			<div class="fv">{stats.plan ? `${stats.completionPct}%` : '—'}</div>
		</div>
		<div class="ph-fact"><div class="fl">Registered</div><div class="fv">{fmtDateShort(p.registrationDate)}</div></div>
	</div>
	<div class="quick-metrics">
		<div class="qm"><div class="fl">Therapy Days Completed</div><div class="fv">{stats.completedDays}</div></div>
		<div class="qm"><div class="fl">Total Therapy Time</div><div class="fv">{fmtHrsFromMin(stats.totalMin)}</div></div>
		<div class="qm"><div class="fl">Sessions Completed</div><div class="fv">{stats.sessionsCount}</div></div>
		<div class="qm"><div class="fl">Devices Used</div><div class="fv">{stats.devicesUsed.length}</div></div>
		<div class="qm"><div class="fl">Plan Adherence</div><div class="fv">{stats.plan ? `${stats.adherence}%` : '—'}</div></div>
	</div>
</div>

<div class="tabs" role="tablist">
	{#each TABS as [id, label, icon] (id)}
		<button class="tab-btn" class:active={tab === id} role="tab" aria-selected={tab === id} onclick={() => setTab(id)}>
			<Icon name={icon} size={14} />{label}
		</button>
	{/each}
</div>

{#if tab === 'overview'}
	<OverviewTab {data} {stats} {openSession} goTab={setTab} />
{:else if tab === 'assessments'}
	<AssessmentsTab {data} {openAssessment} />
{:else if tab === 'plan'}
	<PlanTab {data} {stats} {form} />
{:else if tab === 'sessions'}
	<SessionsTab {data} {openSession} />
{:else if tab === 'devices'}
	<DevicesTab {data} goTab={setTab} />
{:else if tab === 'progress'}
	<ProgressTab {data} />
{:else if tab === 'documents'}
	<DocumentsTab {data} {form} />
{:else if tab === 'notes'}
	<NotesTab {data} {form} />
{:else}
	<TimelineTab {data} />
{/if}

{#if sessionId}<SessionDrawer {sessionId} patientName={p.name} onclose={() => (sessionId = null)} />{/if}
{#if assessmentId}<AssessmentDrawer {data} {assessmentId} onclose={() => (assessmentId = null)} />{/if}

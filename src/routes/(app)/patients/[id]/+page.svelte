<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import SessionDrawer from '$lib/components/SessionDrawer.svelte';
	import { crumbDetail } from '$lib/stores/page';
	import { computePatientStats } from '$lib/patientStats';
	import { PATIENT_STATUSES } from '$lib/constants';
	import { adherenceTone, ageFrom, fmtDateShort, fmtHrsFromMin, initials } from '$lib/utils';
	import { toast } from '$lib/stores/toast';

	import AssessmentsSection from './_components/AssessmentsSection.svelte';
	import PlanSection from './_components/PlanSection.svelte';
	import SessionsSection from './_components/SessionsSection.svelte';
	import DevicesSection from './_components/DevicesSection.svelte';
	import ProgressSection from './_components/ProgressSection.svelte';
	import DocumentsSection from './_components/DocumentsSection.svelte';
	import NotesSection from './_components/NotesSection.svelte';
	import TimelineSection from './_components/TimelineSection.svelte';
	import AssessmentDrawer from './_components/AssessmentDrawer.svelte';
	import RequestDeviceModal from './_components/RequestDeviceModal.svelte';

	let { data, form } = $props();

	// Section ids double as the old `?tab=` values, so existing links (notifications, redirects, AI answers) still land in the right place.
	const SECTIONS = [
		['assessments', 'Assessments'],
		['plan', 'Therapy plan'],
		['sessions', 'Sessions'],
		['devices', 'Devices'],
		['progress', 'Progress'],
		['documents', 'Documents'],
		['notes', 'Notes'],
		['timeline', 'Timeline']
	] as const;
	type SectionId = (typeof SECTIONS)[number][0];

	const p = $derived(data.patient);
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
	const counts = $derived<Partial<Record<SectionId, number>>>({
		assessments: data.assessments.length,
		sessions: data.sessions.length,
		devices: data.assignments.length,
		documents: data.documents.length,
		notes: data.notes.length
	});

	let sessionId = $state<string | null>(null);
	let assessmentId = $state<string | null>(null);
	let showRequest = $state(false);

	let navEl = $state<HTMLElement>();
	let active = $state<SectionId>('assessments');
	let stuck = $state(false);
	let lockUntil = 0; // after a click, ignore scroll-tracking until the smooth scroll has landed

	$effect(() => {
		crumbDetail.set(p.name);
	});

	let lastMsg: string | undefined;
	$effect(() => {
		const msg = (form as { message?: string } | null)?.message;
		if (msg && msg !== lastMsg) toast(msg);
		lastMsg = msg;
	});

	const isSection = (t: string | null): t is SectionId => SECTIONS.some((s) => s[0] === t);

	function goSection(id: SectionId, opts: { updateUrl?: boolean; smooth?: boolean; focus?: string } = {}) {
		const { updateUrl = true, smooth = true, focus } = opts;
		const el = document.getElementById(id);
		if (!el) return;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		active = id;
		lockUntil = Date.now() + 800;
		el.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' });
		if (updateUrl) replaceState(`?tab=${id}`, page.state);
		if (focus) setTimeout(() => document.getElementById(focus)?.focus({ preventScroll: true }), smooth && !reduce ? 450 : 0);
	}

	// Follow the reader: the active nav item is the last section whose top has passed just under the sticky bars.
	let ticking = false;
	function track() {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			ticking = false;
			stuck = !!navEl && navEl.getBoundingClientRect().top <= navEl.offsetHeight + 16;
			if (Date.now() < lockUntil) return;
			const line = 58 + 44 + 24;
			const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
			let current: SectionId = SECTIONS[0][0];
			for (const [id] of SECTIONS) {
				const el = document.getElementById(id);
				if (el && el.getBoundingClientRect().top <= line) current = id;
			}
			active = atBottom ? SECTIONS[SECTIONS.length - 1][0] : current;
		});
	}

	afterNavigate(() => {
		const t = page.url.searchParams.get('tab');
		if (isSection(t)) requestAnimationFrame(() => goSection(t, { updateUrl: false, smooth: false }));
		track();
	});

	const openSession = (id: string) => (sessionId = id);
	const openAssessment = (id: string) => (assessmentId = id);
</script>

<svelte:window onscroll={track} onresize={track} />

<div class="pd">
	<header class="pd-head">
		<div class="pd-id">
			<div class="pd-av" aria-hidden="true">{initials(p.name)}</div>
			<div class="pd-who">
				<h1 class="pd-name">{p.name} <span class="pd-code">{p.displayCode}</span></h1>
				<div class="pd-meta">
					<span>{age != null ? `${age} yrs · ` : ''}{p.gender ?? '—'}</span>
					<span>{p.diagnosis ?? '—'}</span>
					<span>Affected side: {p.affectedSide ?? '—'}</span>
					<span>Therapist <b>{p.therapist.name}</b></span>
					<span>Registered {fmtDateShort(p.registrationDate)}</span>
				</div>
			</div>
			<div class="pd-actions">
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
					<button class="btn btn-secondary btn-sm" onclick={() => goSection('notes', { focus: 'note-text' })}>
						<Icon name="edit" size={13} /> Add note
					</button>
					<a class="btn btn-primary btn-sm" href="/assessments/new?patient={p.id}">
						<Icon name="plus" size={13} /> New assessment
					</a>
				{/if}
			</div>
		</div>

		<dl class="pd-stats">
			<div class="pd-stat">
				<dt>Current plan</dt>
				{#if stats.plan}
					<dd class="pd-plan" title={stats.plan.name}>{stats.plan.name}</dd>
					<div class="pd-day">
						<div
							class="progress-track"
							role="progressbar"
							aria-label="Plan progress"
							aria-valuenow={stats.completionPct}
							aria-valuemin="0"
							aria-valuemax="100"
						>
							<div class="progress-fill" style="width:{Math.min(100, stats.completionPct)}%"></div>
						</div>
						<span>Day {stats.currentDay} of {stats.plan.durationDays} · {stats.completionPct}%</span>
					</div>
				{:else}
					<dd class="pd-plan muted">No active plan</dd>
				{/if}
			</div>
			<div class="pd-stat">
				<dt>Adherence</dt>
				<dd class={stats.plan ? `pd-tone-${adherenceTone(stats.adherence)}` : 'muted'}>{stats.plan ? `${stats.adherence}%` : '—'}</dd>
			</div>
			<div class="pd-stat"><dt>Days completed</dt><dd>{stats.completedDays}</dd></div>
			<div class="pd-stat"><dt>Sessions</dt><dd>{stats.sessionsCount}</dd></div>
			<div class="pd-stat"><dt>Therapy time</dt><dd>{fmtHrsFromMin(stats.totalMin)}</dd></div>
			<div class="pd-stat"><dt>Avg. accuracy</dt><dd>{stats.avgAccuracy}%</dd></div>
			<div class="pd-stat"><dt>Devices used</dt><dd>{stats.devicesUsed.length}</dd></div>
		</dl>
	</header>

	<nav class="pd-nav" class:is-stuck={stuck} bind:this={navEl} aria-label="Patient sections">
		<button class="pd-nav-who" tabindex={stuck ? 0 : -1} onclick={() => scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top of {p.name}'s profile">
			<span class="pd-av" aria-hidden="true">{initials(p.name)}</span>{p.name}
		</button>
		<ul class="pd-nav-list">
			{#each SECTIONS as [id, label] (id)}
				<li>
					<a
						href="?tab={id}"
						aria-current={active === id ? 'true' : undefined}
						onclick={(e) => {
							e.preventDefault();
							goSection(id);
						}}
					>
						{label}{#if counts[id] != null}<span class="pd-nav-n">{counts[id]}</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<AssessmentsSection {data} {openAssessment} />
	<PlanSection {data} {stats} {form} />
	<SessionsSection {data} {openSession} />
	<DevicesSection {data} onrequest={() => (showRequest = true)} />
	<ProgressSection {data} {stats} />
	<DocumentsSection {data} {form} />
	<NotesSection {data} {form} />
	<TimelineSection {data} />
</div>

{#if sessionId}<SessionDrawer {sessionId} patientName={p.name} onclose={() => (sessionId = null)} />{/if}
{#if assessmentId}<AssessmentDrawer {data} {assessmentId} onclose={() => (assessmentId = null)} />{/if}
{#if showRequest}<RequestDeviceModal {data} {form} onclose={() => (showRequest = false)} />{/if}

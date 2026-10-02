<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import { fmtDateShort, fmtHrsFromMin, adherenceTone } from '$lib/utils';
	import type { PageData } from '../$types';
	import type { computePatientStats } from '$lib/patientStats';
	import NewPlanModal from './NewPlanModal.svelte';
	import EditPlanModal from './EditPlanModal.svelte';

	let {
		data,
		stats,
		form
	}: { data: PageData; stats: ReturnType<typeof computePatientStats>; form: unknown } = $props();

	const plan = $derived(stats.plan ? data.plans.find((p) => p.id === stats.plan!.id)! : null);
	let showNew = $state(false);
	let showEdit = $state(false);
	const tone = (n: number) => adherenceTone(n);
	const todayIdx = $derived(stats.currentDay);
</script>

{#if !plan}
	<div class="card">
		<EmptyState icon="target" title="No therapy plan yet." sub="Choose the side to train and the devices to begin device-assisted therapy. You can change them later with Modify Plan." />
		{#if data.perms.isOwner}
			<div style="text-align:center;padding-bottom:24px">
				<button class="btn btn-primary" onclick={() => (showNew = true)}><Icon name="plus" size={14} /> Set Up Plan</button>
			</div>
		{/if}
	</div>
{:else}
	<div class="page-actions" style="justify-content:flex-end;margin-bottom:16px">
		{#if data.perms.canModifyPlan}
			<button class="btn btn-secondary btn-sm" onclick={() => (showEdit = true)}><Icon name="edit" size={13} /> Modify Plan</button>
		{/if}
	</div>

	{#if !data.perms.isOwner}
		<div class="alert alert-info" style="margin-bottom:16px">
			<Icon name="info" size={15} />
			<span>Primary therapist: <b>{data.patient.therapist.name}</b>{data.perms.canModifyPlan ? ' — they are notified when you edit this plan.' : '.'}</span>
		</div>
	{/if}

	<div class="grid grid-4" style="margin-bottom:18px">
		<KpiCard label="Current Day" value="{stats.currentDay} / {plan.durationDays}" icon="calendar" tone="accent" />
		<KpiCard label="Adherence" value="{stats.adherence}%" icon="target" tone={tone(stats.adherence)} />
		<KpiCard label="Total Time" value="{fmtHrsFromMin(stats.actualSum)} / {fmtHrsFromMin(stats.targetSum)}" icon="clock" tone="info" />
		<KpiCard label="Completion" value="{stats.completionPct}%" icon="check" tone="good" />
	</div>

	<div class="card" style="margin-bottom:18px">
		<div class="card-head"><h3>Plan details</h3><Badge text={plan.status} /></div>
		<div class="card-body">
			<div class="form-grid">
				<div class="kv-row"><span class="kl">Side trained</span><span class="kv">{plan.trainingSide ?? '—'}</span></div>
				<div class="kv-row"><span class="kl">Start date</span><span class="kv">{fmtDateShort(plan.startDate)}</span></div>
				<div class="kv-row"><span class="kl">Duration</span><span class="kv">{plan.durationDays} days</span></div>
				<div class="kv-row"><span class="kl">Daily target duration</span><span class="kv">{plan.dailyTargetMinutes} minutes</span></div>
				<div class="kv-row"><span class="kl">Target sessions</span><span class="kv">{plan.targetSessions ?? '—'}</span></div>
				<div class="kv-row"><span class="kl">Devices involved</span><span class="kv">{plan.devices.map((d) => d.name).join(', ')}</span></div>
				<div class="kv-row" style="grid-column:1/-1"><span class="kl">Therapy goals</span><span class="kv">{plan.goals.join('; ') || '—'}</span></div>
				<div class="kv-row" style="grid-column:1/-1"><span class="kl">Notes</span><span class="kv">{plan.notes ?? '—'}</span></div>
			</div>
		</div>
	</div>

	<div class="card" style="margin-bottom:18px">
		<div class="card-head"><h3>Daily timeline</h3><span class="hint">Day {stats.currentDay} of {plan.durationDays}</span></div>
		<div class="card-body">
			<div class="day-strip">
				{#each plan.dayLog as d (d.dayNumber)}
					<div class="day-chip" title="Day {d.dayNumber} — {d.status} — {d.actualMinutes}min / {d.targetMinutes}min">
						<div class="dc-mark {d.status}" class:today={d.dayNumber === todayIdx && d.status !== 'upcoming'}>
							{#if d.status === 'done'}<Icon name="check" size={13} />
							{:else if d.status === 'missed'}<Icon name="x" size={13} />{/if}
						</div>
						<div class="dc-num">{d.dayNumber}</div>
					</div>
				{/each}
			</div>
			<div class="legend-row" style="margin-top:6px">
				<div class="legend-item"><span class="sw" style="background:var(--good)"></span>Completed</div>
				<div class="legend-item"><span class="sw" style="background:var(--critical)"></span>Missed</div>
				<div class="legend-item"><span class="sw" style="background:var(--border-strong)"></span>Upcoming</div>
			</div>
		</div>
	</div>

	<div class="section-title-row"><h2>Plan history</h2></div>
	<div class="card">
		{#if plan.revisions.length}
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Field</th><th>Previous</th><th>New</th><th>Modified By</th><th>Date</th><th>Reason</th></tr></thead>
					<tbody>
						{#each plan.revisions as r (r.id)}
							<tr>
								<td>{r.field}</td>
								<td class="mono">{r.previous ?? '—'}</td>
								<td class="mono">{r.next ?? '—'}</td>
								<td>{r.by} <span class="pill">{r.role.toLowerCase()}</span></td>
								<td class="mono">{fmtDateShort(r.at)}</td>
								<td class="muted">{r.reason ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<EmptyState icon="history" title="No modifications recorded" sub="This plan has not been changed since it was created." />
		{/if}
	</div>
{/if}

{#if showNew}<NewPlanModal {data} {form} onclose={() => (showNew = false)} />{/if}
{#if showEdit && plan}<EditPlanModal {plan} {data} {form} onclose={() => (showEdit = false)} />{/if}

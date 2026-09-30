<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Section from './Section.svelte';
	import { fmtDateShort, fmtHrsFromMin } from '$lib/utils';
	import { activitySeries } from './series';
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
	const activity = $derived(stats.plan ? activitySeries(stats.plan.dayLog) : null);
	let showNew = $state(false);
	let showEdit = $state(false);
	const todayIdx = $derived(stats.currentDay);
</script>

<Section id="plan" title="Therapy plan">
	{#snippet actions()}
		{#if plan}<Badge text={plan.status} />{/if}
		{#if plan && data.perms.canModifyPlan}
			<button class="btn btn-secondary btn-sm" onclick={() => (showEdit = true)}><Icon name="edit" size={13} /> Modify plan</button>
		{/if}
		{#if data.perms.isOwner}
			<button class="btn {plan ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick={() => (showNew = true)}>
				<Icon name="plus" size={13} /> {plan ? 'New plan' : 'Create plan'}
			</button>
		{/if}
	{/snippet}

	{#if !plan}
		<div class="card">
			<EmptyState icon="target" title="No therapy plan has been created." sub="Create a plan to begin structured, device-assisted therapy." />
		</div>
	{:else}
		{#if !data.perms.isOwner}
			<div class="alert alert-info" style="margin-bottom:12px">
				<Icon name="info" size={15} />
				<span>Primary therapist: <b>{data.patient.therapist.name}</b>{data.perms.canModifyPlan ? ' — they are notified when you edit this plan.' : '.'}</span>
			</div>
		{/if}

		<div class="pd-cols">
			<div class="card s5">
				<div class="card-head"><h3>{plan.name}</h3></div>
				<div class="card-body">
					<div class="pd-facts">
						<div class="kv-row"><span class="kl">Start date</span><span class="kv">{fmtDateShort(plan.startDate)}</span></div>
						<div class="kv-row"><span class="kl">Duration</span><span class="kv">{plan.durationDays} days</span></div>
						<div class="kv-row"><span class="kl">Daily target</span><span class="kv">{plan.dailyTargetMinutes} min</span></div>
						<div class="kv-row"><span class="kl">Target sessions</span><span class="kv">{plan.targetSessions ?? '—'}</span></div>
						<div class="kv-row"><span class="kl">Time logged</span><span class="kv">{fmtHrsFromMin(stats.actualSum)} of {fmtHrsFromMin(stats.targetSum)}</span></div>
						<div class="kv-row"><span class="kl">Completion</span><span class="kv">{stats.completionPct}%</span></div>
						<div class="kv-row wide"><span class="kl">Devices</span><span class="kv">{plan.devices.map((d) => d.name).join(', ') || '—'}</span></div>
						<div class="kv-row wide"><span class="kl">Goals</span><span class="kv">{plan.goals.join('; ') || '—'}</span></div>
						{#if plan.notes}<div class="kv-row wide"><span class="kl">Notes</span><span class="kv">{plan.notes}</span></div>{/if}
					</div>
				</div>
			</div>

			<div class="card s7">
				<div class="card-head">
					<h3>Daily minutes</h3>
					<span class="hint">Day {stats.currentDay} of {plan.durationDays} · target {plan.dailyTargetMinutes} min</span>
				</div>
				<div class="card-body">
					{#if activity && activity.labels.length}
						<Chart kind="bar" labels={activity.labels} datasets={[{ label: 'Actual minutes', data: activity.actual, color: 'var(--accent)' }]} height={120} />
					{/if}
					<div class="day-strip" style="margin-top:6px">
						{#each plan.dayLog as d (d.dayNumber)}
							<div class="day-chip" title="Day {d.dayNumber} — {d.status} — {d.actualMinutes}min / {d.targetMinutes}min">
								<div class="dc-mark {d.status}" class:today={d.dayNumber === todayIdx && d.status !== 'upcoming'}>
									{#if d.status === 'done'}<Icon name="check" size={13} />
									{:else if d.status === 'partial'}<Icon name="minus" size={13} />
									{:else if d.status === 'missed'}<Icon name="x" size={13} />{/if}
								</div>
								<div class="dc-num">{d.dayNumber}</div>
							</div>
						{/each}
					</div>
					<div class="legend-row">
						<div class="legend-item"><span class="sw" style="background:var(--good)"></span>Completed</div>
						<div class="legend-item"><span class="sw" style="background:var(--warning)"></span>Partial</div>
						<div class="legend-item"><span class="sw" style="background:var(--critical)"></span>Missed</div>
						<div class="legend-item"><span class="sw" style="background:var(--border-strong)"></span>Upcoming</div>
					</div>
				</div>
			</div>
		</div>

		<details class="pd-fold">
			<summary>Plan history · {plan.revisions.length} change{plan.revisions.length === 1 ? '' : 's'}</summary>
			<div class="card">
				{#if plan.revisions.length}
					<div class="table-wrap">
						<table class="dt">
							<thead><tr><th>Field</th><th>Previous</th><th>New</th><th>Modified by</th><th>Date</th><th>Reason</th></tr></thead>
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
		</details>
	{/if}
</Section>

{#if showNew}<NewPlanModal {data} {form} onclose={() => (showNew = false)} />{/if}
{#if showEdit && plan}<EditPlanModal {plan} {form} onclose={() => (showEdit = false)} />{/if}

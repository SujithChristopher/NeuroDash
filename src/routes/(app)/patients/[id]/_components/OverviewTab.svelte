<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateShort } from '$lib/utils';
	import AttendanceCard from './AttendanceCard.svelte';
	import ScaleTrends from './ScaleTrends.svelte';
	import { avgIntervalDays, sessionDays } from './series';
	import type { PageData } from '../$types';
	import type { computePatientStats } from '$lib/patientStats';

	let {
		data,
		stats,
		goTab
	}: {
		data: PageData;
		stats: ReturnType<typeof computePatientStats>;
		goTab: (t: string) => void;
	} = $props();

	// One point per day trained (Day 1, Day 2 ... in order, however far apart), all devices together.
	const days = $derived(sessionDays(data.sessions));
	const interval = $derived(avgIntervalDays(days));
	const tip = (i: number) => {
		const d = days[i];
		return [
			`${d.minutes} min on ${fmtDateShort(d.date)}${d.sessions > 1 ? ` (${d.sessions} sessions)` : ''}`,
			...d.byDevice.map((x) => `${x.name}: ${x.minutes} min`),
			...(d.accuracy == null ? [] : [`Accuracy: ${d.accuracy}%`]),
			...(i > 0 ? [`${Math.round((Date.parse(d.date) - Date.parse(days[i - 1].date)) / 86400_000)} day(s) after Day ${i}`] : [])
		];
	};
</script>

<div class="two-col">
	<div>
		<div class="card" style="margin-bottom:16px">
			<div class="card-head">
				<h3>Assessment score trend</h3>
				<span class="hint">Choose a scale</span>
			</div>
			<div class="card-body">
				<ScaleTrends assessments={data.assessments} />
			</div>
		</div>
		<div class="card">
			<div class="card-head">
				<h3>Therapy time per day</h3>
				<span class="hint">{#if interval != null}Avg interval between sessions: <b>{interval} day{interval === 1 ? '' : 's'}</b>{:else}{stats.plan ? `Target ${stats.plan.dailyTargetMinutes} min/day` : 'all devices'}{/if}</span>
			</div>
			<div class="card-body">
				{#if days.length}
					<Chart kind="area" labels={days.map((d) => String(d.n))} datasets={[{ label: 'Therapy time (min)', data: days.map((d) => d.minutes), color: 'var(--accent)' }]} opts={{ tooltipLines: tip, maxTicksX: 15, xTitle: 'Session', yTitle: 'Minutes', lively: true, animationMs: 1600 }} height={230} />
				{:else}
					<EmptyState icon="activity" title="No therapy sessions yet" sub="Sessions appear here as the training devices upload them." />
				{/if}
			</div>
		</div>
	</div>
	<div>
		<div class="card" style="margin-bottom:16px">
			<div class="card-head"><h3>Plan snapshot</h3></div>
			<div class="card-body">
				{#if stats.plan}
					{@const plan = data.plans.find((x) => x.id === stats.plan!.id)!}
					<div class="kv-list">
						<div class="kv-row"><span class="kl">Plan</span><span class="kv">{plan.name}</span></div>
						<div class="kv-row"><span class="kl">Duration</span><span class="kv">{plan.durationDays} days</span></div>
						<div class="kv-row"><span class="kl">Daily target</span><span class="kv">{plan.dailyTargetMinutes} min</span></div>
						<div class="kv-row"><span class="kl">Devices</span><span class="kv">{plan.devices.map((d) => d.name).join(', ')}</span></div>
					</div>
					<hr class="sep" />
					<div class="kv-row" style="margin-bottom:6px"><span class="kl">Adherence</span><span class="kv">{stats.adherence}%</span></div>
					<div class="progress-track">
						<div
							class="progress-fill {stats.adherence >= 85 ? 'good' : stats.adherence >= 65 ? 'warning' : 'critical'}"
							style="width:{Math.min(100, stats.adherence)}%"
						></div>
					</div>
					<button class="btn btn-secondary btn-sm btn-block" style="margin-top:14px" onclick={() => goTab('plan')}>View full plan</button>
				{:else}
					<EmptyState icon="target" title="No therapy plan created yet" />
					{#if data.perms.isOwner}
						<button class="btn btn-primary btn-block btn-sm" onclick={() => goTab('plan')}>
							<Icon name="plus" size={13} /> Create Plan
						</button>
					{/if}
				{/if}
			</div>
		</div>
		{#if stats.plan}
			<AttendanceCard dayLog={data.plans.find((x) => x.id === stats.plan!.id)!.dayLog} />
		{/if}
	</div>
</div>

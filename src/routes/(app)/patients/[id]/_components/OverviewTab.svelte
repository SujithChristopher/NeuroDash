<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtDateShort, fmtMin } from '$lib/utils';
	import ScaleTrends from './ScaleTrends.svelte';
	import { devicesOf, durationByDay } from './series';
	import type { PageData } from '../$types';
	import type { computePatientStats } from '$lib/patientStats';

	let {
		data,
		stats,
		openSession,
		goTab
	}: {
		data: PageData;
		stats: ReturnType<typeof computePatientStats>;
		openSession: (id: string) => void;
		goTab: (t: string) => void;
	} = $props();

	// Minutes per day, stacked by training device (last 30 days with data).
	const devices = $derived(devicesOf(data.sessions));
	const activity = $derived(durationByDay(data.sessions, devices, 30));
	const recent = $derived(data.sessions.slice(0, 4));
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
				<span class="hint">{stats.plan ? `Target ${stats.plan.dailyTargetMinutes} min/day · ` : ''}stacked by device</span>
			</div>
			<div class="card-body">
				{#if activity.days.length}
					<Chart kind="bar" labels={activity.labels} datasets={activity.datasets} opts={{ stacked: true, legend: devices.length > 1, valueSuffix: ' min', thick: 22 }} height={200} />
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
		<div class="card">
			<div class="card-head"><h3>Recent sessions</h3></div>
			<div class="card-body" style="padding-top:6px">
				{#each recent as s (s.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="kv-row" style="margin-bottom:10px;cursor:pointer" onclick={() => openSession(s.id)}>
						<span class="kl">{fmtDateShort(s.date)} · {s.device.displayCode}</span>
						<span class="kv">{fmtMin(s.durationMinutes ?? 0)}</span>
					</div>
				{:else}
					<EmptyState icon="activity" title="No sessions yet" />
				{/each}
			</div>
		</div>
	</div>
</div>

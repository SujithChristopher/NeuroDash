<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgramPanel from '$lib/components/ProgramPanel.svelte';
	import SessionDrawer from '$lib/components/SessionDrawer.svelte';
	import { goto } from '$app/navigation';
	import { fmtDate } from '$lib/utils';

	let { data } = $props();
	let open = $state<string | null>(null);
	const STATUS_LABEL = { done: 'Done', in_progress: 'In progress', waiting: 'Not started' } as const;

	const first = $derived(data.user.name.replace(/^(dr|mr|ms|mrs|prof)\.?\s+/i, '').split(' ')[0]);
</script>

<PageHead title="Good to see you, {first}" sub="Today, {fmtDate(new Date())} — your schedule, to-do list and program overview.">
	{#snippet actions()}
		{#if data.user.role === 'THERAPIST'}
			<a class="btn btn-primary" href="/patients/new"><Icon name="plus" size={15} /> New Patient</a>
		{/if}
	{/snippet}
</PageHead>

<div class="two-col" style="margin-bottom:8px">
	<div class="card">
		<div class="card-head">
			<h3>Sessions today</h3>
			<span class="hint">{data.schedule.filter((r) => r.status === 'done').length} of {data.schedule.length} done</span>
		</div>
		<div class="card-body" style="padding:0">
			{#each data.schedule as r (r.patientId)}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="sched-row" class:now={r.status === 'in_progress'} onclick={() => (r.sessionId ? (open = r.sessionId) : goto(`/patients/${r.patientId}`))}>
					<div class="sched-main">
						<div class="sched-name">{r.code}</div>
						<div class="sched-sub">{r.devices.join(' + ') || 'No device'} · {r.plannedMinutes} min planned</div>
					</div>
					{#if r.status === 'done' && r.minutes != null}
						<div class="sched-result">{r.minutes} min{#if r.accuracy != null} <span class="muted">· {r.accuracy}% accuracy</span>{/if}</div>
					{/if}
					<span class="pill-status {r.status}"><span class="dot"></span>{STATUS_LABEL[r.status]}</span>
				</div>
			{:else}
				<EmptyState icon="calendar" title="Nobody is due to train today" sub="Patients with an active therapy plan appear here, with their status as sessions happen." />
			{/each}
		</div>
	</div>
	<div class="card">
		<div class="card-head"><h3>To do</h3><span class="hint">{data.todos.length}</span></div>
		<div class="card-body" style="padding:0">
			{#each data.todos as t (t.key)}
				<div class="todo-row">
					<a class="todo-link" href={t.href}>
						<div class="notif-ic" style="background:var(--{t.tone}-soft, var(--surface-3));color:var(--{t.tone}, var(--ink-700))"><Icon name={t.icon} size={15} /></div>
						<div class="todo-text"><div class="notif-title">{t.title}</div><div class="notif-desc">{t.sub}</div></div>
					</a>
					{#if t.action}<a class="btn btn-secondary btn-sm" href={t.action.href}>{t.action.label}</a>{/if}
				</div>
			{:else}
				<EmptyState icon="check" title="You’re all caught up" sub="Patients who still need a plan or an assessment show up here." />
			{/each}
		</div>
	</div>
</div>

<div class="section-title-row"><h2>Program overview</h2></div>
<ProgramPanel program={data.program} inflow={data.inflow} range={data.range} />

{#if open}<SessionDrawer sessionId={open} onclose={() => (open = null)} />{/if}

<style>
	.sched-row {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 20px;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
	}
	.sched-row:last-child {
		border-bottom: none;
	}
	.sched-row:hover {
		background: var(--surface-2);
	}
	.sched-row.now {
		background: var(--accent-soft);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.sched-main {
		flex: 1;
		min-width: 0;
	}
	.sched-name {
		font-weight: 700;
		font-size: 14.5px;
	}
	.sched-sub {
		font-size: 12.5px;
		color: var(--ink-500);
		margin-top: 2px;
	}
	.sched-result {
		font-size: 13px;
		white-space: nowrap;
	}
	.pill-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 11px;
		font-size: 12.5px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		white-space: nowrap;
	}
	.pill-status .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink-400);
	}
	.pill-status.done .dot {
		background: var(--good);
	}
	.pill-status.in_progress .dot {
		background: var(--accent);
		animation: live-pulse 1.6s ease-out infinite;
	}
	.todo-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--border);
	}
	.todo-row:last-child {
		border-bottom: none;
	}
	.todo-link {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
		min-width: 0;
		text-decoration: none;
		color: inherit;
	}
	.todo-text {
		min-width: 0;
	}
	@media (max-width: 640px) {
		.sched-row {
			flex-wrap: wrap;
			gap: 8px 12px;
			padding: 12px 14px;
		}
		.sched-result {
			order: 3;
			flex-basis: 100%;
		}
	}
</style>

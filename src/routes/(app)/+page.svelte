<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgramPanel from '$lib/components/ProgramPanel.svelte';
	import SessionDrawer from '$lib/components/SessionDrawer.svelte';
	import { fmtDate, fmtMin, fmtTime } from '$lib/utils';

	let { data } = $props();
	let open = $state<string | null>(null);

	const first = $derived(data.user.name.replace(/^(dr|mr|ms|mrs|prof)\.?\s+/i, '').split(' ')[0]);
</script>

<PageHead title="Good to see you, {first}" sub="Today, {fmtDate(new Date())} — your schedule, to-do list and program overview.">
	{#snippet actions()}
		{#if data.user.role === 'THERAPIST'}
			<a class="btn btn-secondary" href="/device-requests"><Icon name="device" size={15} /> Device Requests</a>
			<a class="btn btn-primary" href="/patients/new"><Icon name="plus" size={15} /> New Patient</a>
		{/if}
	{/snippet}
</PageHead>

<div class="two-col" style="margin-bottom:8px">
	<div class="card">
		<div class="card-head"><h3>Today’s schedule</h3><span class="hint">{data.today.length} session{data.today.length === 1 ? '' : 's'} logged</span></div>
		<div class="card-body" style="padding-top:6px">
			{#each data.today as s (s.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="notif-item" style="padding:10px 0;cursor:pointer" onclick={() => (open = s.id)}>
					<div class="notif-ic" style="background:var(--good-soft);color:var(--good)"><Icon name="activity" size={15} /></div>
					<div style="flex:1">
						<div class="notif-title">{s.patient.name} <span class="mono muted" style="font-weight:400">{s.patient.displayCode}</span></div>
						<div class="notif-desc">{fmtTime(s.startTime)} · {s.deviceCode} · {fmtMin(s.durationMinutes ?? 0)}</div>
					</div>
				</div>
			{:else}
				<EmptyState icon="calendar" title="No sessions logged today" sub="Sessions appear here as device data arrives." />
			{/each}
		</div>
	</div>
	<div class="card">
		<div class="card-head"><h3>To-do</h3><span class="hint">{data.todos.length} open</span></div>
		<div class="card-body" style="padding-top:6px">
			{#each data.todos as t (t.key)}
				<a class="notif-item" href={t.href} style="padding:10px 0;text-decoration:none;color:inherit">
					<div class="notif-ic" style="background:var(--{t.tone}-soft, var(--surface-3));color:var(--{t.tone}, var(--ink-700))"><Icon name={t.icon} size={15} /></div>
					<div style="flex:1"><div class="notif-title">{t.title}</div><div class="notif-desc">{t.sub}</div></div>
				</a>
			{:else}
				<EmptyState icon="check" title="You’re all caught up" sub="Pending assessments and actionable alerts show up here." />
			{/each}
		</div>
	</div>
</div>

<div class="section-title-row"><h2>Program overview</h2></div>
<ProgramPanel program={data.program} inflow={data.inflow} range={data.range} />

{#if open}<SessionDrawer sessionId={open} onclose={() => (open = null)} />{/if}

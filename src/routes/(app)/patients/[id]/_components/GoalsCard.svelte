<script lang="ts">
	// The plan's goals: the overall goal in words, and each device goal as a bar from the starting value (the patient's range
	// when the goal was set) to the target. Every robotic assessment during the therapy moves the bar; when the therapy ends
	// it becomes the final result. Always the same device, limb, mechanism and task.
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { formatValue, goalProgress, type GoalState } from '$lib/planGoals';
	import { ROBOTIC_NAMES, TASK_NAMES } from '$lib/roboticAssessment';
	import { fmtDate, type Tone } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, plan, canEdit, onedit }: { data: PageData; plan: PageData['plans'][number]; canEdit: boolean; onedit: () => void } = $props();

	// The therapy has ended when its plan is completed or discontinued: only then is a goal's result final
	const ended = $derived(plan.status === 'Completed' || plan.status === 'Discontinued');
	const deviceName = (id: string) => data.allDeviceTypes.find((d) => d.id === id)?.name ?? id;

	const rows = $derived(plan.deviceGoals.map((g) => ({ g, p: goalProgress(g, data.roboticAssessments) })));

	const LABEL: Record<GoalState, { text: string; tone: Tone }> = {
		achieved: { text: 'Achieved', tone: 'good' },
		progressing: { text: 'In progress', tone: 'info' },
		declined: { text: 'Below the starting value', tone: 'critical' },
		'not-measured': { text: 'Waiting for the next assessment', tone: 'neutral' },
		'no-data': { text: 'Not assessed yet', tone: 'neutral' }
	};
	const badge = (state: GoalState): { text: string; tone: Tone } => (ended ? (state === 'achieved' ? { text: 'Final: achieved', tone: 'good' } : { text: state === 'not-measured' || state === 'no-data' ? 'Final: not measured' : 'Final: not achieved', tone: state === 'declined' ? 'critical' : 'warning' }) : LABEL[state]);
	const fill = (state: GoalState) => (state === 'achieved' ? 'good' : state === 'declined' ? 'critical' : 'warning');
</script>

<div class="card" style="margin-bottom:18px">
	<div class="card-head">
		<div><h3>Goals</h3><div class="hint">{ended ? 'The therapy has ended: these are the final results' : 'They run until the therapy ends; each robotic assessment shows how far along they are'}</div></div>
		{#if canEdit}<button class="btn btn-secondary btn-sm" onclick={onedit}>Edit goals</button>{/if}
	</div>
	<div class="card-body">
		<div class="overall">
			<div class="k-label">Overall goal</div>
			<div class="overall-text">{plan.goals.join('; ') || '—'}</div>
		</div>

		{#if !rows.length}
			<EmptyState icon="target" title="No device goals set" sub={canEdit ? 'Edit the goals to set a target for a PLUTO or MARS mechanism, measured from the robotic assessment.' : 'The primary therapist can set a target for a PLUTO or MARS mechanism.'} />
		{:else}
			<ul class="goals">
				{#each rows as { g, p } (g.id)}
					{@const b = badge(p.state)}
					<li>
						<div class="top">
							<div>
								<div class="name">{deviceName(g.deviceTypeId)} · {ROBOTIC_NAMES[g.mechanism] ?? g.mechanism}</div>
								<div class="sub">{g.task === 'ROM' ? 'Reach range' : (TASK_NAMES[g.task] ?? g.task)}{g.limb ? ` · ${g.limb} limb` : ''}</div>
							</div>
							<Badge text={b.text} tone={b.tone} />
						</div>

						{#if p.baseline}
							<div class="figures">
								<span>Start <b>{formatValue(p.baseline.value, g.unit)}</b> <span class="muted">{p.baseline.timepoint}</span></span>
								<span class="arrow">→</span>
								<span>{#if p.latest}Latest <b>{formatValue(p.latest.value, g.unit)}</b> <span class="muted">{p.latest.timepoint}{p.latest.date ? `, ${fmtDate(p.latest.date)}` : ''}</span>{:else}<span class="muted">not measured since</span>{/if}</span>
								<span class="arrow">→</span>
								<span>Target <b>{formatValue(g.targetValue, g.unit)}</b></span>
							</div>
							<div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={p.percent ?? 0} aria-label="Progress to the target">
								<div class="progress-fill {fill(p.state)}" style="width:{p.percent ?? 0}%"></div>
							</div>
							<div class="foot">
								<span>{#if p.change != null}<b style="color:{p.change >= 0 ? 'var(--good)' : 'var(--critical)'}">{p.change > 0 ? '+' : ''}{formatValue(p.change, g.unit)}</b> since the start · {p.percent}% of the way{:else}{p.percent}% of the way{/if}</span>
								{#if p.points.length > 1}
									<span class="dots">{#each p.points as m (m.timepoint)}<span class="dot">{m.timepoint} <b>{formatValue(m.value, g.unit)}</b></span>{/each}</span>
								{/if}
							</div>
						{:else}
							<div class="figures"><span class="muted">Target <b style="color:var(--ink-900)">{formatValue(g.targetValue, g.unit)}</b>. There is no assessment of this yet: the first one becomes the starting value.</span></div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.overall {
		margin-bottom: 16px;
	}
	.overall-text {
		margin-top: 2px;
		font-size: 14px;
		color: var(--ink-900);
	}
	.goals {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 14px;
	}
	.goals li {
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-m, 10px);
		background: var(--surface);
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 10px;
	}
	.name {
		font-weight: 600;
		color: var(--ink-900);
	}
	.sub {
		font-size: 12px;
		color: var(--ink-500);
		text-transform: capitalize;
	}
	.figures {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		margin-bottom: 8px;
		font-size: 13px;
	}
	.figures b {
		font-size: 15px;
	}
	.arrow {
		color: var(--ink-400);
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 6px 14px;
		margin-top: 8px;
		font-size: 12.5px;
		color: var(--ink-500);
	}
	.dots {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	.dot b {
		color: var(--ink-900);
	}
</style>

<script lang="ts">
	// The goals part of the plan form: one overall goal, and for each device of the plan (PLUTO, MARS) a target range typed as a
	// number. The patient's current value comes from their latest robotic assessment of that mechanism and task, so the
	// therapist sees what the target is measured from. The rows are sent as one hidden JSON field.
	import Icon from '$lib/components/Icon.svelte';
	import { GOAL_OPTIONS, formatValue, goalUnit, latestMeasured, limbOf, type GoalDraftForm as Draft } from '$lib/planGoals';
	import { ROBOTIC_NAMES, TASK_NAMES } from '$lib/roboticAssessment';
	import type { PageData } from '../$types';

	let {
		data,
		devices,
		side,
		drafts = $bindable(),
		overall = '',
		overallName = 'goals'
	}: { data: PageData; devices: string[]; side: string; drafts: Draft[]; overall?: string; overallName?: string } = $props();

	const limb = $derived(limbOf(side, data.patient.affectedSide));
	const goalDevices = $derived(devices.filter((d) => GOAL_OPTIONS[d]));
	const names = (id: string) => data.allDeviceTypes.find((d) => d.id === id)?.name ?? id;

	const now = (d: Draft) => latestMeasured(data.roboticAssessments, { device: d.deviceTypeId, limb, mechanism: d.mechanism, task: d.task });
	const unitOf = (d: Draft) => goalUnit(d.deviceTypeId, d.mechanism);

	function add(device: string) {
		const o = GOAL_OPTIONS[device];
		drafts = [...drafts, { deviceTypeId: device, mechanism: o.mechanisms[0], task: o.tasks[0], target: '' }];
	}
	const remove = (d: Draft) => (drafts = drafts.filter((x) => x !== d));

	// only the goals of devices still in the plan, with a number typed
	const json = $derived(
		JSON.stringify(
			drafts
				.filter((d) => devices.includes(d.deviceTypeId) && d.target.trim() !== '')
				.map((d) => ({ deviceTypeId: d.deviceTypeId, mechanism: d.mechanism, task: d.task, target: Number(d.target) }))
		)
	);
</script>

<div class="field full">
	<label for="goal-overall">Overall goal</label>
	<textarea id="goal-overall" name={overallName} rows="2" maxlength="600" placeholder="e.g. Improve functional grasp for self-feeding">{overall}</textarea>
	<div class="field-hint">The aim of the whole therapy. It ends when the therapy ends.</div>
</div>

<div class="field full">
	<span class="lbl">Device goals</span>
	<input type="hidden" name="deviceGoals" value={json} />
	{#if !devices.length}
		<div class="field-hint">Choose the devices first.</div>
	{:else if !goalDevices.length}
		<div class="field-hint">Device goals are for PLUTO and MARS, the devices that measure range in a robotic assessment.</div>
	{/if}

	{#each goalDevices as device (device)}
		{@const mine = drafts.filter((d) => d.deviceTypeId === device)}
		<div class="dev">
			<div class="dev-head">
				<b>{names(device)}</b>
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => add(device)}><Icon name="plus" size={13} /> Add goal</button>
			</div>
			{#each mine as d (d)}
				{@const m = now(d)}
				<div class="row">
					<select aria-label="Mechanism" bind:value={d.mechanism}>
						{#each GOAL_OPTIONS[device].mechanisms as mech (mech)}<option value={mech}>{ROBOTIC_NAMES[mech] ?? mech}</option>{/each}
					</select>
					{#if GOAL_OPTIONS[device].tasks.length > 1}
						<select aria-label="Task" bind:value={d.task}>
							{#each GOAL_OPTIONS[device].tasks as t (t)}<option value={t}>{TASK_NAMES[t] ?? t}</option>{/each}
						</select>
					{/if}
					<div class="now">
						{#if m}Now <b>{formatValue(m.value, unitOf(d))}</b> <span class="muted">({m.timepoint}, {m.limb})</span>{:else}<span class="muted">Not assessed yet: the first assessment becomes the starting point</span>{/if}
					</div>
					<div class="end">
						<label class="target">
							Target
							<input type="number" inputmode="decimal" step="any" min="0" placeholder={m ? String(Math.ceil(m.value * 1.2)) : ''} bind:value={d.target} />
							<span class="muted">{unitOf(d) === 'deg' ? '°' : (unitOf(d) ?? '')}</span>
						</label>
						<button type="button" class="btn btn-ghost btn-sm" aria-label="Remove this goal" onclick={() => remove(d)}><Icon name="x" size={13} /></button>
					</div>
				</div>
			{:else}
				<div class="field-hint" style="margin:6px 0 0">No goal for {names(device)} yet. Add one to track its range through the therapy.</div>
			{/each}
		</div>
	{/each}
	<div class="field-hint">
		The target is the range to reach by the end of the therapy. Each later robotic assessment shows how far along it is, always compared with the same device, limb, mechanism and task.
	</div>
</div>

<style>
	.lbl {
		display: block;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-700);
		margin-bottom: 6px;
	}
	.dev {
		border: 1px solid var(--border);
		border-radius: var(--radius-m, 10px);
		padding: 10px 12px;
		margin-bottom: 10px;
		background: var(--surface);
	}
	.dev-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 8px 0;
		border-top: 1px dashed var(--border);
	}
	.row select {
		flex: 1 1 220px;
		width: auto;
		min-width: 0;
	}
	.now {
		flex: 1 1 180px;
		font-size: 12.5px;
	}
	.end {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-700);
	}
	.target input {
		width: 92px;
	}
</style>

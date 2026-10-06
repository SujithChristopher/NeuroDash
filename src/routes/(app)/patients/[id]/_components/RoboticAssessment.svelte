<script lang="ts">
	// Robotic assessment: the therapist chooses the devices the patient is assessed on. They are written to patients.json
	// as "assessment_devices", so the patient is offered on exactly those devices.
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toastEnhance } from '$lib/enhance';
	import { fmtDateShort } from '$lib/utils';
	import { byTimepoint, usable } from '$lib/roboticAssessment';
	import RoboticAssessmentDrawer from './RoboticAssessmentDrawer.svelte';
	import RoboticTrend from './RoboticTrend.svelte';
	import type { PageData } from '../$types';

	let { data }: { data: PageData } = $props();

	const saved = $derived(data.assessmentDevices.map((d) => d.deviceTypeId));
	let selected = $state<string[]>(untrack(() => data.assessmentDevices.map((d) => d.deviceTypeId)));
	const dirty = $derived(selected.length !== saved.length || selected.some((id) => !saved.includes(id)));
	// What the devices measured: newest timepoint first
	const results = $derived([...byTimepoint(data.roboticAssessments)].reverse());
	let openId = $state<string | null>(null);

	const toggle = (id: string) => (selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
</script>

{#if results.length}
	<div class="card" style="margin-bottom:18px">
		<div class="card-head">
			<h3>Robotic assessments</h3>
			<span class="hint">{results.length} timepoint{results.length === 1 ? '' : 's'} · open one for the detail</span>
		</div>
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Timepoint</th><th>Device</th><th>Date</th><th>Can use</th><th></th></tr></thead>
				<tbody>
					{#each results as a (a.id)}
						{@const can = usable(a)}
						<tr class="clickable" onclick={() => (openId = a.id)}>
							<td><Badge text={a.timepoint} tone="accent" /><div class="dt-sub" style="text-transform:capitalize">{a.limb} limb</div></td>
							<td>{a.device}</td>
							<td class="mono">{fmtDateShort(a.assessedAt)}</td>
							<td>
								<span class="chips-inline">
									{#each can.active as m (m)}<Badge text={m} tone="good" />{/each}
									{#each can.passive as m (m)}<Badge text={a.device === 'PLUTO' ? `${m} · passive` : m} tone="info" />{/each}
									{#if !can.active.length && !can.passive.length}<span class="muted">—</span>{/if}
								</span>
							</td>
							<td class="row-chevron"><Icon name="chevron" size={14} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div class="card" style="margin-bottom:18px">
		<div class="card-head"><h3>Change over time</h3><span class="hint">needs two timepoints</span></div>
		<div class="card-body"><RoboticTrend list={data.roboticAssessments} /></div>
	</div>
{/if}

<div class="card" style="margin-bottom:18px">
	<div class="card-head">
		<h3>Robotic assessment devices</h3>
		<span class="hint">{saved.length ? `${saved.length} selected` : 'none yet'}</span>
	</div>
	<div class="card-body">
		{#if data.perms.isOwner}
			<form method="POST" action="?/setRoboticDevices" use:enhance={toastEnhance()}>
				<p class="muted" style="font-size:13px;margin:0 0 12px">
					Choose the devices this patient is assessed on. The patient then appears on those devices only (as soon as one device is training them, the others no longer offer them). A therapy plan can be created once an assessment is done.
				</p>
				<div style="display:flex;gap:8px;flex-wrap:wrap">
					{#each data.allDeviceTypes as d (d.id)}
						<label class="demo-acct" class:active={selected.includes(d.id)} style="cursor:pointer;display:block">
							<input type="checkbox" name="deviceTypeIds" value={d.id} checked={selected.includes(d.id)} onchange={() => toggle(d.id)} style="width:auto;margin-right:6px" />
							<span class="da-name" style="display:inline">{d.name}</span>
						</label>
					{/each}
				</div>
				<div style="margin-top:14px">
					<button class="btn btn-primary btn-sm" type="submit" disabled={!dirty}><Icon name="check" size={13} /> Save devices</button>
				</div>
			</form>
		{:else if saved.length}
			<div style="display:flex;gap:6px;flex-wrap:wrap">{#each data.assessmentDevices as d (d.deviceTypeId)}<Badge text={d.name} tone="info" />{/each}</div>
		{:else}
			<EmptyState icon="clipboard" title="No robotic assessment set up" sub="The primary therapist chooses the devices for it." />
		{/if}
	</div>
</div>

{#if !results.length}
	<div class="card">
		<EmptyState icon="trend" title="No robotic assessment results yet" sub="They appear here once the device's assessment is locked and the laptop has sent it (sender.py --assessments). Each timepoint (A0, A1...) then shows which mechanisms the patient can use and how the range changed." />
	</div>
{/if}

{#if openId}<RoboticAssessmentDrawer list={data.roboticAssessments} id={openId} onclose={() => (openId = null)} />{/if}

<style>
	.chips-inline {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
	}
</style>

<script lang="ts">
	// How a patient's robotic assessment changed from timepoint to timepoint (A0, A1, ...): PLUTO range of motion per mechanism
	// and task (AROM / PROM / APROM), MARS reach range per movement. A graph needs two timepoints.
	import { untrack } from 'svelte';
	import Chart from '$lib/components/Chart.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { fmtDateShort } from '$lib/utils';
	import {
		MARS_MOVEMENTS,
		PLUTO_MECHANISMS,
		PLUTO_TASKS,
		ROBOTIC_NAMES,
		TASK_NAMES,
		reachTrend,
		romTrend,
		type RoboticAssessmentView
	} from '$lib/roboticAssessment';

	let { list, device: startDevice = null, limb: startLimb = null }: { list: RoboticAssessmentView[]; device?: string | null; limb?: string | null } = $props();

	const devices = $derived(['PLUTO', 'MARS'].filter((d) => list.some((a) => a.device === d)));
	let pickedDevice = $state<string | null>(untrack(() => startDevice));
	const device = $derived(pickedDevice && devices.includes(pickedDevice) ? pickedDevice : (devices[0] ?? null));

	const limbs = $derived([...new Set(list.filter((a) => a.device === device).map((a) => a.limb))].sort());
	let pickedLimb = $state<string | null>(untrack(() => startLimb));
	const limb = $derived(pickedLimb && limbs.includes(pickedLimb) ? pickedLimb : (limbs[0] ?? ''));

	// ---- PLUTO: a mechanism, then AROM / PROM / APROM (only those that were measured)
	const mechsWithData = $derived(PLUTO_MECHANISMS.filter((m) => PLUTO_TASKS.some((t) => romTrend(list, { limb, mechanism: m, task: t }).length > 0)));
	let pickedMech = $state<string | null>(null);
	const mechanism = $derived(pickedMech && mechsWithData.includes(pickedMech as never) ? pickedMech : (mechsWithData[0] ?? ''));
	const tasksWithData = $derived(PLUTO_TASKS.filter((t) => romTrend(list, { limb, mechanism, task: t }).length > 0));
	let pickedTask = $state<string | null>(null);
	const task = $derived(pickedTask && tasksWithData.includes(pickedTask as never) ? pickedTask : (tasksWithData[0] ?? ''));
	const rom = $derived(device === 'PLUTO' ? romTrend(list, { limb, mechanism, task }) : []);
	const unit = (u: string | null) => (u === 'deg' ? '°' : u ? ` ${u}` : '');

	// ---- MARS: a movement
	const movesWithData = $derived(MARS_MOVEMENTS.filter((m) => reachTrend(list, { limb, movement: m }).length > 0));
	let pickedMove = $state<string | null>(null);
	const movement = $derived(pickedMove && movesWithData.includes(pickedMove as never) ? pickedMove : (movesWithData[0] ?? ''));
	const reach = $derived(device === 'MARS' ? reachTrend(list, { limb, movement }) : []);

	const f = (n: number) => String(Math.round(n * 10) / 10);
	const points = $derived(device === 'PLUTO' ? rom : reach);
	const labels = $derived(points.map((p) => p.timepoint));

	const datasets = $derived.by(() => {
		if (device === 'PLUTO') return [{ label: TASK_NAMES[task] ?? task, data: rom.map((p) => p.range), color: 'var(--accent)' }];
		const sets = [];
		if (movement !== 'AP') sets.push({ label: 'Sideways reach (cm)', data: reach.map((p) => p.mlCm), color: 'var(--accent)' });
		if (movement !== 'ML') sets.push({ label: 'Forward reach (cm)', data: reach.map((p) => p.apCm), color: 'var(--series-2)' });
		return sets;
	});

	const tip = (i: number) => {
		if (device === 'PLUTO') {
			const p = rom[i];
			return [`${p.timepoint}: ${f(p.range)}${unit(p.unit)} range`, ...(p.min != null && p.max != null ? [`from ${f(p.min)} to ${f(p.max)}${unit(p.unit)}`] : []), fmtDateShort(p.date)];
		}
		const p = reach[i];
		return [`${p.timepoint}`, ...(movement !== 'AP' ? [`Sideways: ${f(p.mlCm)} cm`] : []), ...(movement !== 'ML' ? [`Forward: ${f(p.apCm)} cm`] : []), fmtDateShort(p.date)];
	};

	// first to latest, on the headline figure
	const headline = $derived.by(() => {
		if (points.length < 2) return null;
		const v = (i: number) => (device === 'PLUTO' ? rom[i].range : movement === 'AP' ? reach[i].apCm : reach[i].mlCm);
		const diff = Math.round((v(points.length - 1) - v(0)) * 10) / 10;
		const u = device === 'PLUTO' ? unit(rom[0].unit) : ' cm';
		return { diff, text: `${diff > 0 ? '+' : ''}${f(diff)}${u} from ${points[0].timepoint} to ${points[points.length - 1].timepoint}` };
	});
</script>

{#if !device}
	<EmptyState icon="trend" title="No robotic assessments yet" sub="The graph appears here once a device has sent its first locked assessment." />
{:else}
	<div class="pickers">
		{#if devices.length > 1}
			<div class="chips" role="radiogroup" aria-label="Device">
				{#each devices as d (d)}
					<button type="button" role="radio" aria-checked={d === device} class="chip" class:on={d === device} onclick={() => (pickedDevice = d)}>{d}</button>
				{/each}
			</div>
		{/if}
		{#if limbs.length > 1}
			<div class="chips" role="radiogroup" aria-label="Limb">
				{#each limbs as l (l)}
					<button type="button" role="radio" aria-checked={l === limb} class="chip" class:on={l === limb} onclick={() => (pickedLimb = l)}>{l} limb</button>
				{/each}
			</div>
		{/if}
		{#if device === 'PLUTO'}
			<div class="chips" role="radiogroup" aria-label="Mechanism">
				{#each mechsWithData as m (m)}
					<button type="button" role="radio" aria-checked={m === mechanism} class="chip" class:on={m === mechanism} title={ROBOTIC_NAMES[m]} onclick={() => (pickedMech = m)}>{m}</button>
				{/each}
			</div>
			<div class="chips" role="radiogroup" aria-label="Task">
				{#each tasksWithData as t (t)}
					<button type="button" role="radio" aria-checked={t === task} class="chip" class:on={t === task} onclick={() => (pickedTask = t)}>{t}</button>
				{/each}
			</div>
		{:else}
			<div class="chips" role="radiogroup" aria-label="Movement">
				{#each movesWithData as m (m)}
					<button type="button" role="radio" aria-checked={m === movement} class="chip" class:on={m === movement} title={ROBOTIC_NAMES[m]} onclick={() => (pickedMove = m)}>{m}</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if device === 'PLUTO' && !mechsWithData.length}
		<EmptyState icon="trend" title="No range of motion measured" sub="None of the mechanisms was completed in the assessments sent so far." />
	{:else}
		<div class="what muted">
			{#if device === 'PLUTO'}{ROBOTIC_NAMES[mechanism]} · {TASK_NAMES[task]}, range in degrees{:else}{ROBOTIC_NAMES[movement]}, best reach in centimetres{/if}
		</div>
		{#if points.length >= 2}
			{#if headline}<div class="change" class:up={headline.diff > 0} class:down={headline.diff < 0}>{headline.text}</div>{/if}
			<Chart kind="line" {labels} {datasets} opts={{ tooltipLines: tip, legend: datasets.length > 1 }} height={210} />
		{:else}
			<EmptyState
				icon="trend"
				title="A graph needs two timepoints"
				sub={points.length === 1 ? `Only ${points[0].timepoint} so far (${device === 'PLUTO' ? `${f(rom[0].range)}${unit(rom[0].unit)}` : `${f(reach[0].mlCm)} cm sideways, ${f(reach[0].apCm)} cm forward`}). The change shows once the next timepoint is assessed.` : 'This was not measured.'}
			/>
		{/if}
	{/if}
{/if}

<style>
	.pickers {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		margin-bottom: 12px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		min-height: 34px;
		padding: 3px 13px;
		font: inherit;
		font-size: 13px;
		color: var(--ink-700);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		cursor: pointer;
		text-transform: capitalize;
	}
	.chip.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent-soft-ink);
		font-weight: 600;
	}
	.what {
		font-size: 12.5px;
		margin-bottom: 8px;
	}
	.change {
		font-size: 13px;
		padding: 8px 12px;
		border-radius: var(--radius-s);
		background: var(--surface-2);
		margin-bottom: 10px;
		font-weight: 600;
	}
	.change.up {
		background: var(--good-soft);
	}
	.change.down {
		background: var(--critical-soft);
	}
</style>

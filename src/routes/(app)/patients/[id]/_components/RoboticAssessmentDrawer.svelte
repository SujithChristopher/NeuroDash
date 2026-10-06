<script lang="ts">
	// One robotic assessment timepoint in detail: what the device measured, mechanism by mechanism (PLUTO) or movement by
	// movement (MARS), how each figure changed since the previous timepoint, and the change over time as a graph.
	import Drawer from '$lib/components/Drawer.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { fmtDateShort } from '$lib/utils';
	import { changeSincePrevious, ROBOTIC_NAMES, TASK_NAMES, usable, type RoboticAssessmentView, type RoboticResultView } from '$lib/roboticAssessment';
	import RoboticTrend from './RoboticTrend.svelte';

	let { list, id, onclose }: { list: RoboticAssessmentView[]; id: string; onclose: () => void } = $props();

	const a = $derived(list.find((x) => x.id === id));
	const can = $derived(a ? usable(a) : { active: [], passive: [] });

	const f = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 10) / 10));
	const unit = (u: string | null) => (u === 'deg' ? '°' : u ? ` ${u}` : '');
	const tone = (s: string) => (s === 'Complete' ? 'good' : s === 'Rejected' ? 'critical' : s === 'Skipped' ? 'warning' : 'neutral');
	const sign = (n: number) => (n > 0 ? `+${f(n)}` : f(n));

	// PLUTO: the tasks of one mechanism, in the order they are done
	const TASK_ORDER = ['AROM', 'PROM', 'APROM', 'DISC'];
	const rowsOf = (code: string) =>
		(a?.results ?? []).filter((r) => r.mechanism === code).sort((x, y) => TASK_ORDER.indexOf(x.task) - TASK_ORDER.indexOf(y.task));
	const plutoMechs = $derived((a?.mechanisms ?? []).filter((m) => rowsOf(m.code).length));

	// MARS
	const reach = $derived((a?.results ?? []).filter((r) => r.task === 'ROM'));
	const checks = $derived((a?.results ?? []).filter((r) => r.task === 'CHECK'));
	const x = (r: RoboticResultView, key: string) => (r.extra && typeof r.extra[key] === 'number' ? (r.extra[key] as number) : null);
	const SHORT: Record<string, string> = { ML: 'Sideways (ML)', AP: 'Forwards (AP)', MLAP: 'Both (ML+AP)' };
	const targets = (r: RoboticResultView) => ((r.extra?.targets as { name: string; completed: boolean }[] | undefined) ?? []);
</script>

<Drawer title={a ? `${a.timepoint} · ${a.device} · ${a.limb} limb` : 'Robotic assessment'} {onclose}>
	{#if !a}
		<EmptyState icon="clipboard" title="Assessment not found" />
	{:else}
		<div class="kv-list" style="margin-bottom:16px">
			<div class="kv-row"><span class="kl">Timepoint</span><span class="kv mono">{a.timepoint}</span></div>
			<div class="kv-row"><span class="kl">Device</span><span class="kv">{a.device}</span></div>
			<div class="kv-row"><span class="kl">Limb assessed</span><span class="kv" style="text-transform:capitalize">{a.limb}</span></div>
			<div class="kv-row"><span class="kl">Assessed</span><span class="kv">{fmtDateShort(a.assessedAt)}</span></div>
			<div class="kv-row"><span class="kl">Finished (locked)</span><span class="kv">{a.lockedAt ? fmtDateShort(a.lockedAt) : '—'}</span></div>
		</div>

		<div class="k-label" style="margin-bottom:6px">{a.device === 'PLUTO' ? 'Mechanisms they can use' : 'Movements measured'}</div>
		<div class="usable">
			{#each can.active as m (m)}<Badge text="{m} · active" tone="good" />{/each}
			{#each can.passive as m (m)}<Badge text="{m} · passive only" tone="info" />{/each}
			{#if !can.active.length && !can.passive.length}<span class="muted" style="font-size:13px">None measured.</span>{/if}
		</div>
		{#if a.device === 'PLUTO'}
			<div class="muted" style="font-size:11.5px;margin:6px 0 16px">Active: the patient moved it themselves (AROM done). Passive only: only moved by the device (PROM / APROM).</div>
		{:else}
			<div class="muted" style="font-size:11.5px;margin:6px 0 16px">MARS moves the arm itself: these are the ranges it reached, not active movement.</div>
		{/if}

		{#if a.device === 'PLUTO'}
			{#each plutoMechs as m (m.code)}
				<div class="card" style="margin-bottom:14px">
					<div class="card-head">
						<h3>{ROBOTIC_NAMES[m.code] ?? m.code} <span class="mono muted" style="font-size:12px">{m.code}</span></h3>
						<Badge text={m.status} tone={m.status === 'Complete' ? 'good' : 'warning'} />
					</div>
					<div class="table-wrap">
						<table class="dt">
							<thead><tr><th>Task</th><th>Result</th><th>Range / change</th></tr></thead>
							<tbody>
								{#each rowsOf(m.code) as r (r.task)}
									{@const delta = changeSincePrevious(list, a, r.mechanism, r.task)}
									<tr>
										<td>{TASK_NAMES[r.task] ?? r.task}{#if r.attempts > 1}<div class="dt-sub">{r.attempts} attempts</div>{/if}</td>
										<td><Badge text={r.status} tone={tone(r.status)} /></td>
										<td class="mono">
											{r.romRange != null ? `${f(r.romRange)}${unit(r.unit)}` : '—'}
											{#if delta != null}<span class="delta" style="color:{delta >= 0 ? 'var(--good)' : 'var(--critical)'}">{sign(delta)}{unit(r.unit)}</span>{/if}
											{#if r.romMin != null && r.romMax != null}<div class="dt-sub">{f(r.romMin)} to {f(r.romMax)}{unit(r.unit)}</div>{/if}
										</td>
									</tr>
									{#if r.status !== 'Complete' && r.comment}
										<tr><td colspan="3" class="dt-sub reason">{r.comment}</td></tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/each}
		{:else}
			<div class="card" style="margin-bottom:14px">
				<div class="card-head"><h3>Range of the movements</h3><span class="hint">best reach, cm</span></div>
				<div class="table-wrap">
					<table class="dt">
						<thead><tr><th>Movement</th><th>Sideways</th><th>Forward</th><th>Trials</th></tr></thead>
						<tbody>
							{#each reach as r (r.mechanism)}
								<tr>
									<td>{SHORT[r.mechanism] ?? r.mechanism}</td>
									<td class="mono">{f(x(r, 'mlCm'))} cm<div class="dt-sub">avg {f(x(r, 'avgMlCm'))}</div></td>
									<td class="mono">{f(x(r, 'apCm'))} cm<div class="dt-sub">avg {f(x(r, 'avgApCm'))}</div></td>
									<td class="mono">{r.attempts}{#if (x(r, 'sessions') ?? 1) > 1}<div class="dt-sub">{x(r, 'sessions')} sessions</div>{/if}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
			{#each checks as r (r.mechanism)}
				<div class="card" style="margin-bottom:14px">
					<div class="card-head"><h3>{ROBOTIC_NAMES[r.mechanism] ?? r.mechanism}</h3><Badge text={r.comment ?? r.status} tone={tone(r.status)} /></div>
					<div class="card-body" style="display:flex;gap:6px;flex-wrap:wrap">
						{#each targets(r) as t (t.name)}<Badge text="{t.name}{t.completed ? ' ✓' : ' ✗'}" tone={t.completed ? 'good' : 'critical'} />{/each}
					</div>
				</div>
			{/each}
		{/if}

		<div class="k-label" style="margin:18px 0 8px">Change over time</div>
		<RoboticTrend {list} device={a.device} limb={a.limb} />
	{/if}
</Drawer>

<style>
	.reason {
		white-space: normal;
		padding-top: 0;
		border-top: 0;
	}
	.delta {
		margin-left: 6px;
		font-size: 12px;
	}
	.usable {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
</style>

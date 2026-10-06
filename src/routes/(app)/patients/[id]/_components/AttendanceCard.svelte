<script lang="ts">
	// Therapy-plan attendance: one square per plan day, shaded by how much of the day's target was trained.
	import { buildAttendance, type AttendanceDay } from '$lib/attendance';
	import { fmtDateShort } from '$lib/utils';

	let { dayLog }: { dayLog: AttendanceDay[] } = $props();

	// "Today" is the UTC calendar day, like the plan days themselves
	const today = new Date().toISOString().slice(0, 10);
	const a = $derived(buildAttendance(dayLog, today));
	const LEVELS = [0, 1, 2, 3, 4] as const;
	const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

	const title = (c: NonNullable<(typeof a.weeks)[number][number]>) =>
		`Day ${c.dayNumber} · ${fmtDateShort(c.date)} · ${c.level === null ? 'still to come' : `${Math.round(c.minutes)} of ${c.target} min`}`;
</script>

<div class="card">
	<div class="card-head"><h3>Attendance</h3><span class="hint">therapy minutes per day vs target</span></div>
	<div class="card-body">
		{#if a.weeks.length}
			<div class="att">
				<div class="grid-wrap">
					<div class="months" style="--weeks:{a.weeks.length}">
						{#each a.months as m, i (i)}<span>{m ?? ''}</span>{/each}
					</div>
					<div class="body">
						<div class="days" aria-hidden="true">{#each WEEKDAYS as d, i (i)}<span>{d}</span>{/each}</div>
						<div class="cells" style="--weeks:{a.weeks.length}" role="img" aria-label="Attendance by day">
							{#each a.weeks as week, w (w)}
								{#each week as c, i (i)}
									{#if c}
										<span class="cell l{c.level ?? 'x'}" class:today={c.today} title={title(c)}></span>
									{:else}
										<span class="cell out"></span>
									{/if}
								{/each}
							{/each}
						</div>
					</div>
				</div>
				<div class="facts">
					<div>
						<div class="k-label">Last 7 days</div>
						<div class="big">{a.last7.trained} of {a.last7.planned} <span>sessions</span></div>
					</div>
					<div>
						<div class="k-label">Since start</div>
						<div class="big">{a.sinceStartPct == null ? '—' : `${a.sinceStartPct}%`} <span>of planned minutes</span></div>
					</div>
					<div class="legend" aria-label="Legend">
						None
						{#each LEVELS as l (l)}<span class="cell sm l{l}"></span>{/each}
						Target met
					</div>
				</div>
			</div>
		{:else}
			<div class="muted" style="font-size:12.5px">Attendance appears once a therapy plan exists.</div>
		{/if}
	</div>
</div>

<style>
	.att {
		display: flex;
		gap: 28px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.grid-wrap {
		overflow-x: auto;
		max-width: 100%;
		padding-bottom: 2px;
	}
	.months {
		display: grid;
		grid-template-columns: repeat(var(--weeks), 22px);
		gap: 5px;
		margin-left: 34px;
		margin-bottom: 4px;
		font-size: 11px;
		color: var(--ink-500);
		height: 14px;
	}
	.months span {
		white-space: nowrap;
		overflow: visible;
	}
	.body {
		display: flex;
		gap: 8px;
	}
	.days {
		display: grid;
		grid-template-rows: repeat(7, 22px);
		gap: 5px;
		width: 26px;
		font-size: 11px;
		color: var(--ink-500);
		line-height: 22px;
	}
	.cells {
		display: grid;
		grid-template-rows: repeat(7, 22px);
		grid-auto-flow: column;
		grid-auto-columns: 22px;
		gap: 5px;
	}
	.cell {
		display: block;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		box-sizing: border-box;
	}
	.cell.sm {
		width: 14px;
		height: 14px;
		border-radius: 4px;
	}
	.cell.out {
		background: transparent;
	}
	/* a day still to come: an empty outline */
	.cell.lx {
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.cell.l0 {
		background: var(--surface-2);
	}
	.cell.l1 {
		background: color-mix(in srgb, var(--accent) 22%, var(--surface));
	}
	.cell.l2 {
		background: color-mix(in srgb, var(--accent) 48%, var(--surface));
	}
	.cell.l3 {
		background: color-mix(in srgb, var(--accent) 74%, var(--surface));
	}
	.cell.l4 {
		background: var(--accent);
	}
	.cell.today {
		outline: 2px solid var(--ink-900);
		outline-offset: 1px;
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 190px;
	}
	.big {
		font-size: 24px;
		font-weight: 600;
		color: var(--ink-900);
		line-height: 1.2;
		margin-top: 2px;
	}
	.big span {
		font-size: 14px;
		font-weight: 400;
		color: var(--ink-500);
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--ink-500);
	}
</style>

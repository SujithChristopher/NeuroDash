<script lang="ts">
	// Therapy-plan attendance as a calendar: a row per week (Monday to Sunday), one square per plan day showing its date,
	// shaded by how much of that day's target was trained.
	import { buildAttendance, type AttendanceDay } from '$lib/attendance';
	import { fmtDateShort } from '$lib/utils';

	let { dayLog }: { dayLog: AttendanceDay[] } = $props();

	// "Today" is the UTC calendar day, like the plan days themselves
	const today = new Date().toISOString().slice(0, 10);
	const a = $derived(buildAttendance(dayLog, today));
	const LEVELS = [0, 1, 2, 3, 4] as const;
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	const title = (c: NonNullable<(typeof a.weeks)[number][number]>) =>
		`Day ${c.dayNumber} · ${fmtDateShort(c.date)} · ${c.level === null ? 'still to come' : `${Math.round(c.minutes)} of ${c.target} min`}`;
	const dayOfMonth = (date: string) => String(Number(date.slice(8, 10)));
</script>

<div class="card">
	<div class="card-head"><h3>Attendance</h3><span class="hint">therapy minutes per day vs target</span></div>
	<div class="card-body">
		{#if a.weeks.length}
			<div class="cal" role="img" aria-label="Attendance by day">
				<div class="row head" aria-hidden="true">
					<span></span>
					{#each WEEKDAYS as d (d)}<span>{d}</span>{/each}
				</div>
				{#each a.weeks as week, w (w)}
					<div class="row">
						<span class="month">{a.months[w] ?? ''}</span>
						{#each week as c, i (i)}
							{#if c}
								<span class="cell l{c.level ?? 'x'}" class:today={c.today} title={title(c)}>{dayOfMonth(c.date)}</span>
							{:else}
								<span class="cell out"></span>
							{/if}
						{/each}
					</div>
				{/each}
			</div>
			<div class="legend" aria-label="Legend">
				None
				{#each LEVELS as l (l)}<span class="sw l{l}"></span>{/each}
				Target met
			</div>
		{:else}
			<div class="muted" style="font-size:12.5px">Attendance appears once a therapy plan exists.</div>
		{/if}
	</div>
</div>

<style>
	/* seven columns share the whole width of the card, so there is no empty space beside the calendar */
	.cal {
		display: grid;
		gap: 6px;
		width: 100%;
	}
	.row {
		display: grid;
		grid-template-columns: 30px repeat(7, minmax(0, 1fr));
		gap: 6px;
		align-items: center;
	}
	.head span {
		text-align: center;
		font-size: 11px;
		color: var(--ink-500);
	}
	.month {
		font-size: 11px;
		color: var(--ink-500);
		white-space: nowrap;
	}
	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		max-height: 46px;
		aspect-ratio: 1.25;
		border-radius: 8px;
		box-sizing: border-box;
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-500);
	}
	.cell.out {
		background: transparent;
	}
	/* a day still to come: an empty outline */
	.cell.lx {
		background: var(--surface);
		border: 1px solid var(--border);
		font-weight: 500;
		color: var(--ink-400);
	}
	.cell.l0 {
		background: var(--surface-2);
	}
	.cell.l1 {
		background: color-mix(in srgb, var(--accent) 22%, var(--surface));
	}
	.cell.l2 {
		background: color-mix(in srgb, var(--accent) 48%, var(--surface));
		color: var(--ink-900);
	}
	.cell.l3 {
		background: color-mix(in srgb, var(--accent) 74%, var(--surface));
		color: #fff;
	}
	.cell.l4 {
		background: var(--accent);
		color: #fff;
	}
	.cell.today {
		outline: 2px solid var(--ink-900);
		outline-offset: 1px;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: 14px;
		font-size: 12px;
		color: var(--ink-500);
	}
	.sw {
		width: 14px;
		height: 14px;
		border-radius: 4px;
	}
	.sw.l0 {
		background: var(--surface-2);
	}
	.sw.l1 {
		background: color-mix(in srgb, var(--accent) 22%, var(--surface));
	}
	.sw.l2 {
		background: color-mix(in srgb, var(--accent) 48%, var(--surface));
	}
	.sw.l3 {
		background: color-mix(in srgb, var(--accent) 74%, var(--surface));
	}
	.sw.l4 {
		background: var(--accent);
	}
</style>

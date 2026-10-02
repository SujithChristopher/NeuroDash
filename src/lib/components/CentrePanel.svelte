<script lang="ts">
	// One card per centre: who works there, who looks after its devices, how many patients in each state, hours trained.
	import Badge from './Badge.svelte';
	import EmptyState from './EmptyState.svelte';
	import { fmtDateShort, fmtHrsFromMin } from '$lib/utils';

	interface Centre {
		id: string;
		name: string;
		engineer: string | null;
		therapists: number;
		consultants: number;
		devices: number;
		patients: number;
		byStatus: Record<string, number>;
		totalHours: number;
		activeDays: number;
		activeDays30: number;
		lastTrained: string | null;
	}
	let { centres }: { centres: Centre[] } = $props();

	const STATUS_ORDER = ['Active', 'Ongoing', 'Paused', 'Completed', 'Discontinued'];
	const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
</script>

{#if centres.length === 0}
	<div class="card"><EmptyState icon="flag" title="No centre assigned" sub="Centre figures appear once your account belongs to a centre." /></div>
{:else}
	<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">
		{#each centres as c (c.id)}
			<div class="card">
				<div class="card-head">
					<div>
						<h3>{c.name}</h3>
						<div class="hint">{plural(c.therapists, 'therapist')}{c.consultants ? ` · ${plural(c.consultants, 'consultant')}` : ''} · {plural(c.devices, 'device')}</div>
					</div>
					<Badge text={c.engineer ? `Engineer: ${c.engineer}` : 'No engineer assigned'} tone={c.engineer ? 'info' : 'warning'} />
				</div>
				<div class="card-body">
					<div class="kv-list">
						<div class="kv-row"><span class="kl">Patients handled</span><span class="kv">{c.patients}</span></div>
						<div class="kv-row"><span class="kl">Total hours trained</span><span class="kv">{fmtHrsFromMin(c.totalHours * 60)}</span></div>
						<div class="kv-row"><span class="kl">Active training days</span><span class="kv">{c.activeDays} <span class="muted">({c.activeDays30} in the last 30)</span></span></div>
						<div class="kv-row"><span class="kl">Last trained</span><span class="kv">{c.lastTrained ? fmtDateShort(c.lastTrained) : '—'}</span></div>
					</div>
					<hr class="sep" />
					<div class="statuses">
						{#each STATUS_ORDER as st (st)}
							<div class="status-cell">
								<div class="n">{c.byStatus[st] ?? 0}</div>
								<div class="l"><Badge text={st} /></div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.statuses {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
		gap: 10px;
	}
	.status-cell {
		text-align: center;
	}
	.n {
		font-size: 22px;
		font-weight: 700;
		line-height: 1.1;
		margin-bottom: 4px;
	}
</style>

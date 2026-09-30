<script lang="ts">
	import KpiCard from './KpiCard.svelte';
	import Icon from './Icon.svelte';
	import Chart from './Chart.svelte';
	import { EVENT_ICON, EVENT_TONE } from '$lib/deviceEvents';
	import { statusTone, timeAgo } from '$lib/utils';

	interface Props {
		fleet: {
			total: number;
			inUse: number;
			available: number;
			issueDetected: number;
			maintenance: number;
			utilization: number;
			openIssues: number;
			criticalIssues: number;
			issueStatus: { status: string; count: number }[];
			utilByType: { id: string; name: string; category: string; series: string; units: number; inUse: number; pct: number }[];
			statusMix: { status: string; count: number }[];
			events: { id: string; type: string; description: string; at: string; device: { id: string; displayCode: string } }[];
		};
		/** Engineer console shows the issue queue + utilization; Admin gets the fleet-status donut too. */
		showStatusMix?: boolean;
	}
	let { fleet, showStatusMix = false }: Props = $props();

	const TONE_VAR: Record<string, string> = {
		good: 'var(--good)',
		warning: 'var(--warning)',
		critical: 'var(--critical)',
		accent: 'var(--accent)',
		info: 'var(--info)',
		neutral: 'var(--ink-400)',
		serious: 'var(--serious)'
	};
	const colors = $derived(fleet.statusMix.map((s) => TONE_VAR[statusTone(s.status)]));
</script>

<div class="grid grid-4" style="margin-bottom:16px">
	<KpiCard label="Total Devices" value={fleet.total} icon="device" tone="accent" />
	<KpiCard label="In Use" value={fleet.inUse} icon="activity" tone="good" sub="{fleet.utilization}% fleet utilization" />
	<KpiCard label="Available" value={fleet.available} icon="check" tone="info" />
	<KpiCard label="Open Issues" value={fleet.openIssues} icon="alert" tone={fleet.openIssues ? 'critical' : 'good'} sub="{fleet.criticalIssues} critical severity" />
</div>

<div class="section-title-row"><h2>Issue queue</h2></div>
<div class="grid grid-4">
	{#each fleet.issueStatus as s (s.status)}
		<a class="card card-pad" href="/device-issues" style="text-decoration:none">
			<div class="k-label">{s.status}</div>
			<div class="k-val" style="margin-top:6px;font-size:24px">{s.count}</div>
		</a>
	{/each}
</div>

<div class="section-title-row"><h2>Device utilization by type</h2></div>
<div class="two-col">
	<div class="card">
		<div class="card-body">
			{#each fleet.utilByType as u (u.id)}
				<div style="margin-bottom:14px">
					<div class="kv-row" style="margin-bottom:5px">
						<span class="kl"><b style="color:var(--ink-900)">{u.name}</b> · {u.category}</span>
						<span class="kv mono">{u.inUse}/{u.units} in use</span>
					</div>
					<div class="progress-track"><div class="progress-fill" style="width:{u.pct}%;background:var(--{u.series})"></div></div>
				</div>
			{/each}
		</div>
	</div>
	<div class="card">
		<div class="card-head"><h3>{showStatusMix ? 'Fleet status' : 'Recent device events'}</h3></div>
		<div class="card-body">
			{#if showStatusMix}
				<div style="display:flex;align-items:center;gap:18px">
					<div style="width:130px;flex-shrink:0">
						<Chart kind="donut" labels={fleet.statusMix.map((s) => s.status)} data={fleet.statusMix.map((s) => s.count)} {colors} height={130} />
					</div>
					<div class="legend-row" style="flex-direction:column;gap:8px">
						{#each fleet.statusMix as s, i (s.status)}
							<div class="legend-item"><span class="sw" style="background:{colors[i]}"></span>{s.status} <span class="mono muted">({s.count})</span></div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="timeline">
					{#each fleet.events as e (e.id)}
						<div class="tl-item">
							<span class="tl-dot" style="background:var(--{EVENT_TONE[e.type] ?? 'info'}-soft);color:var(--{EVENT_TONE[e.type] ?? 'info'})"><Icon name={EVENT_ICON[e.type] ?? 'info'} size={10} /></span>
							<div class="tl-date">{timeAgo(e.at)}</div>
							<div class="tl-title">{e.description}</div>
							<div class="tl-desc">{e.device.displayCode}</div>
						</div>
					{:else}
						<div class="muted" style="font-size:12.5px">No device events yet.</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

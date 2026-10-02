<script lang="ts">
	import { goto } from '$app/navigation';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { fmtDateShort, fmtDateTime, fmtHrsFromMin, pct, timeAgo } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, goTab }: { data: PageData; goTab: (t: string) => void } = $props();

	// Activity per training device, from the sessions the laptops uploaded.
	const activity = $derived.by(() => {
		const m = new Map<string, { sessions: number; stars: number; last: string | null }>();
		for (const s of data.sessions) {
			if (!s.sourceDevice) continue;
			const v = m.get(s.sourceDevice) ?? { sessions: 0, stars: 0, last: null };
			v.sessions++;
			v.stars += s.totalStars;
			if (!v.last || s.startTime > v.last) v.last = s.startTime;
			m.set(s.sourceDevice, v);
		}
		return m;
	});

	const usage = $derived.by(() => {
		const m = new Map<string, { code: string; id: string; n: number; min: number; hits: number; targets: number; stars: number }>();
		for (const s of data.sessions) {
			const v = m.get(s.device.id) ?? { code: s.device.displayCode, id: s.device.id, n: 0, min: 0, hits: 0, targets: 0, stars: 0 };
			v.n++;
			v.min += s.durationMinutes ?? 0;
			v.hits += s.totalHits;
			v.targets += s.totalTargets;
			v.stars += s.totalStars;
			m.set(s.device.id, v);
		}
		return [...m.values()];
	});
</script>

<div class="section-title-row" style="margin-top:0">
	<h2>Training devices</h2>
	{#if data.perms.canModifyPlan}
		<button class="btn btn-secondary btn-sm" onclick={() => goTab('plan')}><Icon name="edit" size={13} /> Change in plan</button>
	{/if}
</div>
<div class="card" style="margin-bottom:18px">
	{#if data.trainingDevices.length === 0 && data.formerDevices.length === 0}
		<EmptyState icon="device" title="No training devices yet" sub="Devices are chosen in the therapy plan. Laptops only receive patients whose plan includes their device." />
	{:else}
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Device</th><th>Added</th><th>Sessions</th><th>Stars</th><th>Last upload</th></tr></thead>
				<tbody>
					{#each data.trainingDevices as d (d.id)}
						{@const a = activity.get(d.deviceTypeId)}
						<tr>
							<td><div class="dt-name">{d.name}</div><div class="dt-sub">{d.category}</div></td>
							<td class="mono">{fmtDateShort(d.allocatedAt)}<div class="dt-sub">by {d.by}</div></td>
							<td class="mono">{a?.sessions ?? 0}</td>
							<td class="mono">{a?.stars ?? 0}</td>
							<td>{#if a?.last}{timeAgo(a.last)}{:else}<span class="muted">No data yet</span>{/if}</td>
						</tr>
					{/each}
					<!-- Taken out of the plan, but everything it recorded is still counted everywhere -->
					{#each data.formerDevices as d (d.deviceTypeId)}
						{@const a = activity.get(d.deviceTypeId)}
						<tr>
							<td><div class="dt-name">{d.name} <Badge text="Removed from plan" tone="neutral" /></div><div class="dt-sub">{d.category}</div></td>
							<td class="muted">—</td>
							<td class="mono">{a?.sessions ?? 0}</td>
							<td class="mono">{a?.stars ?? 0}</td>
							<td>{#if a?.last}{timeAgo(a.last)}{:else}<span class="muted">No data</span>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<div class="dt-sub" style="padding:10px 18px 14px">
		Affected side: <b>{data.patient.affectedSide ?? 'not set'}</b>
		{#if data.folder.enabled} · Local-server folder: <span class="mono">{data.folder.path}</span>{/if}
	</div>
</div>

{#if data.deviceConfigs.length}
	<div class="section-title-row"><h2>Device configuration</h2><span class="muted" style="font-size:12px">from configdata.csv</span></div>
	<div class="card" style="margin-bottom:18px">
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Device</th><th>Training window</th><th>Side</th><th>Target min</th><th>ML / AP / MLAP</th><th>Arm (fore / upper)</th><th>Group</th></tr></thead>
				<tbody>
					{#each data.deviceConfigs as c (c.id)}
						<tr>
							<td class="dt-name">{c.device}</td>
							<td class="mono">{fmtDateShort(c.startDate)} → {c.endDate ? fmtDateShort(c.endDate) : '—'}</td>
							<td>{c.trainingSide ?? '—'}</td>
							<td class="mono">{c.totalTime ?? '—'}</td>
							<td class="mono">{c.ml ?? '—'} / {c.ap ?? '—'} / {c.mlap ?? '—'}</td>
							<td class="mono">{c.foreArmLength ?? '—'} / {c.upperArmLength ?? '—'}</td>
							<td>{c.group ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if data.uploads.length}
	<div class="section-title-row"><h2>Data received from devices</h2></div>
	<div class="card" style="margin-bottom:18px">
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>File</th><th>Rows</th><th>Status</th><th>Processed</th></tr></thead>
				<tbody>
					{#each data.uploads as u (u.id)}
						<tr>
							<td class="mono">{u.path}</td>
							<td class="mono">{u.rows}</td>
							<td><Badge text={u.status === 'ok' ? 'Imported' : u.status === 'unmatched' ? 'Unmatched' : 'Error'} tone={u.status === 'ok' ? 'good' : u.status === 'unmatched' ? 'warning' : 'critical'} />{#if u.message}<div class="dt-sub">{u.message}</div>{/if}</td>
							<td class="mono">{fmtDateTime(u.at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if usage.length}
	<div class="section-title-row"><h2>Usage by device</h2></div>
	<div class="grid grid-3">
		{#each usage as u (u.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="card card-pad" style="cursor:pointer" onclick={() => goto(`/devices/${u.id}`)}>
				<div class="dt-name mono" style="margin-bottom:10px">{u.code}</div>
				<div class="kv-row"><span class="kl">Sessions</span><span class="kv">{u.n}</span></div>
				<div class="kv-row"><span class="kl">Time used</span><span class="kv">{fmtHrsFromMin(u.min)}</span></div>
				<div class="kv-row"><span class="kl">Accuracy</span><span class="kv">{pct(u.hits, u.targets)}%</span></div>
				<div class="kv-row"><span class="kl">Stars earned</span><span class="kv">{u.stars}</span></div>
			</div>
		{/each}
	</div>
{/if}

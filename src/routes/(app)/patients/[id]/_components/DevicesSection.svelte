<script lang="ts">
	import { goto } from '$app/navigation';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { fmtDateShort, fmtHrsFromMin, pct } from '$lib/utils';
	import type { PageData } from '../$types';

	let { data, onrequest }: { data: PageData; onrequest: () => void } = $props();

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

{#if data.perms.canRequestDevice}
	<div class="page-actions" style="justify-content:flex-end;margin-bottom:16px">
		<button class="btn btn-primary btn-sm" onclick={onrequest}><Icon name="plus" size={13} /> Request device</button>
	</div>
{/if}

<div class="section-title-row" style="margin-top:0"><h2>Assignment history</h2></div>
<div class="card" style="margin-bottom:18px">
	{#if data.assignments.length === 0}
		<EmptyState icon="device" title="No device has been assigned." sub="Request a device to begin therapy." />
	{:else}
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Device</th><th>Type</th><th>Assigned</th><th>Returned</th><th>Status</th></tr></thead>
				<tbody>
					{#each data.assignments as a (a.id)}
						<tr class="clickable" onclick={() => goto(`/devices/${a.deviceId}`)}>
							<td class="dt-name mono">{a.deviceCode}</td>
							<td>{a.category}</td>
							<td class="mono">{fmtDateShort(a.assignedDate)}</td>
							<td class="mono">{a.returnedDate ? fmtDateShort(a.returnedDate) : '—'}</td>
							<td><Badge text={a.status} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<div class="section-title-row"><h2>Device requests</h2></div>
<div class="card" style="margin-bottom:18px">
	{#if data.requests.length === 0}
		<EmptyState icon="box" title="No device requests" />
	{:else}
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Device</th><th>Requested</th><th>Status</th><th>Engineer</th><th>Notes</th></tr></thead>
				<tbody>
					{#each data.requests as r (r.id)}
						<tr>
							<td class="dt-name">{r.deviceTypeName}</td>
							<td class="mono">{fmtDateShort(r.requestedAt)}</td>
							<td><Badge text={r.status} /></td>
							<td>{r.engineer ?? '—'}</td>
							<td class="muted">{r.notes ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

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

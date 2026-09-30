<script lang="ts">
	import { goto } from '$app/navigation';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Section from './Section.svelte';
	import { REQUEST_PENDING } from '$lib/constants';
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

<Section id="devices" title="Devices" count={data.assignments.length}>
	{#snippet actions()}
		{#if data.perms.canRequestDevice}
			<button class="btn btn-primary btn-sm" onclick={onrequest}><Icon name="plus" size={13} /> Request device</button>
		{/if}
	{/snippet}

	<div class="pd-cols">
		<div class="s7">
			<div class="card">
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

			{#if data.requests.length}
				<details class="pd-fold" open={data.requests.some((r) => r.status === REQUEST_PENDING)}>
					<summary>Device requests · {data.requests.length}</summary>
					<div class="card">
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
					</div>
				</details>
			{/if}
		</div>

		{#if usage.length}
			<div class="s5">
				<div class="card">
					<div class="card-head"><h3>Usage by device</h3><span class="hint">All sessions</span></div>
					<div class="pd-usage" style="padding-top:6px">
						{#each usage as u (u.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div class="pd-usage-row" onclick={() => goto(`/devices/${u.id}`)}>
								<span class="dt-name mono">{u.code}</span>
								<span class="u"><b>{u.n}</b>sessions</span>
								<span class="u"><b>{fmtHrsFromMin(u.min)}</b>time used</span>
								<span class="u"><b>{pct(u.hits, u.targets)}%</b>accuracy</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
</Section>

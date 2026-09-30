<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { fmtDateTime } from '$lib/utils';

	let { data } = $props();

	function setFilter(key: 'action' | 'role', value: string) {
		const q = new URLSearchParams({ action: data.action, role: data.role });
		q.set(key, value);
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}
</script>

<PageHead
	title="Audit Log"
	sub="Record of clinical and system activity, for compliance and oversight. Most recent 100 events."
/>

<div class="card card-pad" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap">
	<select class="filter-select" value={data.action} onchange={(e) => setFilter('action', e.currentTarget.value)}>
		<option value="all">All actions</option>
		{#each data.actions as a (a)}<option value={a}>{a}</option>{/each}
	</select>
	<select class="filter-select" value={data.role} onchange={(e) => setFilter('role', e.currentTarget.value)}>
		<option value="all">All roles</option>
		{#each ['THERAPIST', 'CONSULTANT', 'ENGINEER', 'ADMIN', 'SYSTEM'] as r (r)}
			<option value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
		{/each}
	</select>
	<span class="muted" style="font-size:12px;margin-left:auto;align-self:center">{data.rows.length} events</span>
</div>

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead>
				<tr>
					<th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Previous</th><th>New</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.id)}
					<tr>
						<td class="mono">{fmtDateTime(r.at)}</td>
						<td class="dt-name">{r.user}</td>
						<td><Badge text={r.role} tone="neutral" /></td>
						<td>
							{r.action}
							{#if r.notes}<div class="dt-sub">{r.notes}</div>{/if}
						</td>
						<td class="mono">{r.entityType} · {r.entityId.slice(0, 8)}</td>
						<td class="mono muted">{r.previous ?? '—'}</td>
						<td class="mono">{r.next ?? '—'}</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">No events match.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

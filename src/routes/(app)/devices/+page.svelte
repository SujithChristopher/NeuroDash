<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RequestActions from '$lib/components/RequestActions.svelte';
	import { DEVICE_STATUSES } from '$lib/constants';
	import { toastEnhance } from '$lib/enhance';
	import { fmtDateShort, timeAgo } from '$lib/utils';

	let { data, form } = $props();
	const PAGE_SIZE = 8;

	let q = $state('');
	let type = $state('all');
	let status = $state('all');
	let pageNo = $state(1);
	let showRegister = $state(false);
	let showRequest = $state(false);

	const count = (s: string) => data.devices.filter((d) => d.status === s).length;
	const filtered = $derived(
		data.devices.filter(
			(d) =>
				(!q || d.displayCode.toLowerCase().includes(q.toLowerCase()) || d.serialNumber.toLowerCase().includes(q.toLowerCase())) &&
				(type === 'all' || d.type.id === type) &&
				(status === 'all' || d.status === status)
		)
	);
	const pages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
	const current = $derived(Math.min(pageNo, pages));
	const items = $derived(filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE));
</script>

<PageHead title="Devices" sub="{data.devices.length} rehabilitation devices across {data.types.length} device types.">
	{#snippet actions()}
		{#if data.canRequest}
			<button class="btn btn-primary" onclick={() => (showRequest = true)}><Icon name="plus" size={15} /> Request device</button>
		{/if}
		{#if data.canRegister}
			<button class="btn btn-primary" onclick={() => (showRegister = true)}><Icon name="plus" size={15} /> Register device</button>
		{/if}
	{/snippet}
</PageHead>

<div class="grid grid-4" style="margin-bottom:20px">
	<KpiCard label="Total Devices" value={data.devices.length} icon="device" tone="accent" />
	<KpiCard label="In Use" value={count('In Use')} icon="activity" tone="good" />
	<KpiCard label="Available" value={count('Available')} icon="check" tone="info" />
	<KpiCard label="Issues / Maintenance" value={count('Issue Detected') + count('Awaiting Engineer') + count('Maintenance')} icon="alert" tone="warning" />
</div>

<div class="card">
	<div class="table-toolbar">
		<div class="search-box" style="width:220px">
			<Icon name="search" size={14} />
			<input placeholder="Search device ID or serial…" bind:value={q} oninput={() => (pageNo = 1)} />
		</div>
		<select class="filter-select" bind:value={type} onchange={() => (pageNo = 1)}>
			<option value="all">All types</option>
			{#each data.types as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<select class="filter-select" bind:value={status} onchange={() => (pageNo = 1)}>
			<option value="all">All statuses</option>
			{#each DEVICE_STATUSES as s (s)}<option value={s}>{s}</option>{/each}
		</select>
		<div class="spacer"></div>
		<button class="btn btn-ghost btn-sm" onclick={() => ((q = ''), (type = status = 'all'), (pageNo = 1))}><Icon name="filter" size={13} /> Reset</button>
	</div>
	<div class="table-wrap">
		<table class="dt">
			<thead><tr><th>Device</th><th>Centre</th><th>Status</th><th></th></tr></thead>
			<tbody>
				{#each items as d (d.id)}
					<tr class="clickable" onclick={() => goto(`/devices/${d.id}`)}>
						<td>
							<div class="dt-name mono">{d.displayCode}</div>
							<div class="dt-sub">{d.type.category}{d.location ? ` · ${d.location}` : ''}{d.lastSyncAt ? ` · synced ${timeAgo(d.lastSyncAt)}` : ''}</div>
						</td>
						<td>{#if d.centre}{d.centre}{:else}<span class="muted">In stock</span>{/if}</td>
						<td><Badge text={d.status} /></td>
						<td class="row-chevron"><Icon name="chevron" size={14} /></td>
					</tr>
				{:else}
					<tr><td colspan="4"><EmptyState icon="device" title="No devices match your filters" /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="table-foot">
		<span>Showing {items.length ? (current - 1) * PAGE_SIZE + 1 : 0}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
		<div class="pager">
			<button disabled={current <= 1} onclick={() => (pageNo = current - 1)} aria-label="Previous page" style="transform:rotate(180deg)"><Icon name="chevron" size={12} /></button>
			{#each Array.from({ length: Math.min(pages, 6) }, (_, i) => i + 1) as n (n)}
				<button class:active={n === current} onclick={() => (pageNo = n)}>{n}</button>
			{/each}
			<button disabled={current >= pages} onclick={() => (pageNo = current + 1)} aria-label="Next page"><Icon name="chevron" size={12} /></button>
		</div>
	</div>
</div>

{#if data.canRequest || data.isEngineer}
	<div class="section-title-row">
		<h2>Device requests</h2>
		<span class="muted" style="font-size:12px">{data.isEngineer ? 'from every centre' : `for ${data.centreName ?? 'your centre'}`}</span>
	</div>
	{#if data.canRequest}
		<div class="alert alert-info" style="margin-bottom:12px">
			<Icon name="info" size={15} />
			<span>An engineer clears each request and sets up a unit at your centre. Once it is set up you can raise issues for it and follow its history. You are notified at each step.</span>
		</div>
	{/if}
	<div class="card" style="margin-bottom:20px">
		<div class="table-wrap">
			<table class="dt">
				<thead>
					<tr><th>Centre</th><th>Device type</th>{#if data.isEngineer}<th>Requested by</th>{/if}<th>Requested</th><th>Engineer</th><th>Status</th>{#if data.isEngineer}<th></th>{/if}</tr>
				</thead>
				<tbody>
					{#each data.requests as r (r.id)}
						<tr>
							<td>{r.location.name}{#if r.notes}<div class="dt-sub">{r.notes}</div>{/if}</td>
							<td>{r.deviceType.name} — {r.deviceType.category}</td>
							{#if data.isEngineer}<td>{r.therapist}</td>{/if}
							<td class="mono">{fmtDateShort(r.requestedAt)}</td>
							<td>{#if r.engineer}{r.engineer}{:else}<span class="muted">Unassigned</span>{/if}</td>
							<td><Badge text={r.status} /></td>
							{#if data.isEngineer}<td><RequestActions request={r} available={data.available} /></td>{/if}
						</tr>
					{:else}
						<tr><td colspan="7"><EmptyState icon="device" title="No device requests yet" sub={data.canRequest ? 'Use Request device above to ask for one.' : ''} /></td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if showRequest}
	<Modal title="Request a device for {data.centreName ?? 'your centre'}" onclose={() => (showRequest = false)}>
		<form id="request-device" method="POST" action="?/request" use:enhance={toastEnhance({ onSuccess: () => (showRequest = false), reset: true })}>
			<div class="field">
				<label for="rq-type">Device type</label>
				<select id="rq-type" name="deviceTypeId" required>
					<option value="">Select a device type…</option>
					{#each data.types as t (t.id)}<option value={t.id}>{t.name} — {t.category}</option>{/each}
				</select>
			</div>
			<div class="field"><label for="rq-notes">Notes for engineering</label><textarea id="rq-notes" name="notes" maxlength="1000" placeholder="Why the centre needs this device…"></textarea></div>
			{#if form?.error}<div class="alert alert-critical" style="margin-top:10px"><Icon name="alert" size={15} /><span>{form.error}</span></div>{/if}
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (showRequest = false)}>Cancel</button>
			<button class="btn btn-primary" form="request-device"><Icon name="send" size={14} /> Send request</button>
		{/snippet}
	</Modal>
{/if}

{#if showRegister}
	<Modal title="Register device" onclose={() => (showRegister = false)}>
		<form id="register-device" method="POST" action="?/register" use:enhance={toastEnhance({ onSuccess: () => (showRegister = false), reset: true })}>
			<div class="field">
				<label for="rg-type">Device type</label>
				<select id="rg-type" name="deviceTypeId" required>
					<option value="">Select a device type…</option>
					{#each data.types as t (t.id)}<option value={t.id}>{t.name} — {t.category}</option>{/each}
				</select>
			</div>
			<div class="field"><label for="rg-serial">Serial number</label><input id="rg-serial" name="serialNumber" type="text" required /></div>
			<div class="field"><label for="rg-fw">Firmware version</label><input id="rg-fw" name="firmwareVersion" type="text" placeholder="e.g. 2.3.1" /></div>
			<div class="field">
				<label for="rg-centre">Centre</label>
				<select id="rg-centre" name="locationId"><option value="">In stock (set up later)</option>{#each data.centres as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select>
			</div>
			<div class="field"><label for="rg-loc">Room / bay</label><input id="rg-loc" name="location" type="text" placeholder="e.g. Therapy Bay 2" /></div>
			<div class="field-hint">A device code such as PLUTO-004 is generated automatically.</div>
			{#if form?.error}<div class="alert alert-critical" style="margin-top:10px"><Icon name="alert" size={15} /><span>{form.error}</span></div>{/if}
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (showRegister = false)}>Cancel</button>
			<button class="btn btn-primary" form="register-device">Register device</button>
		{/snippet}
	</Modal>
{/if}

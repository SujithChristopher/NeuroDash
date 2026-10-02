<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { PATIENT_STATUSES } from '$lib/constants';
	import { adherenceTone, ageFrom, initials } from '$lib/utils';

	let { data } = $props();
	const PAGE_SIZE = 8;

	let q = $state('');
	let status = $state('all');
	let therapist = $state('all');
	let device = $state('all');
	let pageNo = $state(1);

	const isTherapist = $derived(data.user.role === 'THERAPIST');

	const filtered = $derived(
		data.patients.filter(
			(p) =>
				(!q ||
					p.name.toLowerCase().includes(q.toLowerCase()) ||
					p.displayCode.toLowerCase().includes(q.toLowerCase())) &&
				(status === 'all' || p.status === status) &&
				(therapist === 'all' || p.therapistId === therapist) &&
				(device === 'all' || p.deviceTypeIds.includes(device))
		)
	);
	// A therapist sees their own (primary) patients first, then the rest of the location below.
	const mine = $derived(filtered.filter((p) => p.therapistId === data.user.id));
	const others = $derived(filtered.filter((p) => p.therapistId !== data.user.id));
	const pages = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
	const current = $derived(Math.min(pageNo, pages));
	const items = $derived(filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE));

	function reset() {
		q = '';
		status = therapist = device = 'all';
		pageNo = 1;
	}
</script>

<PageHead
	title={isTherapist ? 'My Patients' : 'Patients'}
	sub="{filtered.length} patient{filtered.length === 1 ? '' : 's'} {isTherapist
		? `at your location (${mine.length} yours)`
		: data.user.role === 'ADMIN'
			? 'across all locations'
			: 'at your location'}."
>
	{#snippet actions()}
		{#if isTherapist}
			<a class="btn btn-primary" href="/patients/new"><Icon name="plus" size={15} /> New Patient</a>
		{/if}
	{/snippet}
</PageHead>

<div class="card">
	<div class="table-toolbar">
		<div class="search-box" style="width:240px">
			<Icon name="search" size={14} />
			<input placeholder="Search name or ID…" bind:value={q} oninput={() => (pageNo = 1)} />
		</div>
		<select class="filter-select" bind:value={status} onchange={() => (pageNo = 1)}>
			<option value="all">All statuses</option>
			{#each PATIENT_STATUSES as s (s)}<option value={s}>{s}</option>{/each}
		</select>
		{#if !isTherapist}
			<select class="filter-select" bind:value={therapist} onchange={() => (pageNo = 1)}>
				<option value="all">All therapists</option>
				{#each data.therapists as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
			</select>
		{/if}
		<select class="filter-select" bind:value={device} onchange={() => (pageNo = 1)}>
			<option value="all">All devices</option>
			{#each data.deviceTypes as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
		</select>
		<div class="spacer"></div>
		<button class="btn btn-ghost btn-sm" onclick={reset}><Icon name="filter" size={13} /> Reset</button>
	</div>
	{#if isTherapist}
		{@render table(mine, 'You have no patients yet')}
	{:else}
		{@render table(items, 'No patients match your filters')}
	{/if}
	{#if !isTherapist}
	<div class="table-foot">
		<span>
			Showing {items.length ? (current - 1) * PAGE_SIZE + 1 : 0}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}
		</span>
		<div class="pager">
			<button disabled={current <= 1} onclick={() => (pageNo = current - 1)} aria-label="Previous page" style="transform:rotate(180deg)">
				<Icon name="chevron" size={12} />
			</button>
			{#each Array.from({ length: Math.min(pages, 6) }, (_, i) => i + 1) as n (n)}
				<button class:active={n === current} onclick={() => (pageNo = n)}>{n}</button>
			{/each}
			<button disabled={current >= pages} onclick={() => (pageNo = current + 1)} aria-label="Next page">
				<Icon name="chevron" size={12} />
			</button>
		</div>
	</div>
	{/if}
</div>
{#snippet table(list: typeof items, empty: string)}
	<div class="table-wrap">
		<table class="dt">
			<thead>
				<tr><th>Patient</th><th>Current Plan</th><th>Status</th><th>Adherence</th><th></th></tr>
			</thead>
			<tbody>
				{#each list as p (p.id)}
									{@const age = ageFrom(p.dob)}
					<tr class="clickable" onclick={() => goto(`/patients/${p.id}`)}>
						<td>
							<div style="display:flex;align-items:center;gap:10px">
								<div class="ph-av" style="width:34px;height:34px;font-size:13px;border-radius:9px">
									{initials(p.name)}
								</div>
								<div>
									<div class="dt-name">{p.name}</div>
									<div class="dt-sub">
										{p.name !== p.displayCode ? `${p.displayCode} · ` : ''}{age != null ? `${age}${p.gender?.[0] ?? ''} · ` : ''}{p.therapistName}
									</div>
								</div>
							</div>
						</td>
						<td>
							{#if p.plan}
								<div class="dt-name" style="font-weight:500;font-size:13px">{p.plan.name}</div>
								<div class="dt-sub">Day {p.plan.currentDay}/{p.plan.durationDays}</div>
							{:else}
								<span class="muted">No active plan</span>
							{/if}
						</td>
						<td>
							<Badge text={p.status} />
							{#if p.liveDevice}<span class="live-pill" title="Training now on {p.liveDevice}"><span class="live-dot"></span>In session · {p.liveDevice}</span>{/if}
						</td>
						<td style="min-width:110px">
							{#if p.adherence != null}
								<Badge text="{p.adherence}%" tone={adherenceTone(p.adherence)} />
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td class="row-chevron"><Icon name="chevron" size={14} /></td>
					</tr>
				{:else}
					<tr>
						<td colspan="5">
							<EmptyState icon="users" title={empty} sub="Try adjusting your search or filters." />
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#if isTherapist}
	<div class="section-title-row" style="margin-top:22px">
		<h2>Other patients at your location</h2>
		<span class="muted" style="font-size:12px">managed by other therapists · {others.length}</span>
	</div>
	<div class="card">{@render table(others, 'No other patients at your location')}</div>
{/if}

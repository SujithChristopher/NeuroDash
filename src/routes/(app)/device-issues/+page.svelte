<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IssueCard from '$lib/components/IssueCard.svelte';
	import ReportIssueModal from '$lib/components/ReportIssueModal.svelte';
	import RequestActions from '$lib/components/RequestActions.svelte';
	import { fmtDateShort } from '$lib/utils';

	let { data } = $props();
	let reporting = $state(false);
</script>

<PageHead title="Device Issues" sub="Issue queue, investigation workflow, and pending device clearance requests.">
	{#snippet actions()}
		{#if data.canAct}
			<button class="btn btn-primary" onclick={() => (reporting = true)}><Icon name="alert" size={15} /> Report Issue</button>
		{/if}
	{/snippet}
</PageHead>

{#if data.pending.length}
	<div class="section-title-row" style="margin-top:0"><h2>Pending device requests</h2></div>
	<div class="card" style="margin-bottom:20px">
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Requested By</th><th>Centre</th><th>Device Type</th><th>Requested</th><th></th></tr></thead>
				<tbody>
					{#each data.pending as r (r.id)}
						<tr>
							<td>{r.therapist}</td>
							<td class="mono">{r.centre}</td>
							<td>{r.deviceType.name}</td>
							<td class="mono">{fmtDateShort(r.requestedAt)}</td>
							<td>{#if data.canAct}<RequestActions request={r} available={data.available} />{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<div class="section-title-row"><h2>Open issue queue</h2><span class="muted" style="font-size:12px">{data.open.length} unresolved</span></div>
<div class="grid grid-4" style="margin-bottom:18px">
	{#each ['Critical', 'High', 'Medium', 'Low'] as s (s)}
		<div class="card card-pad">
			<div class="k-label">{s} severity</div>
			<div class="k-val" style="font-size:22px;margin-top:6px">{data.open.filter((i) => i.severity === s).length}</div>
		</div>
	{/each}
</div>
{#each data.open as i (i.id)}
	<IssueCard issue={i} role={data.user.role} />
{:else}
	<div class="card"><EmptyState icon="check" title="No unresolved device issues" sub="The fleet is currently clear of open issues." /></div>
{/each}

<div class="section-title-row"><h2>Recently closed</h2></div>
{#each data.closed as i (i.id)}
	<IssueCard issue={i} role={data.user.role} />
{:else}
	<div class="card"><EmptyState icon="history" title="No closed issues yet" /></div>
{/each}

{#if reporting}<ReportIssueModal devices={data.devices} onclose={() => (reporting = false)} />{/if}

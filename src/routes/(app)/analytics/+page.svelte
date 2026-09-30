<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import ProgramPanel from '$lib/components/ProgramPanel.svelte';
	import FleetPanel from '$lib/components/FleetPanel.svelte';
	import { fmtDateTime } from '$lib/utils';

	let { data } = $props();
	const role = $derived(data.user.role);

	const TITLES = {
		THERAPIST: ['Analytics', 'Patient and therapy analytics for your location.'],
		CONSULTANT: ['Analytics', 'Patient and therapy analytics for your location.'],
		ENGINEER: ['Device Operations Console', 'Fleet health, issue queue and utilization across all connected rehabilitation devices.'],
		ADMIN: ['System Overview', 'Organization-wide, read-only oversight of clinical and device operations.']
	} as const;
</script>

<PageHead title={TITLES[role][0]} sub={TITLES[role][1]}>
	{#snippet actions()}
		{#if role === 'ENGINEER' && data.fleet}
			<a class="btn btn-primary" href="/device-issues"><Icon name="alert" size={15} /> Issue Queue ({data.fleet.openIssues})</a>
		{/if}
	{/snippet}
</PageHead>

{#if data.program && data.inflow}
	<ProgramPanel program={data.program} inflow={data.inflow} range={data.range} />
{/if}

{#if data.fleet}
	{#if role === 'ADMIN'}<div class="section-title-row"><h2>Device fleet</h2></div>{/if}
	<FleetPanel fleet={data.fleet} showStatusMix={role === 'ADMIN'} />
{/if}

{#if data.audit}
	<div class="section-title-row">
		<h2>Recent audit activity</h2>
		<a class="link-btn" href="/audit-log">Full audit log <Icon name="chevron" size={12} /></a>
	</div>
	<div class="card">
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Timestamp</th></tr></thead>
				<tbody>
					{#each data.audit as a (a.id)}
						<tr>
							<td class="dt-name">{a.user}</td><td><Badge text={a.role} tone="neutral" /></td><td>{a.action}</td>
							<td class="mono">{a.entity}</td><td class="mono">{fmtDateTime(a.at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

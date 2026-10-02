<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import KpiCard from '$lib/components/KpiCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toastEnhance } from '$lib/enhance';
	import { fmtDateTime, timeAgo } from '$lib/utils';

	let { data, form } = $props();
	let busy = $state(false);

	const ago = (s: number) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);
</script>

<PageHead title="Data Sync" sub="Training data from the laptops is read from the local server's folder and stored for charts, stars and reports.">
	{#snippet actions()}
		{#if data.canSync && data.configured}
			<form
				method="POST"
				action="?/sync"
				use:enhance={() => {
					busy = true;
					const done = toastEnhance();
					return async (args) => {
						await done()(args as never);
						busy = false;
					};
				}}
			>
				<button class="btn btn-primary" disabled={busy}><Icon name="activity" size={15} /> {busy ? 'Syncing…' : 'Sync now'}</button>
			</form>
		{/if}
	{/snippet}
</PageHead>

{#if !data.configured}
	<div class="alert alert-warning">
		<Icon name="alert" size={15} />
		<span>The local server folder is not set up. Add <span class="mono">NEURODASH_DATA_DIR</span> to <span class="mono">.env</span> (the same folder as <span class="mono">DATA_FOLDER</span> in <span class="mono">patients_store.py</span>) and restart the app.</span>
	</div>
{:else}
	{#if form && 'error' in form && form.error}
		<div class="alert alert-critical" style="margin-bottom:16px"><Icon name="alert" size={15} /><span>{form.error}</span></div>
	{/if}

	<div class="grid grid-4" style="margin-bottom:20px">
		<KpiCard label="Files imported" value={data.totals.ok} icon="file" tone="good" />
		<KpiCard label="Sessions from devices" value={data.totals.sessions} icon="activity" tone="accent" />
		<KpiCard label="Stars earned" value={data.totals.stars} icon="star" tone="warning" />
		<KpiCard label="Needs attention" value={data.totals.unmatched + data.totals.error} icon="alert" tone={data.totals.unmatched + data.totals.error ? 'critical' : 'good'} sub="{data.totals.unmatched} unmatched · {data.totals.error} errors" />
	</div>

	<div class="card card-pad" style="margin-bottom:20px">
		<div class="kv-list">
			<div class="kv-row"><span class="kl">Data folder</span><span class="kv mono">{data.root}</span></div>
			<div class="kv-row"><span class="kl">Automatic scan</span><span class="kv">{data.intervalSeconds ? `every ${data.intervalSeconds} s` : 'off (use Sync now)'}</span></div>
			<div class="kv-row">
				<span class="kl">Last scan</span>
				<span class="kv">
					{#if data.lastRun}
						{timeAgo(data.lastRun.at)} · {data.lastRun.scanned} checked, {data.lastRun.ingested} imported, {data.lastRun.sessions} sessions
						{#if data.lastRun.error}<span style="color:var(--critical)"> · {data.lastRun.error}</span>{/if}
					{:else}Not since the app started{/if}
				</span>
			</div>
			<div class="kv-row"><span class="kl">Patient list version (patients.json)</span><span class="kv mono">{data.registryVersion ?? '—'}</span></div>
		</div>
	</div>

	<div class="section-title-row" style="margin-top:0"><h2>Training now</h2><span class="muted" style="font-size:12px">patients whose session file arrived in the last few minutes (laptops are told these are in use)</span></div>
	<div class="card card-pad" style="margin-bottom:20px">
		{#if data.training.length === 0}
			<span class="muted">Nobody is training right now.</span>
		{:else}
			{#each data.training as t (t.code)}
				<span class="live-pill" style="margin:0 8px 6px 0"><span class="live-dot"></span>{t.code} · {t.device} · {t.secondsAgo < 90 ? 'just now' : `${Math.round(t.secondsAgo / 60)} min ago`}</span>
			{/each}
		{/if}
	</div>

	<div class="section-title-row"><h2>Laptops</h2><span class="muted" style="font-size:12px">from devices.json (heartbeat on every sync request)</span></div>
	<div class="card" style="margin-bottom:20px">
		{#if data.laptops.length === 0}
			<EmptyState icon="device" title="No laptop has connected yet" sub="A laptop appears here after its first sync request." />
		{:else}
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>Laptop</th><th>Status</th><th>Last seen</th><th>Patient list</th><th>Address</th></tr></thead>
					<tbody>
						{#each data.laptops as l (l.device)}
							<tr>
								<td class="dt-name mono">{l.device}</td>
								<td><Badge text={l.state === 'online' ? 'Online' : 'Offline'} tone={l.state === 'online' ? 'good' : 'neutral'} /></td>
								<td>{Number.isFinite(l.secondsAgo) ? ago(l.secondsAgo) : '—'}</td>
								<td>
									{#if l.upToDate}<Badge text="Up to date" tone="good" />
									{:else}<Badge text="Outdated (v{l.version})" tone="warning" />{/if}
								</td>
								<td class="mono">{l.ip ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="section-title-row"><h2>Files</h2><span class="muted" style="font-size:12px">most recent 100</span></div>
	<div class="card">
		{#if data.files.length === 0}
			<EmptyState icon="file" title="No files received yet" sub="sessions.csv and configdata.csv uploads appear here once the laptops send them." />
		{:else}
			<div class="table-wrap">
				<table class="dt">
					<thead><tr><th>File</th><th>Patient</th><th>Device</th><th>Rows</th><th>Status</th><th>Processed</th></tr></thead>
					<tbody>
						{#each data.files as f (f.id)}
							<tr>
								<td class="mono">{f.path}</td>
								<td class="mono">{f.patientCode ?? '—'}</td>
								<td>{f.device ?? '—'}</td>
								<td class="mono">{f.rows}</td>
								<td>
									<Badge text={f.status === 'ok' ? 'Imported' : f.status === 'unmatched' ? 'Unmatched' : 'Error'} tone={f.status === 'ok' ? 'good' : f.status === 'unmatched' ? 'warning' : 'critical'} />
									{#if f.message}<div class="dt-sub">{f.message}</div>{/if}
								</td>
								<td class="mono">{fmtDateTime(f.at)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}

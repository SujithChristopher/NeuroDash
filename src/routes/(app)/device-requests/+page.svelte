<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RequestActions from '$lib/components/RequestActions.svelte';
	import { toast } from '$lib/stores/toast';
	import { fmtDateShort } from '$lib/utils';

	let { data, form } = $props();
	let showNew = $state(false);

	let last: string | undefined;
	$effect(() => {
		const m = (form as { message?: string } | null)?.message;
		if (m && m !== last) toast(m);
		last = m;
	});
</script>

<PageHead
	title="Device Requests"
	sub={data.isEngineer
		? 'Review each centre requests, clear them and set up a unit at the centre.'
		: `Request rehabilitation devices for ${data.centre ?? 'your centre'} and track engineer clearance.`}
>
	{#snippet actions()}
		{#if !data.isEngineer}
			<button class="btn btn-primary" onclick={() => (showNew = !showNew)}>
				<Icon name="plus" size={15} /> Request Device
			</button>
		{/if}
	{/snippet}
</PageHead>

{#if !data.isEngineer && showNew}
	<form
		class="card card-pad"
		style="margin-bottom:18px"
		method="POST"
		action="?/request"
		use:enhance={() => async ({ result, update }) => {
			await update();
			if (result.type === 'success') showNew = false;
		}}
	>
		<div class="form-grid">
			<div class="field">
				<label for="dr-type">Device type</label>
				<select id="dr-type" name="deviceTypeId" required>
					<option value="">Select a device type…</option>
					{#each data.deviceTypes as t (t.id)}<option value={t.id}>{t.name} — {t.category}</option>{/each}
				</select>
			</div>
			<div class="field full"><label for="dr-notes">Notes for engineering</label><textarea id="dr-notes" name="notes" maxlength="1000" placeholder="Why the centre needs this device…"></textarea></div>
		</div>
		{#if form?.error}<div class="alert alert-critical" style="margin-bottom:12px"><Icon name="alert" size={15} /><span>{form.error}</span></div>{/if}
		<div style="display:flex;justify-content:flex-end;gap:10px">
			<button type="button" class="btn btn-secondary" onclick={() => (showNew = false)}>Cancel</button>
			<button class="btn btn-primary"><Icon name="send" size={14} /> Send Request</button>
		</div>
	</form>
{/if}

{#if !data.isEngineer}
	<div class="alert alert-info" style="margin-bottom:18px">
		<Icon name="info" size={15} />
		<span>A device must be <b>cleared by an engineer</b>, who then sets up a unit at your centre. Once it is set up you can raise issues for it and follow its history. You will be notified at each step.</span>
	</div>
{/if}

<div class="card">
	<div class="table-wrap">
		<table class="dt">
			<thead>
				<tr>
					<th>Centre</th><th>Device Type</th>{#if data.isEngineer}<th>Requested By</th>{/if}<th>Requested</th><th>Engineer</th><th>Status</th>{#if data.isEngineer}<th></th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each data.requests as r (r.id)}
					<tr>
						<td>{r.location.name}{#if r.notes}<div class="dt-sub">{r.notes}</div>{/if}</td>
						<td>{r.deviceType.name} — {r.deviceType.category}</td>
						{#if data.isEngineer}<td>{r.therapist}</td>{/if}
						<td class="mono">{fmtDateShort(r.requestedAt)}</td>
						<td>{r.engineer ?? ''}{#if !r.engineer}<span class="muted">Unassigned</span>{/if}</td>
						<td><Badge text={r.status} /></td>
						{#if data.isEngineer}<td><RequestActions request={r} available={data.available} /></td>{/if}
					</tr>
				{:else}
					<tr><td colspan="7"><EmptyState icon="device" title="No device requests yet" sub={data.isEngineer ? '' : 'Request a device above to begin the clearance workflow.'} /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

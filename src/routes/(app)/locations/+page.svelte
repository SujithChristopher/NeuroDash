<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let { data, form } = $props();
</script>

<PageHead
	title="Locations"
	sub="Therapists and consultants are each assigned to one location. A location's staff see every patient registered there."
/>

<div class="card card-pad" style="margin-bottom:18px">
	<form method="POST" action="?/create" use:enhance style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
		<div class="field" style="margin:0;flex:1;min-width:220px">
			<label for="loc-name">New location</label>
			<input id="loc-name" name="name" type="text" placeholder="e.g. East Wing Clinic" required />
		</div>
		<button class="btn btn-primary"><Icon name="plus" size={15} /> Add location</button>
	</form>
	{#if form?.error}
		<div class="alert alert-critical" style="margin-top:12px">
			<Icon name="alert" size={15} /><span>{form.error}</span>
		</div>
	{/if}
</div>

<div class="card">
	{#if data.locations.length === 0}
		<EmptyState icon="flag" title="No locations yet" sub="Add one above to start assigning staff." />
	{:else}
		<div class="table-wrap">
			<table class="dt">
				<thead><tr><th>Location</th><th>Staff</th><th></th></tr></thead>
				<tbody>
					{#each data.locations as l (l.id)}
						<tr>
							<td class="dt-name">{l.name}</td>
							<td>{l.staff} {l.staff === 1 ? 'user' : 'users'}</td>
							<td style="text-align:right">
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={l.id} />
									<button class="btn btn-secondary btn-sm" disabled={l.staff > 0}>Delete</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

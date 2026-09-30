<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { toast } from '$lib/stores/toast';

	let { data, form } = $props();

	const groups = [
		['THERAPIST', 'Therapists'],
		['CONSULTANT', 'Consultants'],
		['ENGINEER', 'Engineers'],
		['ADMIN', 'Administrators']
	] as const;

	let showCreate = $state(false);
	let role = $state<'THERAPIST' | 'CONSULTANT' | 'ENGINEER'>('THERAPIST');
	let reveal = $state<{ name: string; email: string; password: string } | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (form?.tempPassword) {
			reveal = { name: form.tempFor!, email: form.tempEmail!, password: form.tempPassword };
			if (form.created) showCreate = false;
		}
	});

	function scope(u: (typeof data.users)[number]) {
		if (u.role === 'THERAPIST') return `${u.patients} patients`;
		if (u.role === 'ENGINEER') return `${u.openIssues} open issues`;
		if (u.role === 'CONSULTANT') return 'Read-only oversight (notes only)';
		return 'Full system oversight (read-only)';
	}

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		toast('Copied to clipboard', 'info');
	}
</script>

<PageHead
	title="Users"
	sub="All provisioned NeuroDash accounts. Roles and locations are assigned here; there is no public registration."
>
	{#snippet actions()}
		<button class="btn btn-primary" onclick={() => (showCreate = true)}>
			<Icon name="plus" size={15} /> Create account
		</button>
	{/snippet}
</PageHead>

{#each groups as [r, label] (r)}
	{@const list = data.users.filter((u) => u.role === r)}
	<div class="section-title-row">
		<h2>{label}</h2><span class="muted" style="font-size:12px">{list.length}</span>
	</div>
	<div class="card" style="margin-bottom:20px">
		<div class="table-wrap">
			<table class="dt">
				<thead>
					<tr>
						<th>Name</th><th>Title</th><th>Email</th><th>Location</th><th>Scope</th><th>Status</th><th></th>
					</tr>
				</thead>
				<tbody>
					{#each list as u (u.id)}
						<tr>
							<td>
								<div style="display:flex;align-items:center;gap:9px">
									<div class="av-sm" style="background:var(--accent-soft);color:var(--accent-soft-ink)">
										{u.initials ?? u.name[0]}
									</div>
									<div>
										<div class="dt-name">{u.name}</div>
										<div class="dt-sub mono">{u.displayCode}</div>
									</div>
								</div>
							</td>
							<td class="muted">{u.title ?? '—'}</td>
							<td class="mono">{u.email}</td>
							<td>{u.location ?? '—'}</td>
							<td>{scope(u)}</td>
							<td>
								{#if u.mustResetPassword}
									<Badge text="Password reset pending" tone="warning" />
								{:else}
									<Badge text="Active" tone="good" />
								{/if}
							</td>
							<td style="text-align:right">
								<form method="POST" action="?/resetPassword" use:enhance>
									<input type="hidden" name="id" value={u.id} />
									<button class="btn btn-secondary btn-sm">Reset password</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/each}

{#if showCreate}
	<Modal title="Create account" onclose={() => (showCreate = false)}>
		<form
			id="create-user"
			method="POST"
			action="?/create"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update({ reset: false });
					busy = false;
				};
			}}
		>
			<div class="field">
				<label for="cu-name">Full name</label>
				<input id="cu-name" name="name" type="text" required />
			</div>
			<div class="field">
				<label for="cu-email">Email</label>
				<input id="cu-email" name="email" type="email" required />
			</div>
			<div class="field">
				<label for="cu-role">Role</label>
				<select id="cu-role" name="role" bind:value={role}>
					<option value="THERAPIST">Therapist</option>
					<option value="CONSULTANT">Consultant</option>
					<option value="ENGINEER">Engineer</option>
				</select>
			</div>
			<div class="field">
				<label for="cu-title">Title</label>
				<input id="cu-title" name="title" type="text" />
			</div>
			{#if role !== 'ENGINEER'}
				<div class="field">
					<label for="cu-loc">Location</label>
					<select id="cu-loc" name="locationId" required>
						<option value="">Select a location…</option>
						{#each data.locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
					</select>
					<div class="field-hint">Drives which patients this user can see.</div>
				</div>
			{/if}
			{#if form?.createError}
				<div class="alert alert-critical"><Icon name="alert" size={15} /><span>{form.createError}</span></div>
			{/if}
		</form>
		{#snippet footer()}
			<button class="btn btn-secondary" onclick={() => (showCreate = false)}>Cancel</button>
			<button class="btn btn-primary" form="create-user" disabled={busy}>Create account</button>
		{/snippet}
	</Modal>
{/if}

{#if reveal}
	<Modal title="Temporary password" onclose={() => (reveal = null)}>
		<p class="subtle" style="margin-bottom:12px">
			Share this with <b>{reveal.name}</b> ({reveal.email}). It is shown only once and must be changed at first
			sign-in.
		</p>
		<div class="confirm-box" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
			<span class="mono" style="font-size:16px;font-weight:600;letter-spacing:.04em">{reveal.password}</span>
			<button class="btn btn-secondary btn-sm" onclick={() => copy(reveal!.password)}>Copy</button>
		</div>
		{#snippet footer()}
			<button class="btn btn-primary" onclick={() => (reveal = null)}>Done</button>
		{/snippet}
	</Modal>
{/if}

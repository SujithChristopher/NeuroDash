<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { ROLE_LABEL } from '$lib/utils';

	let { data, form } = $props();

	let email = $state('');
	let mode = $state<'signin' | 'forgot'>('signin');
	let busy = $state(false);

	const mustReset = $derived(data.mustResetPassword || form?.mustResetPassword === true);

	$effect(() => {
		const prev = (form as { email?: string } | null)?.email;
		if (prev) email = prev;
	});

	function submitting() {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	}
</script>

<div class="login-wrap">
	<div class="login-visual">
		<div class="brand">
			<Logo size={34} />
			<div class="txt">
				<div class="brand-name">NeuroDash</div>
				<div class="brand-org">Bio Rehabilitation Group</div>
			</div>
		</div>
		<div class="pitch">
			<h1>One connected record for every stroke recovery, from first assessment to discharge.</h1>
			<p>
				NeuroDash unifies rehabilitation devices, clinical assessments, therapy plans and progress
				analytics into a single clinical workspace for lab-based physical therapy and stroke
				rehabilitation.
			</p>
			<div class="flow-strip">
				<span class="node">Assessment</span><span class="arrow">→</span><span class="node">Therapy Plan</span>
				<span class="arrow">→</span><span class="node">Device</span><span class="arrow">→</span>
				<span class="node">Session Data</span><span class="arrow">→</span><span class="node">Progress</span>
			</div>
		</div>
		<div>
			<div class="stat-row">
				<div><div class="k">{data.stats.patients}</div><div class="l">Active Patients</div></div>
				<div><div class="k">{data.stats.devices}</div><div class="l">Connected Devices</div></div>
				<div><div class="k">{data.stats.deviceTypes}</div><div class="l">Device Types</div></div>
			</div>
			<div class="foot" style="margin-top:22px">
				Secure clinical platform · Role-based access · Full audit trail
			</div>
			<div class="cmc">
				<img src="/cmc-logo.png" alt="Christian Medical College, Vellore" width="64" height="64" />
				<span>Christian Medical College, Vellore</span>
			</div>
		</div>
	</div>

	<div class="login-panel">
		<div class="login-card">
			<img class="cmc-mobile" src="/cmc-logo.png" alt="Christian Medical College, Vellore" width="56" height="56" />
			{#if mustReset}
				<div class="lc-head">
					<div class="eyebrow">First Sign-In</div>
					<h2>Set a new password</h2>
					<div class="lc-sub">
						You signed in with a temporary password. Choose a new one to continue.
					</div>
				</div>
				<form method="POST" action="?/setPassword" use:enhance={submitting}>
					<div class="field">
						<label for="np">New password</label>
						<input id="np" name="password" type="password" autocomplete="new-password" required />
						<div class="field-hint">At least 8 characters.</div>
					</div>
					<div class="field">
						<label for="cp">Confirm password</label>
						<input id="cp" name="confirm" type="password" autocomplete="new-password" required />
					</div>
					{#if form?.error}
						<div class="alert alert-critical" style="margin-bottom:14px">
							<Icon name="alert" size={15} /><span>{form.error}</span>
						</div>
					{/if}
					<button class="btn btn-primary btn-block" disabled={busy}>
						<Icon name="shield" size={15} /> Save password & continue
					</button>
				</form>
			{:else if mode === 'forgot'}
				<div class="lc-head">
					<div class="eyebrow">Account Recovery</div>
					<h2>Forgot password</h2>
					<div class="lc-sub">
						Enter your account email. Your administrator will be notified and can share a temporary
						password.
					</div>
				</div>
				<form method="POST" action="?/forgotPassword" use:enhance={submitting}>
					<div class="field">
						<label for="fe">Email</label>
						<input id="fe" name="email" type="email" autocomplete="email" required bind:value={email} />
					</div>
					{#if form?.forgotMessage}
						<div class="alert alert-good" style="margin-bottom:14px">
							<Icon name="check" size={15} /><span>{form.forgotMessage}</span>
						</div>
					{/if}
					{#if form?.forgotError}
						<div class="alert alert-critical" style="margin-bottom:14px">
							<Icon name="alert" size={15} /><span>{form.forgotError}</span>
						</div>
					{/if}
					<button class="btn btn-primary btn-block" disabled={busy}>Request reset</button>
					<div style="text-align:center;margin-top:14px">
						<button type="button" class="link-btn" onclick={() => (mode = 'signin')}>
							Back to sign in
						</button>
					</div>
				</form>
			{:else}
				<div class="lc-head">
					<div class="eyebrow">Clinical Sign-In</div>
					<h2>Welcome back</h2>
					<div class="lc-sub">
						Sign in with your NeuroDash credentials. Accounts are provisioned by your system
						administrator.
					</div>
				</div>

				{#if data.demoUsers.length}
					<div class="field">
						<label for="demo-accounts">Demo account</label>
						<div class="demo-accounts" id="demo-accounts">
							{#each data.demoUsers as u (u.email)}
								<button
									type="button"
									class="demo-acct"
									class:active={email === u.email}
									onclick={() => (email = u.email)}
								>
									<div class="da-role">{ROLE_LABEL[u.role]}</div>
									<div class="da-name">{u.name}</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<form method="POST" action="?/login" use:enhance={submitting}>
					<div class="field">
						<label for="email">Email</label>
						<input id="email" name="email" type="email" autocomplete="username" required bind:value={email} />
					</div>
					<div class="field">
						<label for="pw">Password</label>
						<input id="pw" name="password" type="password" autocomplete="current-password" required />
						{#if data.showDemoHint}
							<div class="field-hint">Demo accounts use the password <span class="mono">neurodash123</span>.</div>
						{/if}
					</div>
					<div class="row-check">
						<span></span>
						<button type="button" class="link-btn" onclick={() => (mode = 'forgot')}>
							Forgot password?
						</button>
					</div>
					{#if form?.error}
						<div class="alert alert-critical" style="margin-bottom:14px">
							<Icon name="alert" size={15} /><span>{form.error}</span>
						</div>
					{/if}
					<button class="btn btn-primary btn-block" disabled={busy}>
						<Icon name="shield" size={15} /> Sign in
					</button>
				</form>
				<div class="login-alert">
					<Icon name="info" size={15} />
					<span>
						Public registration is disabled. All roles — Therapist, Consultant, Engineer, Admin — are
						provisioned internally.
					</span>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.cmc {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-top: 22px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-700);
	}
	.cmc img {
		flex-shrink: 0;
	}
	.cmc-mobile {
		display: none;
		margin-bottom: 14px;
	}
	@media (max-width: 860px) {
		.cmc-mobile {
			display: block;
		}
	}
</style>

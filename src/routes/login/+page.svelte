<script lang="ts">
	import { goto } from '$app/navigation';
	import { login, currentUser } from '$lib/stores/auth';
	import { HOME } from '$lib/data/users';
	import Icon from '$lib/components/ui/Icon.svelte';

	let userid = $state('');
	let password = $state('');
	let remember = $state(true);
	let showPw = $state(false);
	let error = $state('');

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const result = login(userid, password, remember);
		if (!result.ok) {
			error = result.message;
			password = '';
			return;
		}
		error = '';
		const u = $currentUser!;
		goto('/' + HOME[u.role]);
	}
</script>

<div class="login">
	<div class="login-logo"><span class="logo"><Icon name="pulse" size={17} /></span>NeuroDash</div>
	<form class="login-card" onsubmit={handleSubmit} autocomplete="on">
		<h1>Sign in</h1>
		<p>Welcome back. Enter your details to continue.</p>
		{#if error}
			<div class="login-err"><Icon name="alert" size={15} /><span>{error}</span></div>
		{/if}
		<div class="field">
			<label for="uid">User ID</label>
			<input id="uid" bind:value={userid} autocomplete="username" placeholder="firstname.lastname" required />
		</div>
		<div class="field">
			<label for="pwd">Password</label>
			<div class="pw">
				<input id="pwd" type={showPw ? 'text' : 'password'} bind:value={password} autocomplete="current-password" required />
				<button type="button" onclick={() => (showPw = !showPw)}>{showPw ? 'Hide' : 'Show'}</button>
			</div>
		</div>
		<div class="login-row">
			<label><input type="checkbox" bind:checked={remember} style="accent-color:var(--brand)" /> Keep me signed in</label>
			<a href="/login" class="lnk" style="color:var(--brand)" onclick={(e) => e.preventDefault()}>Forgot password?</a>
		</div>
		<button class="btn pri block" type="submit" style="background:var(--brand)">Sign in</button>
	</form>
	<div class="login-foot"><span>© {new Date().getFullYear()} NeuroDash</span><span>v2.0</span></div>
</div>

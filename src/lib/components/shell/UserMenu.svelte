<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { ROLE_LABEL } from '$lib/utils';

	let {
		user,
		onclose
	}: {
		user: { name: string; title: string | null; role: keyof typeof ROLE_LABEL };
		onclose: () => void;
	} = $props();
</script>

<div class="dropdown" style="width:230px">
	<div style="padding:14px 16px;border-bottom:1px solid var(--border)">
		<div style="font-weight:700;font-size:13px">{user.name}</div>
		{#if user.title}<div style="font-size:11.5px;color:var(--ink-500)">{user.title}</div>{/if}
		<div style="margin-top:6px"><Badge text={ROLE_LABEL[user.role]} tone="accent" /></div>
	</div>
	<a class="side-link" href="/profile" onclick={onclose} style="padding:11px 16px">
		<Icon name="users" /><span class="lbl">My Profile</span>
	</a>
	<form method="POST" action="/logout">
		<button class="side-link" style="padding:11px 16px">
			<Icon name="logout" /><span class="lbl">Sign out</span>
		</button>
	</form>
</div>

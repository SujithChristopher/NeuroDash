<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { fmtDateTime } from '$lib/utils';

	let { data } = $props();

	async function markRead(id?: string) {
		await fetch('/api/notifications/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(id ? { id } : {})
		});
		await invalidateAll();
	}

	async function open(n: (typeof data.items)[number]) {
		await markRead(n.id);
		if (n.link?.page) await goto(`/${n.link.page}`);
	}
</script>

<PageHead title="Notifications" sub="Alerts and updates relevant to your role.">
	{#snippet actions()}
		<button class="btn btn-secondary btn-sm" onclick={() => markRead()}>Mark all read</button>
	{/snippet}
</PageHead>

<div class="tabs">
	<a class="tab-btn" class:active={data.filter === 'all'} href="?filter=all">All ({data.total})</a>
	<a class="tab-btn" class:active={data.filter === 'unread'} href="?filter=unread">Unread ({data.unread})</a>
</div>

<div class="card">
	{#if data.items.length === 0}
		<EmptyState icon="bell" title="No notifications" />
	{:else}
		{#each data.items as n (n.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="notif-item" class:unread={!n.isRead} onclick={() => open(n)} style="padding:16px 18px">
				<div
					class="notif-ic"
					style="background:var(--{n.tone}-soft, var(--surface-3));color:var(--{n.tone}, var(--ink-700))"
				>
					<Icon name={n.icon ?? 'bell'} size={16} />
				</div>
				<div style="flex:1">
					<div class="notif-title" style="font-size:13.5px">{n.title}</div>
					<div class="notif-desc" style="font-size:12.5px">{n.description}</div>
					<div class="notif-time">{fmtDateTime(n.createdAt)}</div>
				</div>
			</div>
		{/each}
	{/if}
</div>

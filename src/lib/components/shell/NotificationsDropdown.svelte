<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { timeAgo } from '$lib/utils';

	import type { NotificationItem } from '$lib/types';

	let {
		items,
		onchange,
		onclose
	}: { items: NotificationItem[]; onchange: () => void; onclose: () => void } = $props();

	async function markRead(id?: string) {
		await fetch('/api/notifications/read', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(id ? { id } : {})
		});
		onchange();
	}

	async function open(n: NotificationItem) {
		await markRead(n.id);
		onclose();
		if (n.link?.page) await goto(`/${n.link.page}`);
	}
</script>

<div class="dropdown">
	<div class="dropdown-head">
		<span>Notifications</span>
		{#if items.some((n) => !n.isRead)}
			<button class="link-btn" style="font-size:11.5px" onclick={() => markRead()}>Mark all read</button>
		{/if}
	</div>
	{#if items.length === 0}
		<EmptyState icon="bell" title="No notifications" sub="All caught up." />
	{:else}
		{#each items as n (n.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="notif-item" class:unread={!n.isRead} onclick={() => open(n)}>
				<div
					class="notif-ic"
					style="background:var(--{n.tone}-soft, var(--surface-3));color:var(--{n.tone}, var(--ink-700))"
				>
					<Icon name={n.icon ?? 'bell'} size={15} />
				</div>
				<div style="flex:1">
					<div class="notif-title">{n.title}</div>
					<div class="notif-desc">{n.description}</div>
					<div class="notif-time">{timeAgo(n.createdAt)}</div>
				</div>
			</div>
		{/each}
	{/if}
</div>

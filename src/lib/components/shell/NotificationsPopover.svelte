<script lang="ts">
	import type { User } from '$lib/data/users';
	import { notificationsRead, markRead, markAllRead } from '$lib/stores/ui';
	import { notifications } from './notifications';
	import { rel } from '$lib/data/seed';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { user, open, onClose }: { user: User; open: boolean; onClose: () => void } = $props();

	const items = $derived(notifications(user));
	const unread = $derived(items.filter((n) => !$notificationsRead.has(n.id)).length);

	function handleClick(id: string, href: string) {
		markRead(id);
		onClose();
		goto(href);
	}
</script>

{#if open}
	<div class="pop notif" style="right:16px;top:52px">
		<div class="notif-h">
			<b>Notifications</b>
			{#if unread}
				<span class="xs muted">{unread} unread</span>
				<button class="btn sm ghost" onclick={() => markAllRead(items.map((n) => n.id))}>Mark all read</button>
			{/if}
		</div>
		<div class="notif-b">
			{#if items.length === 0}
				<div class="empty">You're all caught up.</div>
			{:else}
				{#each items as n (n.id)}
					<div class="ni {$notificationsRead.has(n.id) ? '' : 'unread'}" onclick={() => handleClick(n.id, n.href)}>
						<div class="li" style="padding:0;border:0">
							<div class="ico {n.tone}">
								<Icon name={n.tone === 'crit' ? 'alert' : n.tone === 'good' ? 'check' : n.tone === 'warn' ? 'clock' : 'bell'} size={14} />
							</div>
						</div>
						<div class="grow">
							<div class="t">{n.title}</div>
							<div class="d">{n.desc}</div>
							<div class="w">{rel(n.date)}</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import CommandPalette from '$lib/components/shell/CommandPalette.svelte';
	import NotificationsPopover from '$lib/components/shell/NotificationsPopover.svelte';
	import UserMenu from '$lib/components/shell/UserMenu.svelte';
	import { unreadCount } from '$lib/components/shell/notifications';
	import { densityFor } from '$lib/stores/theme';
	import { commandPaletteOpen } from '$lib/stores/ui';

	let { data, children } = $props();
	const user = data.user;

	let notifOpen = $state(false);
	let userMenuOpen = $state(false);

	const currentPage = $derived(page.url.pathname.split('/').filter(Boolean)[0] ?? '');

	$effect(() => {
		document.body.dataset.role = user.role;
		document.body.dataset.density = densityFor(user.role);
	});
</script>

<div class="shell">
	<Sidebar
		{user}
		{currentPage}
		unreadCount={unreadCount(user)}
		onNotifClick={() => {
			notifOpen = !notifOpen;
			userMenuOpen = false;
		}}
		onSearchClick={() => commandPaletteOpen.set(true)}
		onUserClick={() => {
			userMenuOpen = !userMenuOpen;
			notifOpen = false;
		}}
	/>
	<div class="main">
		<main class="content">
			{@render children()}
		</main>
	</div>
</div>
<CommandPalette {user} />
<NotificationsPopover {user} open={notifOpen} onClose={() => (notifOpen = false)} />
<UserMenu {user} open={userMenuOpen} onClose={() => (userMenuOpen = false)} />

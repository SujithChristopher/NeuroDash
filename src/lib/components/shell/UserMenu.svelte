<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/data/users';
	import { theme, toggleTheme } from '$lib/stores/theme';
	import { logout } from '$lib/stores/auth';
	import { commandPaletteOpen } from '$lib/stores/ui';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { user, open, onClose }: { user: User; open: boolean; onClose: () => void } = $props();

	function signOut() {
		onClose();
		logout();
		goto('/login');
	}
	function openSearch() {
		onClose();
		commandPaletteOpen.set(true);
	}
</script>

{#if open}
	<div class="pop menu" style="right:16px;top:52px;width:230px">
		<div class="mh">
			<b>{user.name}</b>
			<span>{user.email}</span>
		</div>
		<div class="mi" style="cursor:default">
			<Icon name={$theme === 'dark' ? 'moon' : 'sun'} size={15} />
			<span class="grow">Theme</span>
			<div class="segs" style="padding:2px">
				<button type="button" class={$theme === 'dark' ? '' : 'on'} style="padding:2px 8px;font-size:12px" onclick={() => toggleTheme()}>Light</button>
				<button type="button" class={$theme === 'dark' ? 'on' : ''} style="padding:2px 8px;font-size:12px" onclick={() => toggleTheme()}>Dark</button>
			</div>
		</div>
		<button class="mi" onclick={openSearch}><Icon name="search" size={15} />Search<span class="kbd">Ctrl K</span></button>
		<hr />
		<button class="mi" onclick={signOut}><Icon name="logout" size={15} />Sign out</button>
	</div>
{/if}

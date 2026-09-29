<script lang="ts">
	import type { User } from '$lib/data/users';
	import { NAV, ROLE_LABEL } from '$lib/data/users';
	import { DB, scopeUnits, OPEN_FAULT } from '$lib/data/db';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	let {
		user,
		currentPage,
		unreadCount,
		onNotifClick,
		onSearchClick,
		onUserClick
	}: {
		user: User;
		currentPage: string;
		unreadCount: number;
		onNotifClick: () => void;
		onSearchClick: () => void;
		onUserClick: () => void;
	} = $props();

	function navCount(page: string): number {
		const mineU = scopeUnits(user).map((u) => u.id);
		if (page === 'service' && (user.role === 'engineer' || user.role === 'admin')) {
			return DB.faults.filter((f) => OPEN_FAULT(f) && mineU.includes(f.unitId)).length;
		}
		if (page === 'requests') {
			return DB.requests.filter((q) => q.status === 'Pending' && (user.role === 'admin' || (user.owns ?? []).includes(q.typeId))).length;
		}
		// "today" (therapist) and "review" (consultant) counts depend on patientMetrics(),
		// which lands with the Therapist/Consultant view sub-projects — 0 until then.
		return 0;
	}
</script>

<aside class="side">
	<div class="ws">
		<span class="logo"><Icon name="pulse" size={16} /></span>
		<div class="grow" style="min-width:0">
			<b>NeuroDash</b>
			<span class="nowrap" style="display:block;overflow:hidden;text-overflow:ellipsis">Neuro Rehab Unit</span>
		</div>
		<button class="icon-btn" title="Notifications" onclick={onNotifClick}>
			<Icon name="bell" size={17} />
			{#if unreadCount}<span class="dot"></span>{/if}
		</button>
	</div>
	<button class="searchbtn" onclick={onSearchClick}><Icon name="search" size={14} />Search<span class="kbd">Ctrl K</span></button>
	<nav class="nav">
		{#each NAV[user.role] as n (Array.isArray(n) ? n[0] : n)}
			{#if typeof n === 'string'}
				<div class="sec">{n.slice(1)}</div>
			{:else}
				{@const count = navCount(n[0])}
				<a href="/{n[0]}" class={n[0] === currentPage ? 'on' : ''}>
					<Icon name={n[2]} />
					<span>{n[1]}</span>
					{#if count}<span class="cnt">{count}</span>{/if}
				</a>
			{/if}
		{/each}
	</nav>
	<button class="userbtn" onclick={onUserClick}>
		<Avatar {user} />
		<div style="min-width:0;flex:1">
			<b>{user.name}</b>
			<span>{ROLE_LABEL[user.role]}</span>
		</div>
		<Icon name="chevd" size={14} />
	</button>
</aside>

<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import ReadOnlyBanner from '$lib/components/ReadOnlyBanner.svelte';
	import NotificationsDropdown from '$lib/components/shell/NotificationsDropdown.svelte';
	import type { NotificationItem } from '$lib/types';
	import UserMenu from '$lib/components/shell/UserMenu.svelte';
	import SearchModal from '$lib/components/shell/SearchModal.svelte';
	import { NAV_BY_ROLE, PAGE_TITLES, READ_ONLY_PAGES } from '$lib/navConfig';
	import { crumbDetail } from '$lib/stores/page';
	import { toast } from '$lib/stores/toast';
	import { ROLE_LABEL } from '$lib/utils';

	let { data, children } = $props();

	const user = $derived(data.user);
	const nav = $derived(NAV_BY_ROLE[user.role]);

	let collapsed = $state(false); // desktop: icon-only rail
	let navOpen = $state(false); // ≤900px: off-canvas drawer
	let dropdown = $state<'notif' | 'user' | null>(null);
	let searchOpen = $state(false);
	let notifications = $state<NotificationItem[]>([]);
	let unread = $state(0);

	$effect(() => {
		unread = data.unread;
	});

	const segment = $derived(page.url.pathname.split('/').filter(Boolean)[0] ?? '');
	const isActive = (to: string) =>
		to === '/' ? page.url.pathname === '/' : page.url.pathname === to || page.url.pathname.startsWith(to + '/');

	async function loadNotifications() {
		const res = await fetch('/api/notifications');
		if (!res.ok) return;
		const body = await res.json();
		notifications = body.items;
		unread = body.unread;
	}

	// Live data: when the local server has imported new device data, reload what the open page shows so lists and
	// charts update by themselves. Skipped while the tab is hidden (it catches up when you come back).
	let liveVersion: string | null = null;
	let livePresence: string | null = null;
	async function checkLive() {
		if (document.visibilityState !== 'visible') return;
		try {
			const res = await fetch('/api/live', { cache: 'no-store' });
			if (!res.ok) return;
			const { version, presence } = (await res.json()) as { version: string; presence?: string };
			const changed = liveVersion !== null && version !== liveVersion;
			const presenceChanged = livePresence !== null && (presence ?? '') !== livePresence;
			liveVersion = version;
			livePresence = presence ?? '';
			if (changed) {
				await invalidateAll();
				toast('New training data received. The dashboard has been updated.', 'info');
			} else if (presenceChanged) {
				await invalidateAll(); // someone started or stopped training: refresh the badges quietly
			}
		} catch {
			/* offline or restarting: try again on the next tick */
		}
	}

	onMount(() => {
		checkLive();
		const live = setInterval(checkLive, 10_000);
		const onVisible = () => checkLive();
		document.addEventListener('visibilitychange', onVisible);
		// The bell polls every ~30s (no websockets — spec §11).
		const t = setInterval(() => {
			fetch('/api/notifications?limit=1')
				.then((r) => (r.ok ? r.json() : null))
				.then((b) => b && (unread = b.unread));
		}, 30_000);
		return () => {
			clearInterval(t);
			clearInterval(live);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// Below 900px the sidebar is a drawer (see responsive.css); above it, the toggle collapses the rail.
	function toggleNav() {
		if (window.matchMedia('(max-width: 900px)').matches) navOpen = !navOpen;
		else collapsed = !collapsed;
	}

	afterNavigate(() => {
		navOpen = false;
		dropdown = null;
		crumbDetail.set(null);
	});

	function toggle(which: 'notif' | 'user') {
		dropdown = dropdown === which ? null : which;
		if (dropdown === 'notif') loadNotifications();
	}

	async function onNotifChange() {
		await loadNotifications();
		await invalidateAll();
	}

	function onWindowKey(e: KeyboardEvent) {
		const tag = (document.activeElement as HTMLElement | null)?.tagName;
		if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag ?? '') && !searchOpen) {
			e.preventDefault();
			searchOpen = true;
		}
		if (e.key === 'Escape') {
			dropdown = null;
			navOpen = false;
		}
	}

	function onWindowClick(e: MouseEvent) {
		if (!dropdown) return;
		const t = e.target as HTMLElement;
		if (!t.closest('.dropdown') && !t.closest('[data-dropdown-trigger]')) dropdown = null;
	}

	function badgeFor(to: string) {
		if (to === '/device-issues') return { n: data.navBadges.openIssues, kind: 'critical' as const };
		if (to === '/devices') return { n: data.navBadges.myOpenRequests, kind: 'pill' as const };
		return null;
	}
</script>

<svelte:window onkeydown={onWindowKey} onclick={onWindowClick} />

<div class="shell" class:collapsed class:nav-open={navOpen}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="nav-backdrop" onclick={() => (navOpen = false)}></div>
	<aside class="sidebar" id="app-nav" aria-label="Main navigation">
		<div class="side-brand">
			<Logo size={30} />
			<div class="txt">
				<div class="brand-name">NeuroDash</div>
				<div class="brand-org">Bio Rehab Group</div>
			</div>
		</div>
		<nav class="side-nav hidden-scroll">
			{#each nav as sec (sec.section ?? 'main')}
				{#if sec.section}<div class="side-section-label">{sec.section}</div>{/if}
				{#each sec.items as item (item.to)}
					{@const b = badgeFor(item.to)}
					<a class="side-link" class:active={isActive(item.to)} href={item.to}>
						<Icon name={item.icon} />
						<span class="lbl">{item.label}</span>
						{#if b && b.n}
							{#if b.kind === 'critical'}
								<span class="badge badge-critical badge-pill" style="padding:1px 7px">{b.n}</span>
							{:else}
								<span class="pill badge-pill">{b.n}</span>
							{/if}
						{/if}
					</a>
				{/each}
			{/each}
		</nav>
		<div class="sidebar-foot">
			<div class="role-chip">
				<div class="av">{user.initials ?? user.name[0]}</div>
				<div class="who">
					<div class="n">{user.name}</div>
					<div class="r">{ROLE_LABEL[user.role]}</div>
				</div>
				<form method="POST" action="/logout" style="margin-left:auto">
					<button class="collapse-btn" title="Sign out" aria-label="Sign out">
						<Icon name="logout" size={15} />
					</button>
				</form>
			</div>
		</div>
	</aside>

	<div>
		<header class="topbar">
			<button class="icon-btn" onclick={toggleNav} title="Toggle navigation" aria-label="Toggle navigation" aria-controls="app-nav" aria-expanded={navOpen}>
				<Icon name="layout" />
			</button>
			<div class="crumb">
				{#if $crumbDetail}
					<span>{PAGE_TITLES[segment] ?? 'Overview'}</span>
					<Icon name="chevron" size={11} />
					<b>{$crumbDetail}</b>
				{:else}
					<b>{PAGE_TITLES[segment] ?? 'Overview'}</b>
				{/if}
			</div>
			<button class="search-trigger" onclick={() => (searchOpen = true)}>
				<Icon name="search" size={14} />
				<span>Search patients, devices…</span><kbd>/</kbd>
			</button>
			<div class="top-actions">
				{#if user.role !== 'ADMIN'}
					<a class="icon-btn" href="/ai" title="AI Assistant" aria-label="AI Assistant">
						<Icon name="sparkle" />
					</a>
				{/if}
				<button
					class="icon-btn"
					data-dropdown-trigger
					onclick={() => toggle('notif')}
					title="Notifications"
					aria-label="Notifications"
				>
					<Icon name="bell" />
					{#if unread}<span class="dot"></span>{/if}
				</button>
				<button class="user-btn" data-dropdown-trigger onclick={() => toggle('user')} aria-label="User menu">
					<div class="av-sm">{user.initials ?? user.name[0]}</div>
				</button>
			</div>
			{#if dropdown === 'notif'}
				<NotificationsDropdown items={notifications} onchange={onNotifChange} onclose={() => (dropdown = null)} />
			{:else if dropdown === 'user'}
				<UserMenu {user} onclose={() => (dropdown = null)} />
			{/if}
		</header>
		<main class="content">
			{#if user.role === 'ADMIN' && READ_ONLY_PAGES.includes(segment)}
				<ReadOnlyBanner />
			{/if}
			{@render children()}
		</main>
	</div>
</div>

{#if searchOpen}
	<SearchModal onclose={() => (searchOpen = false)} />
{/if}

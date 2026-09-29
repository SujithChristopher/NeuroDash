<script lang="ts">
	import { goto } from '$app/navigation';
	import type { User } from '$lib/data/users';
	import { NAV } from '$lib/data/users';
	import { scopePatients, scopeUnits, pname, liveStatus } from '$lib/data/db';
	import { typeOf } from '$lib/data/reference';
	import { commandPaletteOpen } from '$lib/stores/ui';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { user }: { user: User } = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement;

	interface Item {
		group: string;
		iconName: string;
		title: string;
		sub: string;
		href: string;
		key: string;
	}

	function allItems(): Item[] {
		const pages: Item[] = NAV[user.role]
			.filter((n): n is [string, string, string] => Array.isArray(n))
			.map((n) => ({ group: 'Pages', iconName: n[2], title: n[1], sub: '', href: '/' + n[0], key: n[1] }));
		const patients: Item[] =
			user.role === 'engineer'
				? []
				: scopePatients(user).map((p) => ({
						group: 'Patients',
						iconName: 'user',
						title: pname(user, p),
						sub: 'MRN ' + p.mrn + ' · ' + p.status,
						href: '/patients/' + p.id,
						key: p.name + p.mrn + p.diagnosis
					}));
		const devices: Item[] =
			user.role === 'engineer' || user.role === 'admin'
				? scopeUnits(user).map((u) => ({
						group: 'Devices',
						iconName: 'robot',
						title: u.id,
						sub: typeOf(u.typeId)!.name + ' · ' + liveStatus(u),
						href: '/fleet/' + u.id,
						key: u.id + u.room + typeOf(u.typeId)!.name
					}))
				: [];
		return [...pages, ...patients, ...devices];
	}

	function filtered(): Item[] {
		const q = query.toLowerCase().trim();
		return allItems()
			.filter((x) => !q || (x.key || x.title).toLowerCase().includes(q))
			.slice(0, 12);
	}

	function close() {
		commandPaletteOpen.set(false);
		query = '';
		selected = 0;
	}
	function pick(i: number) {
		const items = filtered();
		if (items[i]) {
			close();
			goto(items[i].href);
		}
	}
	function handleKeydown(e: KeyboardEvent) {
		const items = filtered();
		if (e.key === 'ArrowDown') {
			selected = Math.min(items.length - 1, selected + 1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			selected = Math.max(0, selected - 1);
			e.preventDefault();
		} else if (e.key === 'Enter') pick(selected);
		else if (e.key === 'Escape') close();
	}
	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			commandPaletteOpen.set(true);
			queueMicrotask(() => inputEl?.focus());
		}
	}

	$effect(() => {
		if ($commandPaletteOpen) selected = 0;
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if $commandPaletteOpen}
	<div class="cmdk-scrim" onclick={(e) => e.target === e.currentTarget && close()}>
		<div class="cmdk">
			<input bind:this={inputEl} bind:value={query} onkeydown={handleKeydown} placeholder="Search patients, devices, pages…" />
			<div class="cmdk-list">
				{#if filtered().length === 0}
					<div class="empty">No results</div>
				{:else}
					{#each filtered() as item, i (item.group + item.title)}
						{#if i === 0 || filtered()[i - 1].group !== item.group}
							<div class="cmdk-g">{item.group}</div>
						{/if}
						<div class="cmdk-i {i === selected ? 'sel' : ''}" onclick={() => pick(i)}>
							<Icon name={item.iconName} size={15} />
							<span>{item.title}</span>
							<span class="sub">{item.sub}</span>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

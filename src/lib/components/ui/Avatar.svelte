<script lang="ts">
	import type { User } from '$lib/data/users';
	let { user, size = 'md' }: { user: User; size?: 'sm' | 'md' | 'lg' } = $props();
</script>

<span class="av {size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''}" title={user.name}>{user.initials}</span>

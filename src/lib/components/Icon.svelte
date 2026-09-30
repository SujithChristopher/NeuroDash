<script lang="ts">
	import { ICONS, type IconName } from '$lib/icons';

	let {
		name,
		size = 16,
		class: cls = ''
	}: { name: IconName | string; size?: number; class?: string } = $props();
</script>

<svg
	class={cls}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{@html ICONS[name as IconName] ?? ''}
</svg>

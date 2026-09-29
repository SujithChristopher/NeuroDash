<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import { onMount } from 'svelte';
	import { theme } from '$lib/stores/theme';
	import { restoreSession } from '$lib/stores/auth';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ToastHost from '$lib/components/ui/ToastHost.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	let { children } = $props();

	onMount(() => {
		restoreSession();
	});

	$effect(() => {
		document.documentElement.dataset.theme = $theme;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}
<Modal />
<ToastHost />
<Tooltip />

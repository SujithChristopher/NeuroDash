<script lang="ts">
	import '$lib/styles/app.css';
	import '$lib/styles/responsive.css';
	import '$lib/styles/patient.css';
	import ToastHost from '$lib/components/ToastHost.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>NeuroDash</title>
</svelte:head>

{@render children()}
<ToastHost />

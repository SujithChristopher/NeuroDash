<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	let { data } = $props();
</script>

<div class="ph"><div><h1>Device {data.id}</h1></div></div>
<Card><p class="muted">Coming soon — built in the Engineer/Admin views sub-project.</p></Card>

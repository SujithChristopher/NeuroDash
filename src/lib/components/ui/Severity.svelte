<script lang="ts">
	let { level }: { level: 'Low' | 'Medium' | 'High' | 'Critical' } = $props();
</script>

<span class="sev {level}"><i><b></b><b></b><b></b></i>{level}</span>

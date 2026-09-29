<script lang="ts">
	let { text, tone = '', live = false }: { text: string; tone?: string; live?: boolean } = $props();
</script>

<span class="pill {tone} {live ? 'live' : ''}"><span class="d"></span>{text}</span>

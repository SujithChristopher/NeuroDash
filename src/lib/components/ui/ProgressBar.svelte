<script lang="ts">
	let { value, tone = '' }: { value: number; tone?: string } = $props();
	const pct = () => Math.round(Math.max(0, Math.min(1, value)) * 100);
</script>

<div class="mcell">
	<div class="meter {tone ? 'm-' + tone : ''}"><div style="width:{pct()}%"></div></div>
	<span class="num sm">{pct()}%</span>
</div>

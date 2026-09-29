<script lang="ts">
	let visible = $state(false);
	let content = $state('');
	let x = $state(0);
	let y = $state(0);

	function handleMove(e: MouseEvent) {
		const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
		if (!el) {
			visible = false;
			return;
		}
		content = el.getAttribute('data-tip') || '';
		visible = true;
		const w = 260,
			h = 60; // rough estimate before layout; fine for a floating hint
		let px = e.clientX + 14,
			py = e.clientY - h - 12;
		if (px + w > innerWidth - 8) px = e.clientX - w - 14;
		if (py < 8) py = e.clientY + 18;
		x = px;
		y = py;
	}
</script>

<svelte:window onmousemove={handleMove} />

<div id="tip" style="opacity:{visible ? 1 : 0}; left:{x}px; top:{y}px">{@html content}</div>

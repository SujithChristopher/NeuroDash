<script lang="ts">
	// A ranked list of horizontal bars with the full label and the figure on every row: for "how many of each" questions
	// (trials per mechanism, per game) where chart axes would cut the names off and hide the numbers.
	let {
		items,
		color = 'var(--accent)',
		unit = ''
	}: { items: { label: string; value: number }[]; color?: string; unit?: string } = $props();

	const sorted = $derived([...items].sort((a, b) => b.value - a.value));
	const max = $derived(Math.max(1, ...sorted.map((i) => i.value)));
	const total = $derived(sorted.reduce((n, i) => n + i.value, 0));
	const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
</script>

<ol class="rank">
	{#each sorted as it, i (it.label)}
		<li style="--w:{(it.value / max) * 100}%; --i:{i}">
			<div class="top">
				<span class="name">{it.label}</span>
				<span class="val"><b>{it.value}</b>{#if unit}&nbsp;{unit}{/if}<span class="share">{pct(it.value)}%</span></span>
			</div>
			<div class="track" role="img" aria-label="{it.label}: {it.value} {unit}, {pct(it.value)}% of the total">
				<div class="fill" style="background:linear-gradient(90deg, color-mix(in srgb, {color} 55%, var(--surface)), {color})"></div>
			</div>
		</li>
	{/each}
</ol>

<style>
	.rank {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 16px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 6px;
		font-size: 13px;
	}
	.name {
		color: var(--ink-900);
		font-weight: 500;
		min-width: 0;
	}
	.val {
		flex-shrink: 0;
		color: var(--ink-500);
		white-space: nowrap;
	}
	.val b {
		color: var(--ink-900);
		font-size: 15px;
		font-weight: 600;
	}
	.share {
		display: inline-block;
		min-width: 38px;
		margin-left: 8px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--ink-700);
		font-size: 11px;
		font-weight: 600;
		text-align: center;
	}
	.track {
		height: 12px;
		border-radius: 999px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		width: var(--w);
		border-radius: 999px;
		transform-origin: left;
		animation: grow 0.9s cubic-bezier(0.22, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--i) * 90ms);
	}
	@keyframes grow {
		from {
			transform: scaleX(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fill {
			animation: none;
		}
	}
</style>

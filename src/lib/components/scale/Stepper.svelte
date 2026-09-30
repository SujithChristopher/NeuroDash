<script lang="ts">
	// Numeric entry without a keyboard: −/+ buttons (±1, ±5) and, for 0–100 scales such as the EQ VAS, a slider.
	let {
		value,
		min,
		max,
		label,
		slider = false,
		onchange
	}: {
		value: number | undefined;
		min: number;
		max: number;
		label: string;
		slider?: boolean;
		onchange: (v: number) => void;
	} = $props();

	const v = $derived(value ?? min);
	const set = (n: number) => onchange(Math.min(max, Math.max(min, Math.round(n))));
</script>

<div class="stepper" role="group" aria-label={label}>
	<button type="button" class="btn btn-secondary step" aria-label="Decrease by 5" disabled={v <= min} onclick={() => set(v - 5)}>−5</button>
	<button type="button" class="btn btn-secondary step" aria-label="Decrease by 1" disabled={v <= min} onclick={() => set(v - 1)}>−</button>
	<output class="readout" class:unset={value === undefined} aria-live="polite">{value === undefined ? '—' : value}<span class="muted"> / {max}</span></output>
	<button type="button" class="btn btn-secondary step" aria-label="Increase by 1" disabled={v >= max} onclick={() => set(v + 1)}>+</button>
	<button type="button" class="btn btn-secondary step" aria-label="Increase by 5" disabled={v >= max} onclick={() => set(v + 5)}>+5</button>
</div>
{#if slider}
	<input class="range" type="range" {min} {max} step="1" value={v} aria-label="{label} slider" oninput={(e) => set(Number(e.currentTarget.value))} />
{/if}

<style>
	.stepper {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.step {
		min-width: 44px;
		min-height: 44px;
	}
	.readout {
		min-width: 84px;
		text-align: center;
		font-family: var(--font-display);
		font-size: 22px;
	}
	.readout.unset {
		color: var(--ink-400);
	}
	.readout .muted {
		font-family: var(--font-body);
		font-size: 12px;
	}
	.range {
		width: 100%;
		max-width: 420px;
		margin-top: 10px;
		padding: 0;
		accent-color: var(--accent);
		height: 28px;
	}
</style>

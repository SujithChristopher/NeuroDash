<script lang="ts">
	// Single-choice control: a radio group of large tappable buttons (widgets `buttons` and `segmented`).
	// Arrow keys move the selection; the selected state is shown with a check mark, not colour alone.
	import type { Choice, ScalarValue } from '$lib/scales/types';
	import Icon from '../Icon.svelte';

	let {
		choices,
		value,
		label,
		onchange
	}: {
		choices: Choice[];
		value: ScalarValue | undefined;
		label: string;
		onchange: (v: ScalarValue) => void;
	} = $props();

	const selected = $derived(choices.findIndex((c) => String(c.value) === String(value)));
	// Roving tabindex: the selected button (or the first) is the one tab stop.
	const stop = $derived(selected >= 0 ? selected : 0);
	let root = $state<HTMLDivElement>();
	// Short answers (a single word or a number: "0", "1", "Yes", "Normal") sit side by side as equal columns in ONE row.
	// Anything longer (sentences) is listed one per row so long labels never get cut off.
	const SHORT = /^\S{1,14}$/;
	const compact = $derived(choices.length <= 8 && choices.every((c) => SHORT.test(String(c.label).trim())));
	// Many short answers (e.g. a 0-10 scale) wrap onto further rows instead of overflowing.
	const wrapShort = $derived(choices.length > 8 && choices.every((c) => SHORT.test(String(c.label).trim())));
	function key(e: KeyboardEvent, i: number) {
		const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
		if (next === null) return;
		e.preventDefault();
		const j = (next + choices.length) % choices.length;
		onchange(choices[j].value);
		(root?.querySelectorAll('button')[j] as HTMLButtonElement | undefined)?.focus();
	}
</script>

<div class="choice-group" class:list={!compact && !wrapShort} class:columns={compact} role="radiogroup" aria-label={label} bind:this={root}>
	{#each choices as c, i (String(c.value))}
		<button
			type="button"
			role="radio"
			aria-checked={i === selected}
			tabindex={i === stop ? 0 : -1}
			class="choice"
			class:on={i === selected}
			onclick={() => onchange(c.value)}
			onkeydown={(e) => key(e, i)}
		>
			{#if i === selected}<Icon name="check" size={14} />{/if}
			<span>{c.label}</span>
		</button>
	{/each}
</div>

<style>
	.choice-group {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.choice {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		min-width: 44px;
		padding: 8px 14px;
		text-align: left;
		font: inherit;
		font-size: 13px;
		line-height: 1.35;
		color: var(--ink-700);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-s);
		cursor: pointer;
		max-width: 100%;
		white-space: normal; /* long translated labels wrap, never truncate */
	}
	.choice-group.list {
		flex-direction: column;
		gap: 6px;
	}
	/* one line of equal columns */
	.choice-group.columns {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 8px;
		max-width: 640px;
	}
	.choice-group.columns .choice {
		justify-content: center;
		text-align: center;
		padding: 8px 6px;
	}
	/* a phone is too narrow for many columns: let them wrap */
	@media (max-width: 480px) {
		.choice-group.columns {
			grid-auto-flow: row;
			grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
		}
	}
	.choice-group.list .choice {
		width: 100%;
		justify-content: flex-start;
	}
	.choice:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.choice.on {
		color: var(--accent-soft-ink);
		background: var(--accent-soft);
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
		font-weight: 600;
	}
</style>

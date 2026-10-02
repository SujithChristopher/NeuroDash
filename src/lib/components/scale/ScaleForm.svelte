<script lang="ts">
	// One generic renderer for every scale in clinical_scales/neuro. Click-only: buttons, chips, steppers,
	// a slider and dropdowns — no text inputs or textareas. Free-text items in a definition are not rendered.
	import { onMount } from 'svelte';
	import ChoiceGroup from './ChoiceGroup.svelte';
	import Stepper from './Stepper.svelte';
	import Icon from '../Icon.svelte';
	import {
		DEFAULT_NUMBER_MAX,
		computeScores,
		isRenderable,
		isVisible,
		maxScore,
		progress,
		pruneHidden
	} from '$lib/scales/evaluate';
	import type { Answers, ScaleDef, ScaleItem, ScalarValue } from '$lib/scales/types';

	let {
		def,
		answers = $bindable({}),
		examinerId = $bindable(''),
		examiners,
		patientCode,
		primary,
		draftKey,
		missing = null
	}: {
		def: ScaleDef;
		answers: Answers;
		examinerId: string;
		examiners: { id: string; name: string }[];
		patientCode: string;
		primary: string | null;
		draftKey: string;
		/** Item id the server rejected; we jump to it. */
		missing?: string | null;
	} = $props();

	// Every section and question is on one page, in order: scroll, answer, save. (No Next / Previous steps, however long the scale.)
	const sections = $derived(
		def.sections
			.map((s) => ({ ...s, items: s.items.filter((i) => isRenderable(i) && i.type !== 'date') }))
			.filter((s) => s.items.length)
	);

	const scores = $derived(computeScores(def, answers));
	const prog = $derived(progress(def, answers));
	const primaryMax = $derived(primary ? maxScore(def, primary) : null);

	function set(id: string, value: Answers[string]) {
		answers = pruneHidden(def, { ...answers, [id]: value });
	}
	function toggleMulti(item: ScaleItem, v: ScalarValue) {
		const cur = Array.isArray(answers[item.id]) ? (answers[item.id] as ScalarValue[]) : [];
		const next = cur.some((x) => String(x) === String(v)) ? cur.filter((x) => String(x) !== String(v)) : [...cur, v];
		if (next.length) set(item.id, next);
		else {
			const { [item.id]: _drop, ...rest } = answers;
			answers = pruneHidden(def, rest);
		}
	}
	const clear = (id: string) => {
		const { [id]: _drop, ...rest } = answers;
		answers = pruneHidden(def, rest);
	};

	// Answers are saved as they are chosen so a reload loses nothing. localStorage can be blocked: always guard.
	let restored = $state(false);
	onMount(() => {
		try {
			const raw = localStorage.getItem(draftKey);
			if (raw) answers = pruneHidden(def, JSON.parse(raw));
		} catch {
			/* no draft */
		}
		restored = true;
	});
	$effect(() => {
		const snapshot = JSON.stringify(answers);
		if (!restored) return;
		try {
			if (snapshot === '{}') localStorage.removeItem(draftKey);
			else localStorage.setItem(draftKey, snapshot);
		} catch {
			/* storage unavailable — entry still works */
		}
	});

	$effect(() => {
		if (!missing) return;
		queueMicrotask(() => document.getElementById(`item-${missing}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
	});

	const numMin = (i: ScaleItem) => i.min ?? 0;
	const numMax = (i: ScaleItem) => i.max ?? DEFAULT_NUMBER_MAX;
	const pctDone = $derived(prog.total ? Math.round((prog.answered / prog.total) * 100) : 100);
</script>

<div class="sticky-progress" aria-label="Progress">
	<div class="progress-row">
		<div class="progress-track"><div class="progress-fill" style="width:{pctDone}%"></div></div>
		<span class="mono" style="font-size:12px;white-space:nowrap">{prog.answered} / {prog.total} answered</span>
	</div>
	{#if primary}
		<div class="live-score" aria-live="polite">
			<Icon name="gauge" size={14} />
			<span>{scores[primary] == null ? 'Score shows once every scored item is answered' : `Score ${scores[primary]}${primaryMax != null ? ` / ${primaryMax}` : ''}`}</span>
			<span class="muted">(auto-calculated)</span>
		</div>
	{/if}
</div>

{#each sections as section (section.id)}
	<section class="scale-section">
		{#if section.title}<h3 class="sec-title">{section.title}</h3>{/if}
		{#each section.items as item (item.id)}
			{#if isVisible(item, answers)}
				<div class="scale-item" id="item-{item.id}" class:flag={missing === item.id}>
					{#if item.type === 'info'}
						<p class="info">{item.label}</p>
					{:else if item.type === 'subject_ref'}
						<div class="label">{item.label ?? 'Record ID'}</div>
						<div class="readonly mono">{patientCode}</div>
					{:else if item.type === 'examiner'}
						<label class="label" for="ex-{item.id}">{item.label ?? 'Examiner'}</label>
						<select id="ex-{item.id}" bind:value={examinerId} style="max-width:320px">
							{#each examiners as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
						</select>
					{:else if item.type === 'computed'}
						<div class="label">{item.label ?? item.id}</div>
						<div class="computed" class:primary={item.id === primary}>
							<span class="mono">{scores[item.id] ?? '—'}</span>
							<span class="muted">auto-calculated</span>
						</div>
					{:else if item.type === 'number'}
						<div class="label" id="lbl-{item.id}">{item.label ?? item.id}{#if item.required}<span class="req"> *</span>{/if}</div>
						{#if item.note}<div class="hint">{item.note.replace(/^\[|\]$/g, '')}</div>{/if}
						<Stepper
							value={typeof answers[item.id] === 'number' ? (answers[item.id] as number) : undefined}
							min={numMin(item)}
							max={numMax(item)}
							label={item.label ?? item.id}
							slider={numMax(item) === 100 && numMin(item) === 0}
							onchange={(v) => set(item.id, v)}
						/>
					{:else if item.type === 'multi_choice'}
						<div class="label">{item.label ?? item.id}</div>
						<div class="chips list" role="group" aria-label={item.label ?? item.id}>
							{#each item.choices ?? [] as c (String(c.value))}
								{@const on = Array.isArray(answers[item.id]) && (answers[item.id] as ScalarValue[]).some((x) => String(x) === String(c.value))}
								<button type="button" class="chip" class:on aria-pressed={on} onclick={() => toggleMulti(item, c.value)}>
									{#if on}<Icon name="check" size={13} />{/if}{c.label}
								</button>
							{/each}
						</div>
					{:else if item.type === 'single_choice' || item.type === 'yesno'}
						<div class="label" id="lbl-{item.id}">{item.label ?? item.id}{#if item.required}<span class="req"> *</span>{/if}</div>
						{#if (item.choices?.length ?? 0) > 12}
							<select
								aria-labelledby="lbl-{item.id}"
								value={answers[item.id] === undefined ? '' : String(answers[item.id])}
								onchange={(e) => {
									const c = item.choices!.find((x) => String(x.value) === e.currentTarget.value);
									if (c) set(item.id, c.value);
									else clear(item.id);
								}}
								style="max-width:420px"
							>
								<option value="">Select…</option>
								{#each item.choices ?? [] as c (String(c.value))}<option value={String(c.value)}>{c.label}</option>{/each}
							</select>
						{:else}
							<ChoiceGroup
								choices={item.choices ?? []}
								value={answers[item.id] as ScalarValue | undefined}
								label={item.label ?? item.id}
								onchange={(v) => set(item.id, v)}
							/>
						{/if}
						{#if answers[item.id] !== undefined && !item.required}
							<button type="button" class="link-btn clear" onclick={() => clear(item.id)}>Clear answer</button>
						{/if}
					{/if}
				</div>
			{/if}
		{/each}
	</section>
{/each}

<style>
	.sticky-progress {
		position: sticky;
		top: 58px;
		z-index: 5;
		background: var(--surface);
		padding: 10px 0 12px;
		margin-bottom: 14px;
		border-bottom: 1px solid var(--border);
	}
	.live-score {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--accent-600);
	}
	.live-score .muted {
		font-weight: 400;
	}
	.scale-section {
		margin-bottom: 26px;
	}
	.sec-title {
		font-size: 14.5px;
		font-family: var(--font-body);
		font-weight: 700;
		margin: 6px 0 14px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
	}
	.scale-item {
		padding: 12px 10px;
		margin: 0 -10px 4px;
		border-radius: var(--radius-s);
	}
	.scale-item.flag {
		background: var(--critical-soft);
		outline: 1px solid var(--critical);
	}
	.label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink-900);
		margin-bottom: 8px;
		white-space: pre-line;
	}
	.req {
		color: var(--critical);
	}
	.hint {
		font-size: 11.5px;
		color: var(--ink-500);
		margin: -4px 0 8px;
	}
	.info {
		font-size: 12.5px;
		color: var(--ink-700);
		background: var(--surface-2);
		border-radius: var(--radius-s);
		padding: 10px 12px;
		white-space: pre-line;
	}
	.readonly {
		display: inline-block;
		padding: 8px 12px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
	}
	.computed {
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
		padding: 8px 14px;
		background: var(--surface-2);
		border-radius: var(--radius-s);
		font-size: 18px;
	}
	.computed.primary {
		background: var(--accent-soft);
		color: var(--accent-soft-ink);
		font-weight: 700;
	}
	.computed .muted {
		font-size: 11px;
		font-weight: 400;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chips.list {
		flex-direction: column;
		gap: 6px;
	}
	.chips.list .chip {
		width: 100%;
		justify-content: flex-start;
		border-radius: var(--radius-s);
		text-align: left;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 8px 14px;
		font: inherit;
		font-size: 13px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		cursor: pointer;
		color: var(--ink-700);
	}
	.chip.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent-soft-ink);
		font-weight: 600;
	}
	.clear {
		margin-top: 6px;
		font-size: 12px;
	}
</style>

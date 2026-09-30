<script lang="ts">
	import { tick } from 'svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	interface Answer {
		text: string;
		tags: string[];
		facts: { label: string; value: string }[];
		links: { label: string; href: string }[];
	}
	type Msg = { role: 'user'; text: string } | { role: 'bot'; answer: Answer } | { role: 'typing' };

	let messages = $state<Msg[]>([
		{
			role: 'bot',
			answer: {
				text: 'Hi — I answer from your live data only, and I’ll say so when I can’t. Ask about adherence, device usage, open issues, or a specific patient.',
				tags: [],
				facts: [],
				links: []
			}
		}
	]);
	let q = $state('');
	let busy = $state(false);
	let log = $state<HTMLDivElement>();

	async function ask(question: string) {
		question = question.trim();
		if (!question || busy) return;
		busy = true;
		q = '';
		messages.push({ role: 'user', text: question }, { role: 'typing' });
		await tick();
		log?.scrollTo({ top: log.scrollHeight });

		let answer: Answer;
		try {
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question })
			});
			answer = res.ok
				? await res.json()
				: { text: 'Sorry — I couldn’t process that question.', tags: [], facts: [], links: [] };
		} catch {
			answer = { text: 'Sorry — I couldn’t reach the server.', tags: [], facts: [], links: [] };
		}
		messages = messages.filter((m) => m.role !== 'typing');
		messages.push({ role: 'bot', answer });
		busy = false;
		await tick();
		log?.scrollTo({ top: log.scrollHeight });
	}
</script>

<PageHead title="AI Assistant" sub="Answers come from direct, location-scoped queries — never guesses. Each answer is tagged observed, calculated or interpretation." />

<div class="ai-shell">
	<div>
		<div class="eyebrow" style="margin-bottom:8px">Suggested questions</div>
		<div class="ai-suggest">
			{#each data.suggestions as s (s)}
				<button onclick={() => ask(s.replace(/<patient name>/g, 'Ananya'))}>{s}</button>
			{/each}
		</div>
	</div>
	<div class="chat-col">
		<div class="chat-log" bind:this={log} aria-live="polite">
			{#each messages as m, i (i)}
				{#if m.role === 'user'}
					<div class="msg user"><div class="bubble">{m.text}</div></div>
				{:else if m.role === 'typing'}
					<div class="msg bot"><div class="bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div></div>
				{:else}
					<div class="msg bot">
						<div class="bubble">
							{#if m.answer.tags.length}
								<div style="display:flex;gap:6px;margin-bottom:8px">
									{#each m.answer.tags as t (t)}<span class="ai-tag {t}">{t}</span>{/each}
								</div>
							{/if}
							<div>{m.answer.text}</div>
							{#if m.answer.facts.length}
								<div class="ai-card">
									<div class="ai-card-head">Data</div>
									<div class="ai-stat-grid">
										{#each m.answer.facts as f (f.label + f.value)}
											<div class="ai-stat"><div class="l">{f.label}</div><div class="v" style="font-size:13.5px">{f.value}</div></div>
										{/each}
									</div>
									{#if m.answer.links.length}
										<div class="ai-actions">
											{#each m.answer.links as l (l.href)}
												<a class="btn btn-secondary btn-sm" href={l.href}>{l.label} <Icon name="chevron" size={12} /></a>
											{/each}
										</div>
									{/if}
								</div>
							{:else if m.answer.links.length}
								<div class="ai-actions" style="padding:10px 0 0">
									{#each m.answer.links as l (l.href)}
										<a class="btn btn-secondary btn-sm" href={l.href}>{l.label} <Icon name="chevron" size={12} /></a>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
		<form class="chat-input-row" onsubmit={(e) => (e.preventDefault(), ask(q))}>
			<input type="text" placeholder="Ask about your patients or devices…" bind:value={q} maxlength="500" aria-label="Question" />
			<button class="btn btn-primary" disabled={busy || !q.trim()}><Icon name="send" size={14} /> Ask</button>
		</form>
	</div>
</div>

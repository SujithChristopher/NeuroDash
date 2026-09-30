<script lang="ts">
	import { statusTone, type Tone } from '$lib/utils';

	let { text, tone }: { text: string; tone?: Tone } = $props();
	const t = $derived(tone ?? statusTone(text));
</script>

<span class="badge badge-{t}"><span class="dot"></span>{text}</span>

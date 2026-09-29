<script lang="ts">
	import Icon from './Icon.svelte';
	let {
		value = '',
		oninput,
		placeholder = 'Search'
	}: { value?: string; oninput: (v: string) => void; placeholder?: string } = $props();
	let timer: ReturnType<typeof setTimeout>;
	function handleInput(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		clearTimeout(timer);
		timer = setTimeout(() => oninput(v), 180);
	}
</script>

<label class="inp">
	<Icon name="search" size={14} />
	<input {placeholder} value={value} oninput={handleInput} />
</label>

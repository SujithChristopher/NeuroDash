<script lang="ts">
	let { size = 30 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
	<rect width="40" height="40" rx="10" fill="#0c7b83" fill-opacity=".14" />
	<path
		d="M11 27V13l9 10 9-10v14"
		stroke="#0c7b83"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
	<circle cx="11" cy="13" r="2" fill="#0c7b83" />
	<circle cx="29" cy="13" r="2" fill="#0c7b83" />
</svg>

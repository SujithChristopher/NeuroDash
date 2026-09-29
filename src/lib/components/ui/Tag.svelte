<script lang="ts">
	let { text, tone = '' }: { text: string; tone?: string } = $props();
</script>

<span class="tag {tone}">{text}</span>

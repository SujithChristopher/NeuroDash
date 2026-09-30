<script lang="ts">
	import Icon from './Icon.svelte';
</script>

<div class="readonly-banner">
	<Icon name="shield" size={15} />
	<span>
		<b>READ ONLY</b> — Admin has full visibility for audit and oversight but cannot create or modify
		clinical records, therapy plans or device records.
	</span>
</div>

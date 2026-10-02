<script lang="ts">
	import { untrack } from 'svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PatientReportView from '$lib/components/PatientReportView.svelte';
	import { crumbDetail } from '$lib/stores/page';
	import { fmtDateTime } from '$lib/utils';

	let { data } = $props();
	// Read-only: the notes are part of the snapshot.
	let notes = $state(untrack(() => data.notes));

	$effect(() => {
		crumbDetail.set(data.title);
	});
</script>

<PageHead title={data.title} sub="Saved {fmtDateTime(data.savedAt)} by {data.savedBy.name}. This is a snapshot: it does not change when new data arrives.">
	{#snippet actions()}
		<a class="btn btn-ghost no-print" href="/reports?view=patient&patient={data.patient.id}">Back to reports</a>
		<button class="btn btn-secondary no-print" onclick={() => window.print()}><Icon name="report" size={14} /> Print</button>
	{/snippet}
</PageHead>

<PatientReportView report={data.report} bind:notes />

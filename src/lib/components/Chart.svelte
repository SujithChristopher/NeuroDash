<script lang="ts">
	import { onMount } from 'svelte';
	import { MiniChart } from '$lib/charts/minichart.js';
	import {
		rc,
		barConfig,
		catColor,
		donutConfig,
		lineConfig,
		type BarDataset,
		type ChartOpts,
		type LineDataset
	} from '$lib/charts/config';

	type Props =
		| { kind: 'line' | 'area'; labels: string[]; datasets: LineDataset[]; opts?: ChartOpts; height?: number }
		| { kind: 'bar'; labels: string[]; datasets: BarDataset[]; opts?: ChartOpts; height?: number }
		| { kind: 'donut'; labels: string[]; data: number[]; colors?: string[]; height?: number };

	let props: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: { destroy: () => void } | null = null;
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		return () => chart?.destroy();
	});

	$effect(() => {
		if (!mounted) return;
		const p = props;
		chart?.destroy();
		let cfg;
		if (p.kind === 'donut') {
			cfg = donutConfig(p.labels, p.data, (p.colors ?? p.labels.map((_, i) => catColor(i))).map(rc));
		} else if (p.kind === 'bar') {
			cfg = barConfig(p.labels, p.datasets, p.opts);
		} else {
			const sets = p.kind === 'area' ? p.datasets.map((d) => ({ ...d, fill: true })) : p.datasets;
			cfg = lineConfig(p.labels, sets, p.opts);
		}
		chart = new MiniChart(canvas.getContext('2d'), cfg);
	});
</script>

<div class="chart-box" style="height:{props.height ?? 220}px">
	<canvas bind:this={canvas}></canvas>
</div>

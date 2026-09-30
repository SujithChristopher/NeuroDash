// Chart config builders — ported from neurodash_10.html's lineChart/barChart/donutChart helpers.
// They read CSS custom properties at call time, so they must only run in the browser.

export interface LineDataset {
	label: string;
	data: (number | null)[];
	color: string;
	fill?: boolean;
	dashed?: boolean;
}
export interface BarDataset {
	label: string;
	data: number[];
	color: string | string[];
}
export interface ChartOpts {
	legend?: boolean;
	suggestedMax?: number;
	maxTicksX?: number;
	horizontal?: boolean;
	thick?: number;
}

export const cssVar = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Canvas can't use var(--x): resolve CSS variable references to their computed value. */
export const rc = (c: string) => {
	const m = /^var\((--[\w-]+)\)$/.exec(c);
	return m ? cssVar(m[1]) : c;
};

export const SERIES_VARS = [
	'--series-1',
	'--series-2',
	'--series-3',
	'--series-4',
	'--series-5',
	'--series-6'
];
export const catColor = (i: number) => cssVar(SERIES_VARS[i % SERIES_VARS.length]);

const font = () => ({ family: 'IBM Plex Sans', size: 11 });

function tooltipBase() {
	return {
		backgroundColor: cssVar('--ink-900'),
		titleColor: cssVar('--bg'),
		bodyColor: cssVar('--bg'),
		padding: 10,
		cornerRadius: 8,
		displayColors: true,
		boxPadding: 4,
		titleFont: { family: 'IBM Plex Mono', size: 11 },
		bodyFont: { family: 'IBM Plex Sans', size: 12 }
	};
}

export function lineConfig(labels: string[], datasets: LineDataset[], opts: ChartOpts = {}) {
	return {
		type: 'line',
		data: {
			labels,
			datasets: datasets.map((raw) => {
				const ds = { ...raw, color: rc(raw.color) };
				return {
				label: ds.label,
				data: ds.data,
				borderColor: ds.color,
				backgroundColor: ds.fill ? ds.color + '26' : 'transparent',
				borderWidth: 2,
				pointRadius: ds.data.length > 40 ? 0 : 3,
				pointHoverRadius: 5,
				pointBackgroundColor: ds.color,
				pointBorderColor: cssVar('--surface'),
				pointBorderWidth: 1.5,
				tension: 0.35,
				fill: !!ds.fill,
				spanGaps: true,
				borderDash: ds.dashed ? [5, 4] : []
				};
			})
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			interaction: { mode: 'index', intersect: false },
			plugins: {
				legend: {
					display: !!opts.legend,
					labels: { color: cssVar('--ink-700'), font: font(), usePointStyle: true, boxWidth: 8 }
				},
				tooltip: { ...tooltipBase(), callbacks: {} }
			},
			scales: {
				x: {
					grid: { display: false },
					ticks: {
						color: cssVar('--ink-500'),
						font: font(),
						maxRotation: 0,
						autoSkip: true,
						maxTicksLimit: opts.maxTicksX ?? 8
					},
					border: { color: cssVar('--border') }
				},
				y: {
					beginAtZero: true,
					grid: { color: cssVar('--border') },
					ticks: { color: cssVar('--ink-500'), font: font(), precision: 0 },
					border: { display: false },
					suggestedMax: opts.suggestedMax
				}
			}
		}
	};
}

export function barConfig(labels: string[], datasets: BarDataset[], opts: ChartOpts = {}) {
	return {
		type: 'bar',
		data: {
			labels,
			datasets: datasets.map((ds) => ({
				label: ds.label,
				data: ds.data,
				backgroundColor: Array.isArray(ds.color) ? ds.color.map(rc) : rc(ds.color),
				borderRadius: 4,
				maxBarThickness: opts.thick ?? 28,
				borderSkipped: false
			}))
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: opts.horizontal ? 'y' : 'x',
			plugins: {
				legend: {
					display: !!opts.legend,
					labels: { color: cssVar('--ink-700'), font: font(), usePointStyle: true, boxWidth: 8 }
				},
				tooltip: tooltipBase()
			},
			scales: {
				x: {
					grid: { display: !!opts.horizontal },
					color: cssVar('--border'),
					ticks: { color: cssVar('--ink-500'), font: font() },
					border: { color: cssVar('--border') },
					beginAtZero: true
				},
				y: {
					grid: { display: !opts.horizontal, color: cssVar('--border') },
					ticks: { color: cssVar('--ink-500'), font: font() },
					border: { display: false },
					beginAtZero: true
				}
			}
		}
	};
}

export function donutConfig(labels: string[], data: number[], colors: string[]) {
	return {
		type: 'doughnut',
		data: {
			labels,
			datasets: [
				{
					data,
					backgroundColor: colors,
					borderWidth: 2,
					borderColor: cssVar('--surface'),
					hoverOffset: 4
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			cutout: '68%',
			plugins: { legend: { display: false }, tooltip: tooltipBase() }
		}
	};
}

<script lang="ts" generics="T">
	interface Column<T> {
		header: string;
		render: (row: T) => string;
		sortValue?: (row: T) => string | number;
		align?: 'r';
		width?: string;
	}
	let {
		columns,
		rows,
		onRowClick,
		limit,
		emptyText = 'Nothing to show.'
	}: {
		columns: Column<T>[];
		rows: T[];
		onRowClick?: (row: T) => void;
		limit?: number;
		emptyText?: string;
	} = $props();

	let sortCol = $state<number | null>(null);
	let sortDir = $state<1 | -1>(1);

	function sortedRows() {
		if (sortCol == null || !columns[sortCol].sortValue) return rows;
		const c = columns[sortCol];
		return [...rows].sort((a, b) => {
			const va = c.sortValue!(a),
				vb = c.sortValue!(b);
			return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
		});
	}
	function shownRows() {
		const data = sortedRows();
		return limit && data.length > limit ? data.slice(0, limit) : data;
	}
	function toggleSort(i: number) {
		if (!columns[i].sortValue) return;
		if (sortCol === i) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortCol = i;
			sortDir = 1;
		}
	}
</script>

{#if rows.length === 0}
	<div class="empty">{emptyText}</div>
{:else}
	<div class="tbl-wrap">
		<table class="tbl">
			<thead>
				<tr>
					{#each columns as c, i (c.header)}
						<th
							class="{c.align === 'r' ? 'r' : ''} {c.sortValue ? 'sortable' : ''}"
							style={c.width ? `width:${c.width}` : undefined}
							onclick={() => toggleSort(i)}
						>
							{c.header}{sortCol === i ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each shownRows() as row, i (i)}
					<tr class={onRowClick ? 'click' : ''} onclick={() => onRowClick?.(row)}>
						{#each columns as c (c.header)}
							<td class={c.align === 'r' ? 'r num' : ''}>{@html c.render(row)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if limit && rows.length > limit}
		<div class="tbl-foot"><span>Showing 1–{limit} of {rows.length}</span></div>
	{/if}
{/if}

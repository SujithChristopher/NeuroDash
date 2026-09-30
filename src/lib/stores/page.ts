import { writable } from 'svelte/store';

/** Optional detail segment for the breadcrumb, e.g. "Patients › Ananya R.". Detail pages set it. */
export const crumbDetail = writable<string | null>(null);

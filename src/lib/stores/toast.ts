import { writable } from 'svelte/store';

export type ToastTone = 'good' | 'info' | 'warning' | 'critical';
export interface ToastItem {
	id: number;
	msg: string;
	tone: ToastTone;
}

let n = 0;
export const toasts = writable<ToastItem[]>([]);

export function toast(msg: string, tone: ToastTone = 'good') {
	const id = ++n;
	toasts.update((t) => [...t, { id, msg, tone }]);
	setTimeout(() => toasts.update((t) => t.filter((x) => x.id !== id)), 3400);
}

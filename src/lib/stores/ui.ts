import { writable } from 'svelte/store';

export interface Toast {
	id: number;
	message: string;
}
export const toasts = writable<Toast[]>([]);
let _toastId = 0;
export function showToast(message: string) {
	const id = ++_toastId;
	toasts.update((t) => [...t, { id, message }]);
	setTimeout(() => {
		toasts.update((t) => t.filter((x) => x.id !== id));
	}, 2600);
}

export interface ModalSpec {
	title: string;
	sub?: string;
	body: string;
	submitLabel?: string;
	onSubmit: (data: Record<string, string>) => boolean | void;
}
export const modal = writable<ModalSpec | null>(null);
export const openModal = (spec: ModalSpec) => modal.set(spec);
export const closeModal = () => modal.set(null);

export const commandPaletteOpen = writable(false);

export const notificationsRead = writable<Set<string>>(new Set());
export const markRead = (id: string) => notificationsRead.update((s) => new Set(s).add(id));
export const markAllRead = (ids: string[]) => notificationsRead.update((s) => new Set([...s, ...ids]));

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts, showToast, modal, openModal, closeModal, commandPaletteOpen, notificationsRead, markRead, markAllRead } from './ui';

beforeEach(() => {
	toasts.set([]);
	modal.set(null);
	commandPaletteOpen.set(false);
	notificationsRead.set(new Set());
});

describe('toasts', () => {
	it('showToast adds a toast with a unique id', () => {
		showToast('Saved');
		showToast('Saved again');
		const list = get(toasts);
		expect(list).toHaveLength(2);
		expect(list[0].id).not.toBe(list[1].id);
	});
});

describe('modal', () => {
	it('openModal sets the spec, closeModal clears it', () => {
		openModal({ title: 'Test', body: '<p>hi</p>', onSubmit: () => {} });
		expect(get(modal)?.title).toBe('Test');
		closeModal();
		expect(get(modal)).toBeNull();
	});
});

describe('commandPaletteOpen', () => {
	it('defaults closed and is toggleable via set', () => {
		expect(get(commandPaletteOpen)).toBe(false);
		commandPaletteOpen.set(true);
		expect(get(commandPaletteOpen)).toBe(true);
	});
});

describe('notificationsRead', () => {
	it('markRead adds an id, markAllRead adds many, both are idempotent', () => {
		markRead('a');
		markRead('a');
		expect(get(notificationsRead)).toEqual(new Set(['a']));
		markAllRead(['a', 'b', 'c']);
		expect(get(notificationsRead)).toEqual(new Set(['a', 'b', 'c']));
	});
});

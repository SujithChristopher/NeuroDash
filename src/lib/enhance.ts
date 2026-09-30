import { invalidateAll } from '$app/navigation';
import { toast } from '$lib/stores/toast';

type Result = { type: string; data?: Record<string, unknown> };

/**
 * `use:enhance` callback that toasts the action's `message`/`error` and refreshes page data.
 * Works for actions that live on another route (`action="/device-issues?/resolve"`).
 */
export function toastEnhance(opts: { onSuccess?: () => void; reset?: boolean } = {}) {
	return () =>
		async ({ result, update }: { result: Result; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			const d = result.data as { message?: string; error?: string } | undefined;
			if (result.type === 'success') {
				toast(d?.message ?? 'Done.');
				opts.onSuccess?.();
			} else if (result.type === 'failure') {
				toast(d?.error ?? 'Could not complete that.', 'critical');
			}
			await update({ reset: opts.reset ?? false });
			await invalidateAll();
		};
}

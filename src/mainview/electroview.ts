import { Electroview } from "electrobun/view";

export type UpdateStatusEntry = {
	status: string;
	message: string;
	timestamp: number;
	details?: {
		progress?: number;
		bytesDownloaded?: number;
		totalBytes?: number;
		errorMessage?: string;
	};
};

// Simple pub/sub for update status events
const listeners = new Set<(entry: UpdateStatusEntry) => void>();

export const updateEvents = {
	subscribe(fn: (entry: UpdateStatusEntry) => void): () => void {
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
		};
	},
	emit(entry: UpdateStatusEntry) {
		for (const fn of listeners) fn(entry);
	},
};

// webview handles: onUpdateStatus (called by bun to push status)
const rpc = Electroview.defineRPC({
	handlers: {
		requests: {
			async onUpdateStatus(entry: unknown) {
				updateEvents.emit(entry as UpdateStatusEntry);
			},
		},
	},
});

export const electroview = new Electroview({ rpc });

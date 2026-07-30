// Port of src/app/services/zoom/zoom.service.ts (88 LOC, 2 BehaviorSubjects).

import { IPC_GET_ZOOM_FACTOR, IPC_SET_ZOOM_FACTOR } from '$common/constants';
import { invoke, isElectron, on } from '$lib/ipc';

export const ZOOM_SCALE = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const;

export enum ZoomDirection {
	ZoomIn = 'in',
	ZoomOut = 'out',
	ZoomReset = 'reset',
	ZoomUnknown = 'unknown'
}

class Zoom {
	factor = $state(1.0);

	#started = false;

	start(): void {
		if (this.#started || !isElectron()) return;
		this.#started = true;

		this.getZoomFactor()
			.then((z) => (this.factor = z))
			.catch(() => console.error('Failed to set initial zoom'));

		on('zoom-changed', (_evt, direction: never) => {
			this.#onWindowZoomChanged(direction as string).catch((e: unknown) => console.error(e));
		});
	}

	getZoomFactor = (): Promise<number> => invoke(IPC_GET_ZOOM_FACTOR);

	setZoomFactor = async (zoomFactor: number): Promise<void> => {
		await invoke(IPC_SET_ZOOM_FACTOR, zoomFactor);
		this.factor = zoomFactor;
	};

	applyZoom = async (direction: ZoomDirection): Promise<void> => {
		switch (direction) {
			case ZoomDirection.ZoomIn:
				await this.setZoomFactor(await this.#nextFactor(1));
				break;
			case ZoomDirection.ZoomOut:
				await this.setZoomFactor(await this.#nextFactor(-1));
				break;
			case ZoomDirection.ZoomReset:
				await this.setZoomFactor(1.0);
				break;
			default:
				break;
		}
	};

	async #onWindowZoomChanged(direction: string): Promise<void> {
		if (direction === 'in') await this.setZoomFactor(await this.#nextFactor(1));
		else if (direction === 'out') await this.setZoomFactor(await this.#nextFactor(-1));
	}

	/** The original had two near-identical private methods differing only by +1/-1. */
	async #nextFactor(step: 1 | -1): Promise<number> {
		const current = Math.round((await this.getZoomFactor()) * 100) / 100;
		const idx = ZOOM_SCALE.indexOf(current as (typeof ZOOM_SCALE)[number]);
		if (idx === -1) return 1.0;
		return ZOOM_SCALE[Math.min(Math.max(idx + step, 0), ZOOM_SCALE.length - 1)];
	}
}

export const zoom = new Zoom();

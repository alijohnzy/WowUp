/**
 * At most one run per key at a time.
 *
 * A call made while a run is in progress waits for it and then runs again, so it sees that
 * run's writes rather than racing them. Calls made while a run is already waiting share that
 * waiting run instead of queueing more: they all want "a run that starts after now", and one
 * satisfies every one of them.
 */
export class SerialByKey<T> {
	readonly #active = new Map<string, Promise<T>>();
	readonly #queued = new Map<string, Promise<T>>();

	run(key: string, fn: () => Promise<T>): Promise<T> {
		const queued = this.#queued.get(key);
		if (queued !== undefined) return queued;

		const active = this.#active.get(key);
		if (active === undefined) return this.#start(key, fn);

		const next = active
			.catch(() => undefined)
			.then(() => {
				this.#queued.delete(key);
				return this.#start(key, fn);
			});
		this.#queued.set(key, next);
		return next;
	}

	/** The run in progress for `key`, if any. */
	active(key: string): Promise<T> | undefined {
		return this.#active.get(key);
	}

	#start(key: string, fn: () => Promise<T>): Promise<T> {
		// Via then() so a synchronous throw becomes a rejection rather than escaping run().
		const run: Promise<T> = Promise.resolve()
			.then(fn)
			.finally(() => {
				if (this.#active.get(key) === run) this.#active.delete(key);
			});
		this.#active.set(key, run);
		return run;
	}
}

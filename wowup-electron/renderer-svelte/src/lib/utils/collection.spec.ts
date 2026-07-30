// Differential test: our lodash replacements vs. real lodash.
//
// collection.ts exists to delete a 144.5 KB dependency from the bundle. That is only safe
// if the replacements behave identically at the call sites the addon providers use, so
// these assert against lodash itself rather than against hand-written expectations.
//
// lodash is still resolvable here from the Angular tree's node_modules; this spec is the
// last thing that depends on it and should be deleted with the Angular renderer.

import { describe, expect, it } from 'vitest';
import _ from 'lodash';
import {
	concat,
	difference,
	filter,
	find,
	flatten,
	intersection,
	map,
	maxBy,
	orderBy,
	remove,
	sortBy,
	take
} from './collection';

interface Row {
	id: number;
	name: string;
	when: string;
}

const rows: Row[] = [
	{ id: 3, name: 'ccc', when: '2024-03-01' },
	{ id: 1, name: 'aaa', when: '2024-01-01' },
	{ id: 2, name: 'bbb', when: '2024-02-01' }
];

describe('find / filter / map', () => {
	it('matches lodash', () => {
		expect(find(rows, (r) => r.id === 2)).toEqual(_.find(rows, (r) => r.id === 2));
		expect(filter(rows, (r) => r.id > 1)).toEqual(_.filter(rows, (r) => r.id > 1));
		expect(map(rows, (r) => r.name)).toEqual(_.map(rows, (r) => r.name));
	});

	it('tolerates null collections the way lodash does', () => {
		expect(find(null, () => true)).toEqual(_.find(null, () => true));
		expect(filter(undefined, () => true)).toEqual(_.filter(undefined, () => true));
		expect(map(null, (r) => r)).toEqual(_.map(null, (r) => r));
	});
});

describe('sortBy / orderBy', () => {
	it('sorts ascending by a numeric iteratee like lodash', () => {
		expect(sortBy(rows, (r) => r.id)).toEqual(_.sortBy(rows, (r) => r.id));
	});

	it('sorts ascending by a date iteratee like lodash', () => {
		// The wago and github providers sort releases by parsed date, then reverse.
		expect(sortBy(rows, (r) => new Date(r.when).getTime())).toEqual(
			_.sortBy(rows, (r) => new Date(r.when).getTime())
		);
	});

	it('orderBy with a single iteratee matches lodash', () => {
		expect(orderBy(rows, (r) => r.id)).toEqual(_.orderBy(rows, [(r) => r.id]));
	});

	it('does not mutate its input', () => {
		const input = [...rows];
		sortBy(input, (r) => r.id);
		expect(input).toEqual(rows);
	});
});

describe('maxBy / take / concat / flatten', () => {
	it('matches lodash', () => {
		expect(maxBy(rows, (r) => r.id)).toEqual(_.maxBy(rows, (r) => r.id));
		expect(take(rows, 2)).toEqual(_.take(rows, 2));
		expect(take(rows, 99)).toEqual(_.take(rows, 99));
		expect(flatten([[1, 2], [3]])).toEqual(_.flatten([[1, 2], [3]]));
		expect(concat([1, 2])).toEqual(_.concat([1, 2]));
	});

	it('maxBy on an empty collection returns undefined like lodash', () => {
		expect(maxBy([], (r: Row) => r.id)).toEqual(_.maxBy([], (r: Row) => r.id));
		expect(maxBy(null, (r: Row) => r.id)).toEqual(_.maxBy(null, (r: Row) => r.id));
	});
});

describe('difference / intersection / remove', () => {
	const a = ['DBM', 'Details', 'WeakAuras'];
	const b = ['Details', 'Plater'];

	it('difference matches lodash', () => {
		expect(difference(a, b)).toEqual(_.difference(a, b));
		expect(difference(a, [])).toEqual(_.difference(a, []));
		expect(difference(null, b)).toEqual(_.difference(null, b));
	});

	it('intersection matches lodash, including dedup', () => {
		expect(intersection(a, b)).toEqual(_.intersection(a, b));
		expect(intersection(['x', 'x', 'y'], ['x'])).toEqual(_.intersection(['x', 'x', 'y'], ['x']));
		expect(intersection(a, [])).toEqual(_.intersection(a, []));
	});

	it('remove mutates and returns the removed elements like lodash', () => {
		const mine = [...a];
		const theirs = [...a];
		expect(remove(mine, (v) => v.startsWith('D'))).toEqual(
			_.remove(theirs, (v) => v.startsWith('D'))
		);
		expect(mine).toEqual(theirs);
	});
});

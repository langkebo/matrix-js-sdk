/*
Copyright 2015, 2016, 2019, 2023 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { lexicographicCompare } from "./strings";

/**
 * The removeElement() method removes the first element in the array that
 * satisfies (returns true) the provided testing function.
 * @param array - The array.
 * @param fn - Function to execute on each value in the array, with the
 * function signature `fn(element, index, array)`. Return true to
 * remove this element and break.
 * @param reverse - True to search in reverse order.
 * @returns True if an element was removed.
 */
export function removeElement<T>(array: T[], fn: (t: T, i?: number, a?: T[]) => boolean, reverse?: boolean): boolean {
    let i: number;
    if (reverse) {
        for (i = array.length - 1; i >= 0; i--) {
            if (fn(array[i], i, array)) {
                array.splice(i, 1);
                return true;
            }
        }
    } else {
        for (i = 0; i < array.length; i++) {
            if (fn(array[i], i, array)) {
                array.splice(i, 1);
                return true;
            }
        }
    }
    return false;
}

/**
 * Deep copy the given object. The object MUST NOT have circular references and
 * MUST NOT have functions.
 * @param obj - The object to deep copy.
 * @returns A copy of the object without any references to the original.
 */
export function deepCopy<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Compare two objects for equality. The objects MUST NOT have circular references.
 *
 * @param x - The first object to compare.
 * @param y - The second object to compare.
 *
 * @returns true if the two objects are equal
 */
export function deepCompare(x: unknown, y: unknown): boolean {
    // Inspired by
    // http://stackoverflow.com/questions/1068834/object-comparison-in-javascript#1144249

    // Compare primitives and functions.
    // Also check if both arguments link to the same object.
    if (x === y) {
        return true;
    }

    if (typeof x !== typeof y) {
        return false;
    }

    // special-case NaN (since NaN !== NaN)
    if (typeof x === "number" && isNaN(x as number) && isNaN(y as number)) {
        return true;
    }

    // special-case null (since typeof null == 'object', but null.constructor
    // throws)
    if (x === null || y === null) {
        return x === y;
    }

    // everything else is either an unequal primitive, or an object
    // Workaround: This check has been tweaked due to issues in test environments.
    const xObj = x as object;
    const yObj = y as object;
    if (
        (xObj as { constructor?: { name?: string } }).constructor?.name !== "Object" &&
        (xObj as { constructor?: { name?: string } }).constructor?.name !== "RegExp" &&
        (xObj as { constructor?: { name?: string } }).constructor?.name !== "Date" &&
        (xObj as { constructor?: { name?: string } }).constructor?.name !== "Array"
    ) {
        return false;
    }

    // check they are the same type of object
    if ((xObj as { prototype?: unknown }).prototype !== (yObj as { prototype?: unknown }).prototype) {
        return false;
    }

    // special-casing for some special types of object
    if (x instanceof RegExp || x instanceof Date) {
        return x.toString() === (y as RegExp | Date).toString();
    }

    // the object algorithm works for Array, but it's sub-optimal.
    if (Array.isArray(x)) {
        const xArr = x as unknown[];
        const yArr = y as unknown[];
        if (xArr.length !== yArr.length) {
            return false;
        }

        for (let i = 0; i < xArr.length; i++) {
            if (!deepCompare(xArr[i], yArr[i])) {
                return false;
            }
        }
    } else {
        const xRec = x as Record<string, unknown>; /* Dynamic: deep-compare any object */
        const yRec = y as Record<string, unknown>; /* Dynamic: deep-compare any object */
        // check that all of y's direct keys are in x
        for (const p in yRec) {
            if (Object.prototype.hasOwnProperty.call(yRec, p) !== Object.prototype.hasOwnProperty.call(xRec, p)) {
                return false;
            }
        }

        // finally, compare each of x's keys with y
        for (const p in xRec) {
            if (
                Object.prototype.hasOwnProperty.call(yRec, p) !== Object.prototype.hasOwnProperty.call(xRec, p) ||
                !deepCompare(xRec[p], yRec[p])
            ) {
                return false;
            }
        }
    }
    return true;
}

// Dev note: This returns an array of tuples, but jsdoc doesn't like that. https://github.com/jsdoc/jsdoc/issues/1703
/**
 * Creates an array of object properties/values (entries) then
 * sorts the result by key, recursively. The input object must
 * ensure it does not have loops. If the input is not an object
 * then it will be returned as-is.
 * @param obj - The object to get entries of
 * @returns The entries, sorted by key.
 */
export function deepSortedObjectEntries(obj: unknown): unknown {
    if (typeof obj !== "object") return obj;

    // Apparently these are object types...
    if (obj === null || obj === undefined || Array.isArray(obj)) return obj;

    const pairs: [string, unknown][] = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown> /* Dynamic: sort entries of any object */)) {
        pairs.push([k, deepSortedObjectEntries(v)]);
    }

    // lexicographicCompare is faster than localeCompare, so let's use that.
    pairs.sort((a, b) => lexicographicCompare(a[0], b[0]));

    return pairs;
}

/**
 * Determines whether two maps are equal.
 * @param eq - The equivalence relation to compare values by. Defaults to strict equality.
 */
export function mapsEqual<K, V>(x: Map<K, V>, y: Map<K, V>, eq = (v1: V, v2: V): boolean => v1 === v2): boolean {
    if (x.size !== y.size) return false;
    for (const [k, v1] of x) {
        const v2 = y.get(k);
        if (v2 === undefined || !eq(v1, v2)) return false;
    }
    return true;
}

function processMapToObjectValue(value: unknown): unknown {
    if (value instanceof Map) {
        // Value is a Map. Recursively map it to an object.
        return recursiveMapToObject(value);
    } else if (Array.isArray(value)) {
        // Value is an Array. Recursively map the value (e.g. to cover Array of Arrays).
        return value.map((v) => processMapToObjectValue(v));
    } else {
        return value;
    }
}

/**
 * Recursively converts Maps to plain objects.
 * Also supports sub-lists of Maps.
 */
export function recursiveMapToObject(
    map: Map<unknown, unknown>,
): Record<string, unknown> /* Dynamic: converts arbitrary Map to object */ {
    const targetMap = new Map<unknown, unknown>();

    for (const [key, value] of map) {
        targetMap.set(key, processMapToObjectValue(value));
    }

    return Object.fromEntries(targetMap.entries()) as Record<
        string,
        unknown
    > /* Dynamic: converts arbitrary Map to object */;
}

export class MapWithDefault<K, V> extends Map<K, V> {
    public constructor(private createDefault: () => V) {
        super();
    }

    /**
     * Returns the value if the key already exists.
     * If not, it creates a new value under that key using the ctor callback and returns it.
     */
    public getOrCreate(key: K): V {
        if (!this.has(key)) {
            this.set(key, this.createDefault());
        }

        return this.get(key)!;
    }
}

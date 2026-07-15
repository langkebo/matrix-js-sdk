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

import { type IEvent, type MatrixEvent } from "../models/event";
import { ReceiptType } from "../@types/read_receipts";

/**
 * Checks that the given object has the specified keys.
 * @param obj - The object to check.
 * @param keys - The list of keys that 'obj' must have.
 * @throws If the object is missing keys.
 */
// note using 'keys' here would shadow the 'keys' function defined above
export function checkObjectHasKeys(obj: object, keys: string[]): void {
    for (const key of keys) {
        if (!obj.hasOwnProperty(key)) {
            throw new Error("Missing required key: " + key);
        }
    }
}

/**
 * Returns whether the given value is a finite number without type-coercion
 *
 * @param value - the value to test
 * @returns whether or not value is a finite number without type-coercion
 */
export function isNumber(value: unknown): value is number {
    return typeof value === "number" && isFinite(value);
}

export function isNullOrUndefined(val: unknown): boolean {
    return val === null || val === undefined;
}

/**
 * This function is similar to Object.assign() but it assigns recursively and
 * allows you to ignore nullish values from the source
 *
 * @returns the target object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recursivelyAssign<T1 extends T2, T2 extends Record<string, any>>(
    target: T1,
    source: T2,
    ignoreNullish = false,
): T1 & T2 {
    for (const [sourceKey, sourceValue] of Object.entries(source)) {
        if (target[sourceKey] instanceof Object && sourceValue) {
            recursivelyAssign(target[sourceKey], sourceValue);
            continue;
        }
        if ((sourceValue !== null && sourceValue !== undefined) || !ignoreNullish) {
            safeSet(target, sourceKey, sourceValue);
            continue;
        }
    }
    return target as T1 & T2;
}

/**
 * Sort events by their content m.ts property
 * Latest timestamp first
 */
export function sortEventsByLatestContentTimestamp(left: MatrixEvent, right: MatrixEvent): number {
    const leftTs = Number(left.getContent()?.["m.ts"] ?? 0);
    const rightTs = Number(right.getContent()?.["m.ts"] ?? 0);
    return rightTs - leftTs;
}

export function isSupportedReceiptType(receiptType: string): boolean {
    return [ReceiptType.Read, ReceiptType.ReadPrivate].includes(receiptType as ReceiptType);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unsafeProp<K extends keyof any | undefined>(prop: K): boolean {
    return prop === "__proto__" || prop === "prototype" || prop === "constructor";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeSet<O extends Record<any, any>, K extends keyof O>(obj: O, prop: K, value: O[K]): void {
    if (unsafeProp(prop)) {
        throw new Error("Trying to modify prototype or constructor");
    }

    obj[prop] = value;
}

export function noUnsafeEventProps(event: Partial<IEvent>): boolean {
    return !(unsafeProp(event.room_id) || unsafeProp(event.sender) || unsafeProp(event.event_id));
}

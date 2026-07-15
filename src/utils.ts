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

/**
 * This is an internal module. Backward-compatible re-export barrel.
 * New code should import directly from the domain-specific modules:
 *   - src/common/async.ts       (sleep, logDuration, etc.)
 *   - src/common/strings.ts     (internaliseString, normalize, etc.)
 *   - src/common/collections.ts (deepCopy, MapWithDefault, etc.)
 *   - src/common/safety.ts      (safeSet, isNullOrUndefined, etc.)
 *   - src/http-api/utils.ts     (encodeParams, encodeUri, QueryDict, etc.)
 */

// Async utilities
export {
    sleep,
    logDuration,
    logDurationSync,
    promiseMapSeries,
    promiseTry,
    simpleRetryOperation,
} from "./common/async";

// String utilities
export {
    internaliseString,
    removeHiddenChars,
    removeDirectionOverrideChars,
    normalize,
    escapeRegExp,
    globToRegexp,
    DEFAULT_ALPHABET,
    alphabetPad,
    baseToString,
    stringToBase,
    averageBetweenStrings,
    nextString,
    prevString,
    lexicographicCompare,
} from "./common/strings";

// Collection utilities
export {
    removeElement,
    deepCopy,
    deepCompare,
    deepSortedObjectEntries,
    mapsEqual,
    recursiveMapToObject,
    MapWithDefault,
} from "./common/collections";

// Safety / type-guard utilities
export {
    checkObjectHasKeys,
    isNumber,
    isNullOrUndefined,
    recursivelyAssign,
    sortEventsByLatestContentTimestamp,
    isSupportedReceiptType,
    unsafeProp,
    safeSet,
    noUnsafeEventProps,
} from "./common/safety";

// HTTP utilities (live in http-api/utils.ts for domain coherence)
export { encodeParams, encodeUri, replaceParam, ensureNoTrailingSlash } from "./http-api/utils";
export type { QueryDict } from "./http-api/utils";

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

const interns = new Map<string, string>();

/**
 * Internalises a string, reusing a known pointer or storing the pointer
 * if needed for future strings.
 * @param str - The string to internalise.
 * @returns The internalised string.
 */
export function internaliseString(str: string): string {
    // Unwrap strings before entering the map, if we somehow got a wrapped
    // string as our input. This should only happen from tests.
    if ((str as unknown) instanceof String) {
        str = str.toString();
    }

    // Check the map to see if we can store the value
    if (!interns.has(str)) {
        interns.set(str, str);
    }

    // Return any cached string reference
    return interns.get(str)!;
}

/**
 * Removes zero width chars, diacritics and whitespace from the string
 * @param str - the string to remove hidden characters from
 * @returns a string with the hidden characters removed
 */
export function removeHiddenChars(str: string): string {
    if (typeof str === "string") {
        return str.normalize("NFD").replace(removeHiddenCharsRegex, "");
    }
    return "";
}

/**
 * Removes the direction override characters from a string
 * @returns string with chars removed
 */
export function removeDirectionOverrideChars(str: string): string {
    if (typeof str === "string") {
        return str.replace(/[‭-‮]/g, "");
    }
    return "";
}

export function normalize(str: string): string {
    // Note: we have to match the filter with the removeHiddenChars() because the
    // function strips spaces and other characters (M becomes RN for example, in lowercase).
    return (
        removeHiddenChars(str.toLowerCase())
            // Strip all punctuation
            .replace(/[\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~ -⁯⸀-⹿]/g, "")
            // We also doubly convert to lowercase to work around oddities of the library.
            .toLowerCase()
    );
}

// Regex matching bunch of unicode control characters and otherwise misleading/invisible characters.
// Includes:
// various width spaces U+2000 - U+200D
// LTR and RTL marks U+200E and U+200F
// LTR/RTL and other directional formatting marks U+202A - U+202F
// Arabic Letter RTL mark U+061C
// Combining characters U+0300 - U+036F
// Zero width no-break space (BOM) U+FEFF
// Blank/invisible characters (U2800, U2062-U2063)
const removeHiddenCharsRegex = /[ -‏‪- ̀-ͯ﻿؜⠀⁢-⁣\s]/g;

export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Converts Matrix glob-style string to a regular expression
 * https://spec.matrix.org/v1.7/appendices/#glob-style-matching
 * @param glob - Matrix glob-style string
 * @returns regular expression
 */
export function globToRegexp(glob: string): string {
    return escapeRegExp(glob).replace(/\\\*/g, ".*").replace(/\?/g, ".");
}

// String averaging inspired by https://stackoverflow.com/a/2510816
// Dev note: We make the alphabet a string because it's easier to write syntactically
// than arrays. Thankfully, strings implement the useful parts of the Array interface
// anyhow.

/**
 * The default alphabet used by string averaging in this SDK. This matches
 * all usefully printable ASCII characters (0x20-0x7E, inclusive).
 */
export const DEFAULT_ALPHABET = ((): string => {
    let str = "";
    for (let c = 0x20; c <= 0x7e; c++) {
        str += String.fromCharCode(c);
    }
    return str;
})();

/**
 * Pads a string using the given alphabet as a base. The returned string will be
 * padded at the end with the first character in the alphabet.
 *
 * This is intended for use with string averaging.
 * @param s - The string to pad.
 * @param n - The length to pad to.
 * @param alphabet - The alphabet to use as a single string.
 * @returns The padded string.
 */
export function alphabetPad(s: string, n: number, alphabet = DEFAULT_ALPHABET): string {
    return s.padEnd(n, alphabet[0]);
}

/**
 * Converts a baseN number to a string, where N is the alphabet's length.
 *
 * This is intended for use with string averaging.
 * @param n - The baseN number.
 * @param alphabet - The alphabet to use as a single string.
 * @returns The baseN number encoded as a string from the alphabet.
 */
export function baseToString(n: bigint, alphabet = DEFAULT_ALPHABET): string {
    // Developer note: the stringToBase() function offsets the character set by 1 so that repeated
    // characters (ie: "aaaaaa" in a..z) don't come out as zero. We have to reverse this here as
    // otherwise we'll be wrong in our conversion. Undoing a +1 before an exponent isn't very fun
    // though, so we rely on a lengthy amount of `x - 1` and integer division rules to reach a
    // sane state. This also means we have to do rollover detection: see below.

    const len = BigInt(alphabet.length);
    if (n <= len) {
        return alphabet[Number(n) - 1] ?? "";
    }

    let d = n / len;
    let r = Number(n % len) - 1;

    // Rollover detection: if the remainder is negative, it means that the string needs
    // to roll over by 1 character downwards (ie: in a..z, the previous to "aaa" would be
    // "zz").
    if (r < 0) {
        d -= BigInt(Math.abs(r)); // abs() is just to be clear what we're doing. Could also `+= r`.
        r = Number(len) - 1;
    }

    return baseToString(d, alphabet) + alphabet[r];
}

/**
 * Converts a string to a baseN number, where N is the alphabet's length.
 *
 * This is intended for use with string averaging.
 * @param s - The string to convert to a number.
 * @param alphabet - The alphabet to use as a single string.
 * @returns The baseN number.
 */
export function stringToBase(s: string, alphabet = DEFAULT_ALPHABET): bigint {
    const len = BigInt(alphabet.length);

    // In our conversion to baseN we do a couple performance optimizations to avoid using
    // excess CPU and such. To create baseN numbers, the input string needs to be reversed
    // so the exponents stack up appropriately, as the last character in the unreversed
    // string has less impact than the first character (in "abc" the A is a lot more important
    // for lexicographic sorts). We also do a trick with the character codes to optimize the
    // alphabet lookup, avoiding an index scan of `alphabet.indexOf(reversedStr[i])` - we know
    // that the alphabet and (theoretically) the input string are constrained on character sets
    // and thus can do simple subtraction to end up with the same result.

    // Developer caution: we carefully cast to BigInt here to avoid losing precision. We cannot
    // rely on Math.pow() (for example) to be capable of handling our insane numbers.

    let result = BigInt(0);
    for (let i = s.length - 1, j = BigInt(0); i >= 0; i--, j++) {
        const charIndex = s.charCodeAt(i) - alphabet.charCodeAt(0);

        // We add 1 to the char index to offset the whole numbering scheme. We unpack this in
        // the baseToString() function.
        result += BigInt(1 + charIndex) * len ** j;
    }
    return result;
}

/**
 * Averages two strings, returning the midpoint between them. This is accomplished by
 * converting both to baseN numbers (where N is the alphabet's length) then averaging
 * those before re-encoding as a string.
 * @param a - The first string.
 * @param b - The second string.
 * @param alphabet - The alphabet to use as a single string.
 * @returns The midpoint between the strings, as a string.
 */
export function averageBetweenStrings(a: string, b: string, alphabet = DEFAULT_ALPHABET): string {
    const padN = Math.max(a.length, b.length);
    const baseA = stringToBase(alphabetPad(a, padN, alphabet), alphabet);
    const baseB = stringToBase(alphabetPad(b, padN, alphabet), alphabet);
    const avg = (baseA + baseB) / BigInt(2);

    // Detect integer division conflicts. This happens when two numbers are divided too close so
    // we lose a .5 precision. We need to add a padding character in these cases.
    if (avg === baseA || avg == baseB) {
        return baseToString(avg, alphabet) + alphabet[0];
    }

    return baseToString(avg, alphabet);
}

/**
 * Finds the next string using the alphabet provided. This is done by converting the
 * string to a baseN number, where N is the alphabet's length, then adding 1 before
 * converting back to a string.
 * @param s - The string to start at.
 * @param alphabet - The alphabet to use as a single string.
 * @returns The string which follows the input string.
 */
export function nextString(s: string, alphabet = DEFAULT_ALPHABET): string {
    return baseToString(stringToBase(s, alphabet) + BigInt(1), alphabet);
}

/**
 * Finds the previous string using the alphabet provided. This is done by converting the
 * string to a baseN number, where N is the alphabet's length, then subtracting 1 before
 * converting back to a string.
 * @param s - The string to start at.
 * @param alphabet - The alphabet to use as a single string.
 * @returns The string which precedes the input string.
 */
export function prevString(s: string, alphabet = DEFAULT_ALPHABET): string {
    return baseToString(stringToBase(s, alphabet) - BigInt(1), alphabet);
}

/**
 * Compares strings lexicographically as a sort-safe function.
 * @param a - The first (reference) string.
 * @param b - The second (compare) string.
 * @returns Negative if the reference string is before the compare string;
 * positive if the reference string is after; and zero if equal.
 */
export function lexicographicCompare(a: string, b: string): number {
    // Dev note: this exists because I'm sad that you can use math operators on strings, so I've
    // hidden the operation in this function.
    if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    } else {
        return 0;
    }
}

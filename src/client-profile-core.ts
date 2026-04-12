export function assertExtendedProfileSupported(supported: boolean): void {
    if (!supported) {
        throw new Error("Server does not support extended profiles");
    }
}

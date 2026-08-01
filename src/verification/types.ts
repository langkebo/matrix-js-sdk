/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

    http://www.apache.org/licenses/LICENSE-2.0
*/

/**
 * Verification types — SAS (Short Authentication String) verification types.
 *
 * This module provides type definitions for SAS-based key verification,
 * used during interactive device/user verification flows.
 *
 * @packageDocumentation
 */

/**
 * A generated SAS (Short Authentication String) to be shown to the user, in alternative formats.
 *
 * SAS is used during interactive verification to allow users to confirm that
 * the devices they are communicating with are the intended ones.
 */
export interface GeneratedSas {
    /**
     * The SAS as three numbers between 0 and 8191.
     *
     * Only populated if the `decimal` SAS method was negotiated.
     */
    decimal?: [number, number, number];

    /**
     * The SAS as seven emojis.
     *
     * Only populated if the `emoji` SAS method was negotiated.
     */
    emoji?: EmojiMapping[];
}

/**
 * An emoji for the generated SAS.
 *
 * A tuple `[emoji, name]` where `emoji` is the emoji itself and `name` is the English name.
 *
 * @example
 * const emojiMapping: EmojiMapping = ["🐶", "dog"];
 */
export type EmojiMapping = [emoji: string, name: string];

/**
 * Callbacks for user actions while a SAS is displayed.
 *
 * This is exposed as the payload of a `VerifierEvent.ShowSas` event,
 * or directly from the verifier as `sasEvent`.
 *
 * @example
 * const callbacks: ShowSasCallbacks = {
 *     sas: { decimal: [1234, 5678, 9012] },
 *     confirm: async () => { /* user confirmed *-/ },
 *     mismatch: () => { /* user rejected *-/ },
 *     cancel: () => { /* user cancelled *-/ }
 * };
 */
export interface ShowSasCallbacks {
    /** The generated SAS to be shown to the user */
    sas: GeneratedSas;

    /**
     * Function to call if the user confirms that the SAS matches.
     *
     * @returns A Promise that completes once the m.key.verification.mac is queued.
     */
    confirm(): Promise<void>;

    /**
     * Function to call if the user finds the SAS does not match.
     *
     * Sends an `m.key.verification.cancel` event with a `m.mismatched_sas` error code.
     */
    mismatch(): void;

    /** Cancel the verification flow */
    cancel(): void;
}

/**
 * SAS method identifiers used in key verification.
 *
 * These are the standardized method names for SAS-based verification
 * as defined in the Matrix specification.
 */
export enum SasMethod {
    /** SAS verification using emoji comparison */
    Emoji = "m.sas.v1.emoji",

    /** SAS verification using decimal number comparison */
    Decimal = "m.sas.v1.decimal",

    /** General SAS v1 method */
    SasV1 = "m.sas.v1",
}

/**
 * Key agreement protocols supported for SAS verification.
 *
 * These define the cryptographic protocols used for
 * establishing shared secrets during verification.
 */
export enum KeyAgreementProtocol {
    /** Curve25519-based key agreement (default) */
    Curve25519 = "curve25519",

    /** Curve25519 with HKDF key derivation */
    Curve25519Hkdf = "curve25519-hkdf-sha256",
}

/**
 * Hash algorithms supported for SAS verification.
 */
export enum SasHashAlgorithm {
    /** SHA-256 hash algorithm */
    Sha256 = "sha256",

    /** SHA-512 hash algorithm */
    Sha512 = "sha512",
}

/**
 * MAC (Message Authentication Code) algorithms for SAS verification.
 */
export enum SasMacAlgorithm {
    /** HMAC with SHA-256 */
    HmacSha256 = "hkdf-hmac-sha256",

    /** HMAC with SHA-512 */
    HmacSha512 = "hkdf-hmac-sha512",
}

/**
 * SAS verification state during the verification flow.
 *
 * Tracks the current stage of the SAS verification process.
 */
export enum SasVerificationState {
    /** Initial state, waiting for key agreement */
    KeyAgreement = "key_agreement",

    /** Waiting for MAC (Message Authentication Code) from other party */
    WaitingForMac = "waiting_for_mac",

    /** Waiting for user to confirm SAS matches */
    WaitingForUserConfirmation = "waiting_for_user_confirmation",

    /** Verification completed successfully */
    Verified = "verified",

    /** Verification was cancelled */
    Cancelled = "cancelled",
}

/**
 * Configuration options for SAS verification.
 *
 * Used when initiating or responding to a SAS verification request.
 */
export interface SasVerificationConfig {
    /**
     * Key agreement protocol to use.
     * Defaults to {@link KeyAgreementProtocol.Curve25519}.
     */
    keyAgreementProtocol?: KeyAgreementProtocol;

    /**
     * Hash algorithm to use.
     * Defaults to {@link SasHashAlgorithm.Sha256}.
     */
    hash?: SasHashAlgorithm;

    /**
     * MAC algorithm to use.
     * Defaults to {@link SasMacAlgorithm.HmacSha256}.
     */
    mac?: SasMacAlgorithm;

    /**
     * Short authentication string methods supported.
     * Should include at least one of "emoji" or "decimal".
     */
    shortAuthenticationString?: Array<"emoji" | "decimal">;
}

/**
 * Result of a successful SAS verification.
 */
export interface SasVerificationResult {
    /** Whether the verification was successful */
    success: boolean;

    /** Transaction ID of the verification */
    transactionId: string;

    /** The method used (emoji or decimal) */
    method: "emoji" | "decimal";

    /** The SAS that was displayed/confirmed */
    sas?: GeneratedSas;
}

/**
 * Error codes specific to SAS verification failures.
 */
export enum SasErrorCode {
    /** The SAS did not match between the two parties */
    MismatchedSas = "m.mismatched_sas",

    /** The user cancelled the verification */
    UserCancelled = "m.user",

    /** Timeout waiting for user confirmation */
    Timeout = "m.timeout",

    /** Invalid key agreement response */
    InvalidKeyAgreement = "m.invalid_key_agreement",

    /** MAC verification failed */
    InvalidMac = "m.invalid_mac",
}

/**
 * SAS commitment data exchanged during key agreement phase.
 */
export interface SasCommitment {
    /** Base64-encoded commitment string */
    commitment: string;
}

/**
 * Key agreement request data for SAS verification.
 */
export interface SasKeyAgreement {
    /** Curve25519 public key (base64 encoded) */
    pubkey: string;
}

/**
 * MAC (Message Authentication Code) data for SAS verification.
 */
export interface SasMacData {
    /** Transaction ID */
    transactionId: string;

    /** MAC value (base64 encoded) */
    mac: string;

    /** MAC of the key (base64 encoded) */
    keyMac?: string;
}

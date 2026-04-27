import { ValidationError } from "../errors";

/**
 * Invalid parameter error.
 *
 * Kept as a distinct class for API ergonomics, but extends {@link ValidationError}
 * so generic validation callers and `instanceof ValidationError` checks continue
 * to work after the 2026 validator unification.
 */
export class InvalidParamError extends ValidationError {
    public constructor(message: string, cause?: unknown) {
        super(message, cause);
        this.name = "InvalidParamError";
    }
}

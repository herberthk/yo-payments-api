/**
 * Error thrown for transport-level and protocol-level failures:
 * connection errors, timeouts, non-2xx HTTP statuses, oversized bodies,
 * malformed XML and responses missing the <Response> node.
 * Gateway-level business failures (e.g. Status FAILED) are still returned
 * as normal response objects, exactly like the PHP library.
 */
export class YoAPIError extends Error {
    /** HTTP status code when the failure came with an HTTP response. */
    readonly status?: number;
    /** Truncated response body (up to 500 chars) when one was received. */
    readonly body?: string;

    constructor(message: string, options?: { status?: number; body?: string; cause?: unknown }) {
        super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = "YoAPIError";
        this.status = options?.status;
        this.body = options?.body;
    }
}

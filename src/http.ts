import { YoAPIError } from "./errors.ts";

export interface PostXmlOptions {
    /** Request timeout in milliseconds; <= 0 disables the timeout (like PHP curl). */
    timeoutMs: number;
    /** Whether to verify the gateway TLS certificate. */
    verifyTls: boolean;
    /** Maximum accepted response body in bytes. */
    maxResponseBytes: number;
}

/** POST raw XML to the gateway and return the XML response body. */
export async function postXml(url: string, xml: string, options: PostXmlOptions): Promise<string> {
    const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
        method: "POST",
        body: xml,
        headers: {
            "Content-Type": "text/xml",
            "Content-transfer-encoding": "text",
            "Content-Length": String(Buffer.byteLength(xml)),
        },
    };

    // A timeout <= 0 means "no timeout", mirroring PHP's curl timeout semantics.
    if (options.timeoutMs > 0) {
        init.signal = AbortSignal.timeout(options.timeoutMs);
    }

    // TLS is verified by default (unlike the PHP library). The `tls` key is a
    // Bun fetch extension; on Node.js, disabling verification additionally
    // requires NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment.
    if (!options.verifyTls) {
        init.tls = { rejectUnauthorized: false };
    }

    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (error) {
        throw new YoAPIError(
            `Request to the Yo! Payments gateway failed: ${(error as Error)?.message ?? error}`,
            { cause: error },
        );
    }

    const text = await readBoundedText(res, options.maxResponseBytes);

    if (!res.ok) {
        throw new YoAPIError(`Yo! Payments gateway responded with HTTP ${res.status}`, {
            status: res.status,
            body: text.slice(0, 500),
        });
    }

    return text;
}

/** Read the response body, enforcing a byte limit to bound memory use. */
async function readBoundedText(res: Response, limit: number): Promise<string> {
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > limit) {
        throw new YoAPIError(
            `Yo! Payments gateway response (${declared} bytes) exceeds the limit of ${limit} bytes`,
        );
    }

    if (res.body === null) {
        return "";
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
                await reader.cancel().catch(() => undefined);
                throw new YoAPIError(
                    `Yo! Payments gateway response exceeds the limit of ${limit} bytes`,
                );
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(chunks).toString("utf-8");
}

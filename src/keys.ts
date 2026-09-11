import { createPublicKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

interface CachedPublicKey {
    size: number;
    mtimeMs: number;
    key: KeyObject;
}

/** Verification-key cache so IPN endpoints don't re-read the certificate per request. */
const publicKeyCache = new Map<string, CachedPublicKey>();

/** Load (and cache) a PEM public key/certificate; null when unreadable or invalid. */
export function loadPublicKeyCached(filePath: string, fallbackPem?: string): KeyObject | null {
    const fromFile = loadFromFile(filePath);
    if (fromFile !== null) return fromFile;

    if (fallbackPem === undefined) return null;

    // Fallback results are deliberately not cached: a later-appearing file
    // must always win over the embedded certificate.
    try {
        return createPublicKey(fallbackPem);
    } catch {
        return null;
    }
}

function loadFromFile(filePath: string): KeyObject | null {
    let size: number;
    let mtimeMs: number;
    try {
        const stat = statSync(filePath);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
    } catch {
        return null;
    }

    const cached = publicKeyCache.get(filePath);
    if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs) {
        return cached.key;
    }

    try {
        const key = createPublicKey(readFileSync(filePath, "utf-8"));
        publicKeyCache.set(filePath, { size, mtimeMs, key });
        return key;
    } catch {
        return null;
    }
}

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { YoAPIError } from "./errors.ts";

export type XmlNode = Record<string, any>;

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/** Shared response parser (XMLParser instances are stateless across parse calls). */
const responseParser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
});

export function el(tag: string, value: string | number): string {
    return `<${tag}>${value}</${tag}>`;
}

/** Mirrors PHP's `if ($value != NULL)` check: null, undefined and "" are all skipped. */
export function opt(tag: string, value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "") return "";
    return el(tag, value);
}

/** Mirrors PHP's `(string)` cast on a SimpleXMLElement child. */
export function str(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return "";
    return String(value);
}

/** Mirrors PHP's `!empty($response->X)`: include only when the string value is non-empty (PHP also treats "0" as empty). */
export function setIfNonEmpty<T extends object, K extends keyof T>(target: T, key: K, value: string): void {
    if (value !== "" && value !== "0") (target as Record<string, unknown>)[key as string] = value;
}

/** Mirrors PHP's `if ($response->X != null)`: include when the element exists with a non-empty value ("0" included). */
export function setIfNotNull<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
    if (value === undefined || value === null) return;
    if (typeof value === "object") return;
    if (String(value) !== "") (target as Record<string, unknown>)[key as string] = String(value);
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

export function asRecord(value: unknown): XmlNode {
    if (value === undefined || value === null || typeof value !== "object") return {};
    return value as XmlNode;
}

/**
 * Validate gateway response XML and return the parsed envelope node that holds
 * the <Response> child. Throws YoAPIError on malformed XML or a missing node.
 */
export function parseGatewayResponse(responseXml: string): XmlNode {
    const validation = XMLValidator.validate(responseXml);
    if (validation !== true) {
        throw new YoAPIError(`Invalid XML response from the Yo! Payments gateway: ${validation.err.msg}`, {
            body: responseXml.slice(0, 500),
        });
    }

    const doc = asRecord(responseParser.parse(responseXml));

    if (doc.Response !== undefined) return doc;

    for (const value of Object.values(doc)) {
        const node = asRecord(value);
        if (node.Response !== undefined) return node;
    }

    throw new YoAPIError("Yo! Payments gateway response did not contain a <Response> node", {
        body: responseXml.slice(0, 500),
    });
}

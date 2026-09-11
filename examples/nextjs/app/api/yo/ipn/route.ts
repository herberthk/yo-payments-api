/**
 * Instant Payment Notification (IPN) endpoint.
 *
 * In your Next.js app this lives at app/api/yo/ipn/route.ts and is registered
 * as the InstantNotificationUrl of your deposit requests. Add
 * `import "server-only";` at the top (with `npm i server-only`).
 */
import { handlePaymentNotification } from "../../../../../receive_payment_notification.ts";
import { getYoClient } from "../../../../lib/yo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formToRecord(form: { entries(): IterableIterator<[string, unknown]> }): Record<string, string> {
    const body: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
        if (typeof value === "string") body[key] = value;
    }
    return body;
}

export async function POST(req: Request): Promise<Response> {
    const message = handlePaymentNotification(getYoClient(), formToRecord(await req.formData()));

    if (message === "") {
        // Signature invalid (or certificate misconfigured) — do not credit anything.
        return new Response("NOT VERIFIED", { status: 400 });
    }

    // TODO: persist the payment and mark it processed idempotently on
    // external_ref — notifications carry no replay protection.
    return new Response("OK");
}

/**
 * Payment failure notification endpoint.
 *
 * In your Next.js app this lives at app/api/yo/failure/route.ts and is
 * registered as the FailureNotificationUrl of your deposit requests. Add
 * `import "server-only";` at the top (with `npm i server-only`).
 */
import { handlePaymentFailureNotification } from "../../../../../receive_payment_failure_notification.ts";
import { getYoClient } from "../../../../lib/yo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
    const form = await req.formData();
    const body: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
        if (typeof value === "string") body[key] = value;
    }

    const message = handlePaymentFailureNotification(getYoClient(), body);

    if (message === "") {
        return new Response("NOT VERIFIED", { status: 400 });
    }

    // TODO: mark the transaction failed where the external reference matches
    // message's failed transaction reference.
    return new Response("OK");
}

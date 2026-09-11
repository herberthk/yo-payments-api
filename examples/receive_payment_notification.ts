/**
 * This example shows how to decode and verify a payment request that has been successful.
 * This handler should run at the instant notification url set when making the deposit request.
 *
 * Port of examples/receivePaymentNotification.php.
 */
import { YoAPI } from "../index.ts";
import type { PaymentNotificationBody } from "../index.ts";

/** Parsed `application/x-www-form-urlencoded` POST body Yo! Payments sends to the IPN url. */
export type FormBody = Record<string, string | undefined>;

/**
 * Verify a successful payment notification and format the payment details.
 * Returns an empty string when the notification cannot be verified.
 */
export function handlePaymentNotification(api: YoAPI, form: FormBody): string {
    const body: PaymentNotificationBody = {
        date_time: form.date_time ?? "",
        amount: form.amount ?? "",
        narrative: form.narrative ?? "",
        network_ref: form.network_ref ?? "",
        external_ref: form.external_ref ?? "",
        msisdn: form.msisdn ?? "",
        signature: form.signature ?? "",
    };

    const response = api.receivePaymentNotification(body);
    if (response.is_verified) {
        // Notification is from Yo! Uganda Limited.
        // Update your transaction status in the db where the external_ref = response.external_ref.
        // Guard against replays: skip external_ref values you have already processed.
        return (
            "Payment Details: \n" +
            `MSISDN: ${response.msisdn}\n` +
            `DATE: ${response.date_time}\n` +
            `NARRATIVE: ${response.narrative}\n` +
            `AMOUNT: ${response.amount}\n` +
            `MOBILE NETWORK REFERENCE: ${response.network_ref}\n` +
            `EXTERNAL REFERENCE: ${response.external_ref}`
        );
    }
    return "";
}

if (import.meta.main) {
    // Demo: verify a notification POSTed to this process's stdin is out of scope —
    // wire handlePaymentNotification into your HTTP server instead, e.g. with Bun:
    //
    //   Bun.serve({
    //       port: 3000,
    //       async fetch(req) {
    //           const form = Object.fromEntries((await req.formData()).entries());
    //           const message = handlePaymentNotification(createClientFromEnv(), form);
    //           return new Response(message === "" ? "NOT VERIFIED" : message);
    //       },
    //   });
    console.log("Import handlePaymentNotification into your IPN endpoint — see this file for a Bun.serve sketch.");
}

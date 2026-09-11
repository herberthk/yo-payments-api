/**
 * This example shows how to decode and verify a payment request that has failed.
 * This handler should run at the failure notification url set when making the deposit request.
 *
 * Port of examples/receivePaymentFailureNotification.php.
 */
import { YoAPI } from "../index.ts";
import type { PaymentFailureNotificationBody } from "../index.ts";
import type { FormBody } from "./receive_payment_notification.ts";

/**
 * Verify a failed payment notification and format the failure details.
 * Returns an empty string when the notification cannot be verified.
 */
export function handlePaymentFailureNotification(api: YoAPI, form: FormBody): string {
    const body: PaymentFailureNotificationBody = {
        failed_transaction_reference: form.failed_transaction_reference ?? "",
        transaction_init_date: form.transaction_init_date ?? "",
        verification: form.verification ?? "",
    };

    const response = api.receivePaymentFailureNotification(body);
    if (response.is_verified) {
        // Notification is from Yo! Uganda Limited.
        // Update your transaction status in the db where the
        // external_ref = response.failed_transaction_reference.
        return (
            "Failed Transaction Details: \n" +
            `FAILED TRANSACTION REFERENCE: ${response.failed_transaction_reference}\n` +
            `TRANSACTION INITIATION DATE: ${response.transaction_init_date}`
        );
    }
    return "";
}

if (import.meta.main) {
    console.log("Import handlePaymentFailureNotification into your failure-notification endpoint.");
}

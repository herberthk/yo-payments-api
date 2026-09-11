/**
 * This example shows settings to use when submitting a request to get a USSD mobile money PIN
 * prompt to transfer funds from a mobile money user to your Yo! Payments Account without having
 * to wait for a response from the user.
 *
 * Port of examples/deposit_funds_nonblocking.php. Run with:
 *
 *   YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/deposit_funds_nonblocking.ts
 */
import { YoAPI } from "../index.ts";
import { createClientFromEnv, sleep, uniqueReference } from "./shared.ts";

export interface NonBlockingDepositOptions {
    msisdn?: string;
    amount?: number;
    narrative?: string;
    instantNotificationUrl?: string;
    failureNotificationUrl?: string;
    /** How long to wait before checking the transaction status (PHP example sleeps 25s). */
    waitMs?: number;
}

export async function checkTransaction(api: YoAPI, transactionReference: string): Promise<string> {
    const transaction = await api.acTransactionCheckStatus(null, transactionReference);
    if (transaction.TransactionStatus === "SUCCEEDED") {
        // Transaction was completed and funds were deposited onto the account
        // Save data into the database
        return "Transaction was successful ";
    }
    return `Transaction is still in ${transaction.TransactionStatus} state.`;
}

export async function depositFundsNonBlocking(api: YoAPI, options: NonBlockingDepositOptions = {}): Promise<string> {
    const {
        msisdn = "256770000000",
        amount = 1000,
        narrative = "Reason for transfer of funds",
        instantNotificationUrl = "example.com/ipn.php",
        failureNotificationUrl = "example.com/fpn.php",
        waitMs = 25_000,
    } = options;

    // Create a unique transaction reference that you will reference this payment with
    const transactionReference = uniqueReference();
    api.setExternalReference(transactionReference);

    // Set nonblocking to TRUE so that you get an instant response
    api.setNonblocking("TRUE");

    // Set an instant notification url where a successful payment notification POST will be sent
    // See documentation on how to handle IPN
    api.setInstantNotificationUrl(instantNotificationUrl);

    // Set a failure notification url where a failed payment notification POST will be sent
    // See documentation on how to handle IPNs
    api.setFailureNotificationUrl(failureNotificationUrl);

    const response = await api.acDepositFunds(msisdn, amount, narrative);

    // Wait a little and check for the status of the transaction.
    await sleep(waitMs);
    const statusMessage = await checkTransaction(api, transactionReference);

    if (response.Status === "OK") {
        // Save this transaction for future reference
        return (
            `${statusMessage}\nWaiting for user to confirm mobile money transfer. ` +
            `You can check using this Transaction Reference = ${response.TransactionReference}. ` +
            "Thank you for using Yo! Payments"
        );
    }
    return `Yo Payments Error: ${response.StatusMessage}`;
}

if (import.meta.main) {
    console.log(await depositFundsNonBlocking(createClientFromEnv()));
}

/**
 * This example shows settings to use when submitting a request to get a USSD mobile money PIN
 * prompt to transfer funds from a mobile money user to your Yo! Payments Account.
 *
 * Port of examples/deposit_funds.php. Run with:
 *
 *   YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/deposit_funds.ts
 */
import { YoAPI } from "../index.ts";
import { createClientFromEnv, uniqueReference } from "./shared.ts";

export async function depositFunds(
    api: YoAPI,
    msisdn = "256786740360",
    amount = 100000,
    narrative = "Reason for transfer of funds",
): Promise<string> {
    // Create a unique transaction reference that you will reference this payment with
    api.setExternalReference(uniqueReference());
    api.setNonblocking("TRUE");
    

    const response = await api.acDepositFunds(msisdn, amount, narrative);

    console.log('full response', response)
    if (response.Status === "OK") {
        // Save this transaction for future reference
        return (
            "Payment made! Funds have been deposited onto your account. " +
            `Transaction Reference = ${response.TransactionReference}. Thank you for using Yo! Payments`
        );
    }
    return `Yo Payments Error: ${response.StatusMessage}`;
}

if (import.meta.main) {
    console.log(await depositFunds(createClientFromEnv()));
}

/**
 * Withdraw funds with public key authentication.
 *
 * Port of examples/withdraw_funds_public_key_authentication.php. Run with:
 *
 *   YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox \
 *   YO_PRIVATE_KEY_FILE=/path/to/private-key.pem \
 *   bun run examples/withdraw_funds_public_key_authentication.ts
 */
import { YoAPI } from "../index.ts";
import { createClientFromEnv, uniqueReference } from "./shared.ts";

export interface WithdrawOptions {
    msisdn?: string;
    amount?: number | string;
    narrative?: string;
    privateKeyFile?: string;
}

export async function withdrawWithPublicKeyAuth(api: YoAPI, options: WithdrawOptions = {}): Promise<string> {
    const {
        msisdn = "2567......",
        amount = "1000",
        narrative = "ac_withdraw_funds payments test with public key authentication signature",
        privateKeyFile = process.env.YO_PRIVATE_KEY_FILE ?? "path/to/private/key",
    } = options;

    try {
        api.setExternalReference(uniqueReference());
        api.setPrivateKeyFileLocation(privateKeyFile);
        api.setPublicKeyAuthenticationNonce(uniqueReference());
        api.generatePublicKeyAuthenticationSignature(msisdn, amount, narrative);
        const response = await api.acWithdrawFunds(msisdn, amount, narrative);

        if (response.TransactionStatus === "SUCCEEDED") {
            // Save this transaction for future reference
            return (
                "Payment made! Funds have been deposited onto your account. " +
                `Transaction Reference = ${response.TransactionReference}. Thank you for using Yo! Payments`
            );
        }
        return `Yo Payments Error: ${response.StatusMessage}`;
    } catch (e) {
        return `Caught exception: ${(e as Error).message}`;
    }
}

if (import.meta.main) {
    console.log(await withdrawWithPublicKeyAuth(createClientFromEnv()));
}

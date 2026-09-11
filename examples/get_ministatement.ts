/**
 * This example shows settings to use when obtaining the ministatement of your
 * Yo! Payments Account.
 *
 * Port of examples/get_ministatement.php. Run with:
 *
 *   YO_API_USERNAME=... YO_API_PASSWORD=... YO_API_MODE=sandbox bun run examples/get_ministatement.ts
 */
import { YoAPI } from "../index.ts";
import type { TransactionDetail } from "../index.ts";
import { createClientFromEnv } from "./shared.ts";

export interface MinistatementQuery {
    startDate: string | null;
    endDate: string | null;
    transactionStatus: string | null;
    currencyCode: string | null;
    resultSetLimit: number | null;
    transactionEntryDesignation?: string;
}

/**
 * Run one ministatement query and format the result the way the PHP example
 * prints it (`print_r($response['Transactions'])` on success).
 */
export async function fetchMinistatement(api: YoAPI, query: MinistatementQuery): Promise<string> {
    const response = await api.acGetMinistatement(
        query.startDate,
        query.endDate,
        query.transactionStatus,
        query.currencyCode,
        query.resultSetLimit,
        query.transactionEntryDesignation ?? "ANY",
    );

    if (response.Status === "OK") {
        // This returns an array of all the transactions in that period.
        return formatTransactions(response.Transactions);
    }
    // Note: ministatement responses carry no StatusMessage (matching the PHP
    // library), so report the gateway error details instead.
    return `Yo Payments Error: ${response.ErrorMessage ?? response.StatusCode}`;
}

export function formatTransactions(transactions: TransactionDetail[]): string {
    return JSON.stringify(transactions, null, 2);
}

/**
 * Run the three queries from the PHP example: MTN mobile money, Airtel money,
 * then the latest transactions (including charges).
 */
export async function getMinistatementExamples(api: YoAPI): Promise<string[]> {
    // A statement for 26th October 2017 for all (excluding charges) MTN mobile
    // money transactions that were successful.
    const mtn = await fetchMinistatement(api, {
        startDate: "2017-10-26 00:00:00",
        endDate: "2017-10-26 23:59:59",
        transactionStatus: "SUCCEEDED",
        currencyCode: "UGX-MTNMM",
        resultSetLimit: 0,
        transactionEntryDesignation: "TRANSACTION",
    });

    // Same, but for Airtel money. Note the currency code 'UGX-WARIDMM'.
    const airtel = await fetchMinistatement(api, {
        startDate: "2017-10-26 00:00:00",
        endDate: "2017-10-26 23:59:59",
        transactionStatus: "SUCCEEDED",
        currencyCode: "UGX-WARIDMM",
        resultSetLimit: 0,
        transactionEntryDesignation: "TRANSACTION",
    });

    // The latest transactions (including charges).
    const general = await fetchMinistatement(api, {
        startDate: null,
        endDate: null,
        transactionStatus: null,
        currencyCode: null,
        resultSetLimit: null,
    });

    return [mtn, airtel, general];
}

if (import.meta.main) {
    for (const statement of await getMinistatementExamples(createClientFromEnv())) {
        console.log(statement);
    }
}

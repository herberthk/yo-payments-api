import { YoAPI } from "../index.ts";
import { createClientFromEnv } from "./shared.ts";


async function getAccountBalance(api: YoAPI) {
    const balance = await api.acAcctBalance();
    return balance;
}


if (import.meta.main) {
    console.log(await getAccountBalance(createClientFromEnv()));
}
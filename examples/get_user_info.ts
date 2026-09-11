import { YoAPI } from "../index.ts";
import { createClientFromEnv } from "./shared.ts";


async function getUserInfo(api: YoAPI) {
    const userInfo = await api.acGetMsisdnKycInfo("256703752696");
    return userInfo;
}


if (import.meta.main) {
    console.log(await getUserInfo(createClientFromEnv()));
}
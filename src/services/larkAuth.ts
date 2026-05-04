import { readFile, writeFile } from "node:fs/promises";
import { createLarkClient, userTokenOption, assertLarkOk } from "./larkClient.js";

export class LarkUserAuthRequiredError extends Error {
  constructor() {
    super("Lark user OAuth is required. Set LARK_USER_ACCESS_TOKEN or LARK_USER_TOKEN_FILE with a delegated user token.");
    this.name = "LarkUserAuthRequiredError";
  }
}

type StoredUserToken = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  refresh_expires_at?: number;
};

function tokenFilePath() {
  return process.env.LARK_USER_TOKEN_FILE || ".lark-user-token.json";
}

async function readStoredToken(): Promise<StoredUserToken> {
  if (process.env.LARK_USER_ACCESS_TOKEN) {
    return {
      access_token: process.env.LARK_USER_ACCESS_TOKEN,
      ...(process.env.LARK_USER_REFRESH_TOKEN ? { refresh_token: process.env.LARK_USER_REFRESH_TOKEN } : {})
    };
  }

  try {
    const raw = await readFile(tokenFilePath(), "utf8");
    return JSON.parse(raw) as StoredUserToken;
  } catch {
    return {};
  }
}

async function writeStoredToken(token: StoredUserToken) {
  if (process.env.LARK_USER_ACCESS_TOKEN) return;

  await writeFile(tokenFilePath(), `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
}

function shouldRefresh(token: StoredUserToken) {
  if (!token.refresh_token) return false;
  if (!token.access_token) return true;
  if (!token.expires_at) return false;

  return token.expires_at - Math.floor(Date.now() / 1000) < 300;
}

export async function getLarkUserAccessToken() {
  const token = await readStoredToken();

  if (!shouldRefresh(token)) {
    if (!token.access_token) throw new LarkUserAuthRequiredError();
    return token.access_token;
  }

  const client = createLarkClient();
  const response = await client.authen.refreshAccessToken.create({
    data: {
      grant_type: "refresh_token",
      refresh_token: token.refresh_token!
    }
  }, token.access_token ? userTokenOption(token.access_token) : undefined);

  assertLarkOk(response);

  const now = Math.floor(Date.now() / 1000);
  const accessToken = response.data?.access_token;
  if (!accessToken) throw new LarkUserAuthRequiredError();

  const refreshed: StoredUserToken = {
    access_token: accessToken,
    ...(response.data?.refresh_token || token.refresh_token ? { refresh_token: response.data?.refresh_token || token.refresh_token } : {}),
    ...(response.data?.expires_in ? { expires_at: now + response.data.expires_in } : {}),
    ...(response.data?.refresh_expires_in ? { refresh_expires_at: now + response.data.refresh_expires_in } : {})
  };

  await writeStoredToken(refreshed);
  return accessToken;
}

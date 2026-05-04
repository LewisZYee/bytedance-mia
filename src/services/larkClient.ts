import * as lark from "@larksuiteoapi/node-sdk";

export class LarkNotConfiguredError extends Error {
  constructor(missingEnv: string[]) {
    super(`Lark is not configured. Missing env: ${missingEnv.join(", ")}`);
    this.name = "LarkNotConfiguredError";
  }
}

export class LarkApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "LarkApiError";
    if (code !== undefined) this.code = code;
  }
}

export type LarkClient = lark.Client;

export function missingLarkAppEnv() {
  return ["LARK_APP_ID", "LARK_APP_SECRET"].filter(name => !process.env[name]);
}

export function assertLarkAppConfigured() {
  const missing = missingLarkAppEnv();
  if (missing.length > 0) {
    throw new LarkNotConfiguredError(missing);
  }
}

export function larkDomain() {
  return process.env.LARK_DOMAIN?.toLowerCase() === "lark"
    ? lark.Domain.Lark
    : lark.Domain.Feishu;
}

export function createLarkClient() {
  assertLarkAppConfigured();

  return new lark.Client({
    appId: process.env.LARK_APP_ID!,
    appSecret: process.env.LARK_APP_SECRET!,
    domain: larkDomain()
  });
}

export function userTokenOption(userAccessToken: string): any {
  return lark.withUserAccessToken(userAccessToken);
}

export function assertLarkOk(response: { code?: number | undefined; msg?: string | undefined }) {
  if (response.code && response.code !== 0) {
    throw new LarkApiError(response.msg || `Lark API failed with code ${response.code}`, response.code);
  }
}

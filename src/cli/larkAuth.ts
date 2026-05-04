import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { exchangeLarkAuthCode, larkUserTokenFilePath } from "../services/larkAuth.js";

const DEFAULT_SCOPES = [
  "search:message",
  "search:docs:read",
  "minutes:minutes.search:read",
  "minutes:minutes:readonly",
  "minutes:minutes.artifacts:read",
  "minutes:minutes.transcript:export"
].join(" ");

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function oauthBaseUrl() {
  return process.env.LARK_DOMAIN?.toLowerCase() === "lark"
    ? "https://open.larksuite.com"
    : "https://open.feishu.cn";
}

function redirectUri() {
  return process.env.LARK_OAUTH_REDIRECT_URI || "http://localhost:8787/lark/oauth/callback";
}

function oauthScopes() {
  return process.env.LARK_OAUTH_SCOPES || DEFAULT_SCOPES;
}

function buildAuthorizeUrl(state: string) {
  if (!process.env.LARK_APP_ID) throw new Error("Missing LARK_APP_ID");

  const url = new URL(`${oauthBaseUrl()}/open-apis/authen/v1/index`);
  url.searchParams.set("app_id", process.env.LARK_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", oauthScopes());
  return url.toString();
}

async function exchangeCode(code: string) {
  const result = await exchangeLarkAuthCode(code);
  console.log(`Lark user token written to ${result.filePath}`);
}

async function waitForCallback() {
  const callbackUrl = new URL(redirectUri());
  const state = crypto.randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(state);
  const port = Number(callbackUrl.port || 8787);
  const host = callbackUrl.hostname === "localhost" ? "127.0.0.1" : callbackUrl.hostname;

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

        if (requestUrl.pathname !== callbackUrl.pathname) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code");
        const returnedState = requestUrl.searchParams.get("state");

        if (error) throw new Error(`Lark OAuth failed: ${error}`);
        if (!code) throw new Error("Missing OAuth code in callback.");
        if (returnedState && returnedState !== state) throw new Error("OAuth state mismatch.");

        await exchangeCode(code);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Lark user token saved to ${larkUserTokenFilePath()}. You can close this tab.\n`);
        server.close();
        resolve();
      })().catch((error) => {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(`${error instanceof Error ? error.message : String(error)}\n`);
        server.close();
        reject(error);
      });
    });

    server.listen(port, host, () => {
      console.log("Open this URL to authorize Lark user access:");
      console.log(authorizeUrl);
      console.log("");
      console.log(`Waiting for callback on ${redirectUri()}`);
      console.log(`Token file: ${larkUserTokenFilePath()}`);
      console.log("");
      console.log("If the browser cannot reach this server, copy the code=... value from the redirected URL and run:");
      console.log("npm run lark:auth -- --code YOUR_CODE");
    });

    server.on("error", reject);
  });
}

const code = argValue("--code");

if (code) {
  await exchangeCode(code);
} else {
  await waitForCallback();
}

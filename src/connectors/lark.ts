import http from "node:http";
import { answerLewisQuestion } from "../agent.js";
import { requireEnv } from "../runtime/env.js";
import type { Connector } from "./types.js";

type LarkEventBody = {
  type?: string;
  challenge?: string;
  token?: string;
  encrypt?: string;
  header?: {
    event_type?: string;
    token?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
      };
      sender_type?: string;
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
};

type TenantTokenCache = {
  token: string;
  expiresAtMs: number;
};

let tenantTokenCache: TenantTokenCache | undefined;

function larkBaseUrl() {
  return process.env.LARK_BASE_URL || "https://open.larksuite.com/open-apis";
}

function eventPort() {
  return Number(process.env.LARK_EVENT_PORT || 3001);
}

function verifyToken(body: LarkEventBody) {
  const expected = process.env.LARK_VERIFICATION_TOKEN;
  if (!expected) return true;
  return body.token === expected || body.header?.token === expected;
}

function parseTextContent(content?: string) {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? "";
  } catch {
    return "";
  }
}

async function readJsonBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as LarkEventBody;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function getTenantAccessToken() {
  if (tenantTokenCache && tenantTokenCache.expiresAtMs > Date.now() + 60_000) {
    return tenantTokenCache.token;
  }

  const response = await fetch(`${larkBaseUrl()}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: requireEnv("LARK_APP_ID"),
      app_secret: requireEnv("LARK_APP_SECRET")
    })
  });

  const data = await response.json() as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get Lark tenant access token: ${data.msg || response.statusText}`);
  }

  tenantTokenCache = {
    token: data.tenant_access_token,
    expiresAtMs: Date.now() + (data.expire ?? 7200) * 1000
  };

  return tenantTokenCache.token;
}

async function replyToMessage(messageId: string, text: string) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${larkBaseUrl()}/im/v1/messages/${messageId}/reply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({ text })
    })
  });

  const data = await response.json() as { code?: number; msg?: string };
  if (!response.ok || data.code !== 0) {
    throw new Error(`Failed to reply to Lark message: ${data.msg || response.statusText}`);
  }
}

async function handleLarkEvent(body: LarkEventBody) {
  if (body.encrypt) {
    throw new Error("Encrypted Lark events are not supported yet. Disable encryption or implement LARK_ENCRYPT_KEY handling.");
  }

  if (!verifyToken(body)) {
    throw new Error("Invalid Lark verification token.");
  }

  if (body.type === "url_verification" && body.challenge) {
    return { challenge: body.challenge };
  }

  if (body.header?.event_type !== "im.message.receive_v1") {
    return {};
  }

  const message = body.event?.message;
  if (!message?.message_id || !message.chat_id) return {};
  if (message.message_type !== "text") return {};

  const privateOnly = process.env.LARK_PRIVATE_ONLY !== "false";
  if (privateOnly && message.chat_type !== "p2p") return {};

  const text = parseTextContent(message.content);
  if (!text) return {};

  const reply = await answerLewisQuestion({
    text,
    source: "lark",
    conversationId: message.chat_id,
    threadId: message.message_id,
    ...(body.event?.sender?.sender_id?.open_id ? { userId: body.event.sender.sender_id.open_id } : {})
  });

  await replyToMessage(message.message_id, reply.text || "Mia 没有找到足够上下文。");
  return {};
}

export function createLarkConnector(): Connector {
  return {
    name: "lark",
    async start() {
      requireEnv("LARK_APP_ID");
      requireEnv("LARK_APP_SECRET");

      const server = http.createServer((request, response) => {
        void (async () => {
          if (request.method !== "POST" || request.url !== "/lark/events") {
            sendJson(response, 404, { ok: false, error: "not_found" });
            return;
          }

          const body = await readJsonBody(request);
          const result = await handleLarkEvent(body);
          sendJson(response, 200, result);
        })().catch((error) => {
          console.error("[lark] event handling failed", error);
          sendJson(response, 500, { ok: false });
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(eventPort(), "0.0.0.0", resolve);
      });

      console.log(`bytedance-mia Lark connector is listening on /lark/events port ${eventPort()}.`);
    }
  };
}

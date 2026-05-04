import * as lark from "@larksuiteoapi/node-sdk";
import { answerLewisQuestion } from "../agent.js";
import { createLarkClient, larkDomain, assertLarkAppConfigured } from "../services/larkClient.js";
import type { Connector } from "./types.js";

type LarkMessageReceiveEvent = {
  event_id?: string;
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message?: {
    message_id?: string;
    create_time?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
};

const processedMessageIds = new Map<string, number>();
const MESSAGE_DEDUPE_MAX = 5000;
const connectorStartedAt = Date.now();

function privateOnly() {
  return process.env.LARK_PRIVATE_ONLY !== "false";
}

function parseTextContent(content?: string) {
  if (!content) return "";

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text || "";
  } catch {
    return content;
  }
}

function shouldHandleEvent(event: LarkMessageReceiveEvent) {
  const message = event.message;
  if (!message?.message_id || !message.content) return false;
  if (message.message_type !== "text") return false;
  if (privateOnly() && message.chat_type !== "p2p") return false;
  if (event.sender?.sender_type === "app" || event.sender?.sender_type === "bot") return false;
  return true;
}

function eventMaxAgeMs() {
  const raw = Number(process.env.LARK_EVENT_MAX_AGE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

function larkTimestampMs(value?: string) {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
}

function isStaleMessage(event: LarkMessageReceiveEvent) {
  const createdAt = larkTimestampMs(event.message?.create_time);
  if (!createdAt) return false;

  const oldestAllowed = Math.min(Date.now(), connectorStartedAt) - eventMaxAgeMs();
  return createdAt < oldestAllowed;
}

function rememberMessage(messageId: string) {
  const now = Date.now();
  if (processedMessageIds.has(messageId)) {
    return false;
  }

  processedMessageIds.set(messageId, now);

  if (processedMessageIds.size > MESSAGE_DEDUPE_MAX) {
    for (const id of processedMessageIds.keys()) {
      processedMessageIds.delete(id);
      if (processedMessageIds.size <= MESSAGE_DEDUPE_MAX) break;
    }
  }

  return true;
}

async function replyToMessage(messageId: string, text: string) {
  const client = createLarkClient();
  const response = await client.im.v1.message.reply({
    path: {
      message_id: messageId
    },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text }),
      reply_in_thread: false
    }
  });

  if (response.code && response.code !== 0) {
    throw new Error(`Lark reply failed: ${response.code} ${response.msg || ""}`.trim());
  }
}

async function handleMessage(event: LarkMessageReceiveEvent) {
  if (!shouldHandleEvent(event)) return;

  const messageId = event.message!.message_id!;
  if (isStaleMessage(event)) {
    console.info(`[lark] skipped stale message event ${messageId}${event.event_id ? ` event=${event.event_id}` : ""}`);
    return;
  }

  if (!rememberMessage(messageId)) {
    console.info(`[lark] skipped duplicate message event ${messageId}${event.event_id ? ` event=${event.event_id}` : ""}`);
    return;
  }

  const text = parseTextContent(event.message?.content);
  if (!text.trim()) return;

  const reply = await answerLewisQuestion({
    text,
    source: "lark",
    ...(event.message?.chat_id ? { conversationId: event.message.chat_id } : {}),
    ...(event.message?.message_id ? { threadId: event.message.message_id } : {}),
    ...(event.sender?.sender_id?.open_id ? { userId: event.sender.sender_id.open_id } : {})
  });

  await replyToMessage(messageId, reply.text || "没有找到足够上下文。");
}

export function createLarkConnector(): Connector {
  return {
    name: "lark",
    async start() {
      assertLarkAppConfigured();

      const dispatcher = new lark.EventDispatcher({
        ...(process.env.LARK_VERIFICATION_TOKEN ? { verificationToken: process.env.LARK_VERIFICATION_TOKEN } : {}),
        ...(process.env.LARK_ENCRYPT_KEY ? { encryptKey: process.env.LARK_ENCRYPT_KEY } : {})
      }).register({
        "im.message.receive_v1": async (event: LarkMessageReceiveEvent) => {
          try {
            await handleMessage(event);
          } catch (error) {
            console.error("[lark] event handling failed", error);
          }
        }
      });

      const wsClient = new lark.WSClient({
        appId: process.env.LARK_APP_ID!,
        appSecret: process.env.LARK_APP_SECRET!,
        domain: larkDomain(),
        autoReconnect: true,
        onReady: () => console.log("bytedance-mia Lark connector is running in WebSocket mode."),
        onError: error => console.error("[lark] websocket failed", error),
        onReconnecting: () => console.warn("[lark] websocket reconnecting"),
        onReconnected: () => console.log("[lark] websocket reconnected")
      });

      await wsClient.start({ eventDispatcher: dispatcher });
    }
  };
}

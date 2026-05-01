import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { answerLewisQuestion } from "../agent.js";
import type { Connector } from "./types.js";

type LarkReceiveEvent = {
  message_id?: string;
  chat_id?: string;
  chat_type?: string;
  message_type?: string;
  content?: string;
  sender_id?: string;
  sender_type?: string;
};

function larkCliPath() {
  return process.env.LARK_CLI_PATH || "lark-cli";
}

function privateOnly() {
  return process.env.LARK_PRIVATE_ONLY !== "false";
}

function parseEvent(line: string): LarkReceiveEvent | undefined {
  try {
    return JSON.parse(line) as LarkReceiveEvent;
  } catch {
    console.warn("[lark] skipped non-json event line", line);
    return undefined;
  }
}

function shouldHandleEvent(event: LarkReceiveEvent) {
  if (!event.message_id || !event.content) return false;
  if (event.message_type !== "text") return false;
  if (privateOnly() && event.chat_type !== "p2p") return false;
  if (event.sender_type === "app" || event.sender_type === "bot") return false;
  return true;
}

async function replyToMessage(messageId: string, text: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(larkCliPath(), [
      "im",
      "+messages-reply",
      "--message-id",
      messageId,
      "--text",
      text,
      "--as",
      "bot"
    ], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`lark-cli reply failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function handleEvent(event: LarkReceiveEvent) {
  if (!shouldHandleEvent(event)) return;

  const reply = await answerLewisQuestion({
    text: event.content ?? "",
    source: "lark",
    ...(event.chat_id ? { conversationId: event.chat_id } : {}),
    ...(event.message_id ? { threadId: event.message_id } : {}),
    ...(event.sender_id ? { userId: event.sender_id } : {})
  });

  await replyToMessage(event.message_id!, reply.text || "Mia 没有找到足够上下文。");
}

export function createLarkConnector(): Connector {
  return {
    name: "lark",
    async start() {
      const child = spawn(larkCliPath(), [
        "event",
        "consume",
        "im.message.receive_v1",
        "--as",
        "bot"
      ], {
        stdio: ["pipe", "pipe", "pipe"]
      });

      child.on("error", (error) => {
        console.error("[lark] event consumer failed to start", error);
      });

      child.on("close", (code) => {
        console.error(`[lark] event consumer exited with code ${code}`);
      });

      const stdout = createInterface({ input: child.stdout });
      stdout.on("line", (line) => {
        void (async () => {
          const event = parseEvent(line);
          if (event) await handleEvent(event);
        })().catch(error => {
          console.error("[lark] event handling failed", error);
        });
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for lark-cli event consumer readiness."));
        }, 30_000);

        const stderr = createInterface({ input: child.stderr });
        stderr.on("line", (line) => {
          console.info(`[lark] ${line}`);
          if (line.includes("[event] ready")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      console.log("bytedance-mia Lark connector is consuming im.message.receive_v1 via lark-cli.");
    }
  };
}

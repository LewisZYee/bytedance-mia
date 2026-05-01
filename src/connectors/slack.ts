import { App } from "@slack/bolt";
import { answerLewisQuestion } from "../agent.js";
import { requireEnv } from "../runtime/env.js";
import type { Connector } from "./types.js";

export function createSlackConnector(): Connector {
  const app = new App({
    token: requireEnv("SLACK_BOT_TOKEN"),
    appToken: requireEnv("SLACK_APP_TOKEN"),
    signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
    socketMode: true
  });

  app.message(async ({ message, say }) => {
    if (!("text" in message) || !message.text) return;
    if ("subtype" in message && message.subtype) return;
    if (!("channel" in message) || !message.channel) return;
    if (!("ts" in message) || !message.ts) return;

    const botUserId = process.env.SLACK_BOT_USER_ID;
    const mentioned = botUserId ? message.text.includes(`<@${botUserId}>`) : true;
    if (!mentioned) return;

    const cleanedText = botUserId
      ? message.text.replace(`<@${botUserId}>`, "").trim()
      : message.text.trim();

    const reply = await answerLewisQuestion({
      text: cleanedText,
      source: "slack",
      conversationId: message.channel,
      threadId: "thread_ts" in message && message.thread_ts ? message.thread_ts : message.ts,
      ...("user" in message && message.user ? { userId: message.user } : {})
    });

    await say({
      text: reply.text || "Mia 没有找到足够上下文。",
      thread_ts: reply.threadId || ("thread_ts" in message && message.thread_ts ? message.thread_ts : message.ts)
    });
  });

  return {
    name: "slack",
    async start() {
      await app.start();
      console.log("bytedance-mia Slack connector is running in Socket Mode.");
    }
  };
}

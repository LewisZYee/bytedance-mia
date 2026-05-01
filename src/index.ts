import "dotenv/config";
import { App } from "@slack/bolt";
import { answerLewisQuestion } from "./agent";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true
});

app.message(async ({ message, say }) => {
  if (!("text" in message) || !message.text) return;
  if ("subtype" in message && message.subtype) return;
  if (!("channel" in message) || !message.channel) return;
  if (!("ts" in message) || !message.ts) return;

  const text = message.text;
  const botUserId = process.env.SLACK_BOT_USER_ID;

  const mentioned = botUserId ? text.includes(`<@${botUserId}>`) : true;
  if (!mentioned) return;

  const cleanedText = botUserId
    ? text.replace(`<@${botUserId}>`, "").trim()
    : text.trim();

  const reply = await answerLewisQuestion(cleanedText);

  await say({
    text: reply || "Mia 没有找到足够上下文。",
    thread_ts: "thread_ts" in message && message.thread_ts ? message.thread_ts : message.ts
  });
});

async function main() {
  await app.start();
  console.log("bytedance-mia Slack bot is running in Socket Mode.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

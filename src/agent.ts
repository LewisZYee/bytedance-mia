import { generateText } from "./services/llm";
import { fetchChannelHistory, formatSlackMessages } from "./skills/slack";
import { loadCustomers, loadSystemPrompt } from "./config";

function channelNames(text: string) {
  return [...new Set((text.match(/#[a-zA-Z0-9_-]+/g) ?? []).map(x => x.slice(1)))];
}

function customerChannels(text: string) {
  const cfg = loadCustomers();
  const lower = text.toLowerCase();
  const channels: string[] = [];

  for (const [key, customer] of Object.entries(cfg.customers)) {
    const aliases = [key, ...customer.aliases];
    if (aliases.some(a => lower.includes(a.toLowerCase()))) {
      channels.push(...customer.slackChannels);
    }
  }

  return [...new Set(channels)];
}

function oldestIfToday(text: string) {
  const lower = text.toLowerCase();
  if (!lower.includes("今天") && !lower.includes("today")) return undefined;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return String(Math.floor(start.getTime() / 1000));
}

export async function answerLewisQuestion(userText: string) {
  const channels = [...new Set([
    ...channelNames(userText),
    ...customerChannels(userText)
  ])];

  const chunks: string[] = [];

  for (const channel of channels) {
    const messages = await fetchChannelHistory({
      channel,
      limit: 100,
      oldest: oldestIfToday(userText)
    });

    chunks.push([
      `Slack channel: #${channel}`,
      `Message count: ${messages.length}`,
      formatSlackMessages(messages)
    ].join("\n"));
  }

  const context = chunks.join("\n\n---\n\n");

  return generateText({
    system: loadSystemPrompt(),
    user: [
      "Lewis asked:",
      userText,
      "",
      "Retrieved context:",
      context || "(No Slack context retrieved. Ask Lewis for #channel name or configure customer alias mapping.)",
      "",
      "Answer in Chinese unless Lewis asks otherwise."
    ].join("\n"),
    temperature: 0.2
  });
}


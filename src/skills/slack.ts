import { WebClient } from "@slack/web-api";

export const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function resolveChannel(input: string) {
  const cleaned = input.trim();

  if (/^[CGD][A-Z0-9]+$/.test(cleaned)) {
    return { id: cleaned };
  }

  const name = cleaned.replace(/^#/, "").toLowerCase();

  const result = await slackClient.conversations.list({
    types: "public_channel,private_channel",
    limit: 1000
  });

  const channel = result.channels?.find((c) => c.name?.toLowerCase() === name);
  if (!channel?.id) {
    throw new Error(`Cannot resolve Slack channel: ${input}`);
  }

  return { id: channel.id, name: channel.name };
}

export async function fetchChannelHistory(params: {
  channel: string;
  limit?: number;
  oldest?: string;
}) {
  const channel = await resolveChannel(params.channel);

  const result = await slackClient.conversations.history({
    channel: channel.id,
    limit: params.limit ?? 50,
    oldest: params.oldest
  });

  return (result.messages ?? [])
    .filter((m) => m.type === "message" && typeof m.text === "string")
    .map((m) => ({
      channelId: channel.id,
      channelName: channel.name,
      userId: m.user,
      text: m.text || "",
      ts: m.ts || "",
      threadTs: m.thread_ts
    }));
}

export function formatSlackMessages(messages: any[]) {
  return messages
    .map((m) => {
      const who = m.userId || "unknown";
      const thread = m.threadTs && m.threadTs !== m.ts ? ` thread=${m.threadTs}` : "";
      return `[${m.ts}] ${who}${thread}: ${m.text}`;
    })
    .join("\n");
}

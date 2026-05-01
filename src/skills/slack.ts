import { ErrorCode, WebClient } from "@slack/web-api";
import type { WebAPICallError } from "@slack/web-api";

export const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export type SlackContextMessage = {
  channelId: string;
  channelName?: string;
  userId?: string;
  text: string;
  ts: string;
  threadTs?: string;
  isThreadReply: boolean;
  replyCount: number;
};

export type SlackChannelRef = {
  id: string;
  name?: string;
  isMember?: boolean;
  isPrivate?: boolean;
};

type SlackRawMessage = {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
};

export class SlackContextError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, string | number | boolean | undefined>
  ) {
    super(message);
    this.name = "SlackContextError";
  }
}

function slackApiErrorCode(error: unknown) {
  const maybe = error as Partial<WebAPICallError>;
  if (maybe.code === ErrorCode.PlatformError && "data" in maybe) {
    return maybe.data?.error;
  }
  return undefined;
}

function explainSlackApiError(action: string, error: unknown, details?: Record<string, string | number | boolean | undefined>) {
  const code = slackApiErrorCode(error);

  if (code === "not_in_channel") {
    throw new SlackContextError(
      `${action} failed: bot is not in the channel.`,
      code,
      details
    );
  }

  if (code === "missing_scope") {
    throw new SlackContextError(
      `${action} failed: Slack app is missing a required OAuth scope.`,
      code,
      details
    );
  }

  if (code === "channel_not_found") {
    throw new SlackContextError(
      `${action} failed: Slack channel was not found or is not visible to the bot.`,
      code,
      details
    );
  }

  if (code) {
    throw new SlackContextError(`${action} failed: Slack API returned ${code}.`, code, details);
  }

  throw error;
}

function normalizeMessage(
  message: SlackRawMessage,
  channel: SlackChannelRef,
  fallbackThreadTs?: string
): SlackContextMessage | undefined {
  if (message.type !== "message") return undefined;
  if (typeof message.text !== "string") return undefined;
  if (!message.ts) return undefined;

  const threadTs = message.thread_ts || fallbackThreadTs;
  const isThreadReply = Boolean(threadTs && threadTs !== message.ts);

  return {
    channelId: channel.id,
    text: message.text,
    ts: message.ts,
    ...(channel.name ? { channelName: channel.name } : {}),
    ...(message.user || message.bot_id || message.username ? { userId: message.user || message.bot_id || message.username } : {}),
    ...(threadTs ? { threadTs } : {}),
    isThreadReply,
    replyCount: message.reply_count ?? 0
  };
}

export async function resolveChannel(input: string) {
  const cleaned = input.trim();

  if (/^[CGD][A-Z0-9]+$/.test(cleaned)) {
    return { id: cleaned };
  }

  const name = cleaned.replace(/^#/, "").toLowerCase();
  let cursor: string | undefined;

  try {
    do {
      const result = await slackClient.conversations.list({
        types: "public_channel,private_channel",
        limit: 1000,
        ...(cursor ? { cursor } : {})
      });

      const channel = result.channels?.find((c) => c.name?.toLowerCase() === name);
      if (channel?.id) {
        return {
          id: channel.id,
          ...(channel.name ? { name: channel.name } : {}),
          ...(typeof channel.is_member === "boolean" ? { isMember: channel.is_member } : {}),
          ...(typeof channel.is_private === "boolean" ? { isPrivate: channel.is_private } : {})
        };
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (error) {
    explainSlackApiError("Resolve Slack channel", error, { channel: input });
  }

  throw new SlackContextError(
    `Cannot resolve Slack channel: ${input}. Make sure the bot can see the channel and has channels:read/groups:read as needed.`,
    "cannot_resolve_channel",
    { channel: input }
  );
}

export async function fetchChannelHistory(params: {
  channel: string;
  limit?: number;
  oldest?: string;
  includeThreads?: boolean;
}): Promise<SlackContextMessage[]> {
  const channel = await resolveChannel(params.channel);
  const limit = params.limit ?? 50;
  const messages: SlackContextMessage[] = [];
  let cursor: string | undefined;

  try {
    do {
      const result = await slackClient.conversations.history({
        channel: channel.id,
        limit: Math.min(200, Math.max(1, limit - messages.length)),
        ...(params.oldest ? { oldest: params.oldest } : {}),
        ...(cursor ? { cursor } : {})
      });

      for (const rawMessage of result.messages ?? []) {
        const message = normalizeMessage(rawMessage as SlackRawMessage, channel);
        if (!message) continue;

        messages.push(message);

        if (params.includeThreads !== false && message.replyCount > 0) {
          const replies = await fetchThreadReplies(channel, message.ts);
          messages.push(...replies);
        }

        if (messages.length >= limit) break;
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor && messages.length < limit);
  } catch (error) {
    explainSlackApiError("Fetch Slack channel history", error, {
      channel: params.channel,
      channelId: channel.id,
      oldest: params.oldest
    });
  }

  return messages.slice(0, limit);
}

export async function fetchThreadReplies(
  channel: SlackChannelRef,
  threadTs: string,
  limit = 50
): Promise<SlackContextMessage[]> {
  const replies: SlackContextMessage[] = [];
  let cursor: string | undefined;

  try {
    do {
      const result = await slackClient.conversations.replies({
        channel: channel.id,
        ts: threadTs,
        limit: Math.min(200, Math.max(1, limit - replies.length)),
        ...(cursor ? { cursor } : {})
      });

      for (const rawMessage of result.messages ?? []) {
        const message = normalizeMessage(rawMessage as SlackRawMessage, channel, threadTs);
        if (!message || message.ts === threadTs) continue;
        replies.push(message);
        if (replies.length >= limit) break;
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor && replies.length < limit);
  } catch (error) {
    explainSlackApiError("Fetch Slack thread replies", error, {
      channelId: channel.id,
      threadTs
    });
  }

  return replies;
}

export function formatSlackMessages(messages: SlackContextMessage[]) {
  return messages
    .map((m) => {
      const who = m.userId || "unknown";
      const thread = m.isThreadReply && m.threadTs ? ` thread=${m.threadTs}` : "";
      return `[${m.ts}] ${who}${thread}: ${m.text}`;
    })
    .join("\n");
}

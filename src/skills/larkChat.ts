import { parseLarkText, safeIsoTime, userRequest, type LarkListResponse } from "./larkHelpers.js";
import type { LarkContextItem, LarkSearchParams } from "./larkTypes.js";

type LarkMessageSearchHit = {
  message_id?: string;
};

type LarkMessage = {
  message_id?: string;
  msg_type?: string;
  create_time?: string;
  update_time?: string;
  chat_id?: string;
  chat_name?: string;
  chat_type?: string;
  thread_id?: string;
  sender?: {
    id?: string;
    id_type?: string;
    sender_type?: string;
    name?: string;
  };
  body?: {
    content?: string;
  };
  content?: string;
};

function normalizeMessages(response: LarkListResponse<LarkMessage>) {
  return response.data?.messages || response.data?.items || response.data?.results || [];
}

async function fetchMessages(messageIds: string[]) {
  if (messageIds.length === 0) return [];

  const response = await userRequest<LarkListResponse<LarkMessage>>({
    method: "GET",
    path: "/open-apis/im/v1/messages/mget",
    params: {
      message_ids: messageIds.slice(0, 50).join(",")
    }
  });

  return normalizeMessages(response);
}

export async function searchLarkChatHistory(params: LarkSearchParams): Promise<LarkContextItem[]> {
  const limit = Math.min(params.limit || 20, 50);
  const response = await userRequest<LarkListResponse<LarkMessageSearchHit | LarkMessage>>({
    method: "POST",
    path: "/open-apis/im/v1/messages/search",
    data: {
      query: params.query,
      page_size: limit,
      ...(params.oldest ? { start_time: params.oldest } : {})
    }
  });

  const rawItems = response.data?.items || response.data?.results || [];
  const directMessages = rawItems.filter((item): item is LarkMessage => Boolean((item as LarkMessage).body || (item as LarkMessage).content));
  const messageIds = rawItems
    .map(item => item.message_id)
    .filter((id): id is string => Boolean(id));
  const messages = directMessages.length > 0 ? directMessages : await fetchMessages(messageIds);

  return messages.slice(0, limit).map((message) => {
    const sender = message.sender?.name || message.sender?.id || "unknown";
    const title = message.chat_name || message.chat_id || "Lark chat";
    const text = parseLarkText(message.body?.content || message.content);
    const thread = message.thread_id ? ` thread=${message.thread_id}` : "";
    const updatedAt = safeIsoTime(message.create_time);

    return {
      kind: "chat",
      title,
      ...(updatedAt ? { updatedAt } : {}),
      text: `[${sender}]${thread} ${text}`
    };
  });
}

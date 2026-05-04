import { safeIsoTime, userRequest, type LarkListResponse } from "./larkHelpers.js";
import type { LarkContextItem, LarkSearchParams } from "./larkTypes.js";

type LarkMinuteSearchResult = {
  token?: string;
  minute_token?: string;
  title?: string;
  url?: string;
  owner_id?: string;
  create_time?: string | number;
  duration?: string;
};

export async function searchLarkMinutes(params: LarkSearchParams): Promise<LarkContextItem[]> {
  const limit = Math.min(params.limit || 10, 30);
  const response = await userRequest<LarkListResponse<LarkMinuteSearchResult>>({
    method: "POST",
    path: "/open-apis/minutes/v1/minutes/search",
    data: {
      query: params.query,
      page_size: limit,
      ...(params.oldest ? { start_time: params.oldest } : {})
    }
  });

  const items = response.data?.items || response.data?.results || [];

  return items.slice(0, limit).map((minute) => {
    const token = minute.token || minute.minute_token;
    const updatedAt = safeIsoTime(minute.create_time);
    const details = [
      token ? `token=${token}` : "",
      minute.owner_id ? `owner=${minute.owner_id}` : "",
      minute.duration ? `duration=${minute.duration}` : ""
    ].filter(Boolean).join(" ");

    return {
      kind: "minutes",
      title: minute.title || "Lark minutes",
      ...(minute.url ? { sourceUrl: minute.url } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      text: details || "(Matched minute metadata.)"
    };
  });
}

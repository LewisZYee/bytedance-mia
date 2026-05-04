import { createLarkClient, userTokenOption, assertLarkOk } from "../services/larkClient.js";
import { getLarkUserAccessToken } from "../services/larkAuth.js";

export type LarkListResponse<T> = {
  code?: number;
  msg?: string;
  data?: {
    items?: T[];
    results?: T[];
    messages?: T[];
    has_more?: boolean;
    page_token?: string;
    total?: number;
  };
};

export async function userRequest<T>(payload: {
  method: string;
  path: string;
  data?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}) {
  const client = createLarkClient();
  const token = await getLarkUserAccessToken();
  const response = await client.request<T>({
    method: payload.method,
    url: `${client.domain}${payload.path}`,
    ...(payload.data ? { data: payload.data } : {}),
    ...(payload.params ? { params: payload.params } : {})
  }, userTokenOption(token));

  assertLarkOk(response as { code?: number; msg?: string });
  return response;
}

export function stripHighlight(text?: string) {
  return (text || "").replace(/<\/?h[b]?>/g, "");
}

export function parseLarkText(content?: string) {
  if (!content) return "";

  try {
    const parsed = JSON.parse(content) as { text?: string; title?: string; content?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
    if (typeof parsed.title === "string") return parsed.title;
  } catch {
    // Some APIs already return plain text.
  }

  return content;
}

export function safeIsoTime(value?: string | number) {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(millis).toISOString();
}

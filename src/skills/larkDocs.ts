import { safeIsoTime, stripHighlight, userRequest, type LarkListResponse } from "./larkHelpers.js";
import type { LarkContextItem, LarkSearchParams } from "./larkTypes.js";

type LarkDocSearchResult = {
  title?: string;
  title_highlighted?: string;
  summary?: string;
  summary_highlighted?: string;
  url?: string;
  token?: string;
  obj_token?: string;
  edit_time?: string | number;
  open_time?: string | number;
  create_time?: string | number;
  result_meta?: {
    doc_type?: string;
    doc_types?: string;
  };
};

export async function searchLarkDocs(params: LarkSearchParams): Promise<LarkContextItem[]> {
  const limit = Math.min(params.limit || 10, 20);
  const response = await userRequest<LarkListResponse<LarkDocSearchResult>>({
    method: "POST",
    path: "/open-apis/search/v2/doc_wiki/search",
    data: {
      query: params.query,
      page_size: limit
    }
  });

  const results = response.data?.results || response.data?.items || [];

  return results.slice(0, limit).map((result) => {
    const title = stripHighlight(result.title_highlighted || result.title) || "Lark doc";
    const summary = stripHighlight(result.summary_highlighted || result.summary);
    const docType = result.result_meta?.doc_type || result.result_meta?.doc_types;
    const token = result.token || result.obj_token;
    const label = [docType, token].filter(Boolean).join(" ");
    const updatedAt = safeIsoTime(result.edit_time || result.open_time || result.create_time);

    return {
      kind: "doc",
      title,
      ...(result.url ? { sourceUrl: result.url } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      text: [label, summary].filter(Boolean).join("\n")
    };
  });
}

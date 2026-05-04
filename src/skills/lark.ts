export { LarkNotConfiguredError as LarkSkillNotConfiguredError, LarkApiError } from "../services/larkClient.js";
export { LarkUserAuthRequiredError } from "../services/larkAuth.js";
export { searchLarkChatHistory } from "./larkChat.js";
export { searchLarkDocs } from "./larkDocs.js";
export { searchLarkMinutes } from "./larkMinutes.js";
export type { LarkContextItem, LarkContextKind, LarkSearchParams } from "./larkTypes.js";

import type { LarkContextItem } from "./larkTypes.js";

export function formatLarkContext(items: LarkContextItem[]) {
  return items
    .map((item) => {
      const source = item.sourceUrl ? ` source=${item.sourceUrl}` : "";
      const updated = item.updatedAt ? ` updated=${item.updatedAt}` : "";
      return `[Lark ${item.kind}] ${item.title}${source}${updated}\n${item.text}`;
    })
    .join("\n\n");
}

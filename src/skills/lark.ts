export type LarkContextKind = "doc" | "minutes" | "task";

export type LarkContextItem = {
  kind: LarkContextKind;
  title: string;
  sourceUrl?: string;
  updatedAt?: string;
  text: string;
};

export type LarkSearchParams = {
  query: string;
  customerAliases?: string[];
  limit?: number;
};

export class LarkSkillNotConfiguredError extends Error {
  constructor(missingEnv: string[]) {
    super(`Lark skill is not configured. Missing env: ${missingEnv.join(", ")}`);
    this.name = "LarkSkillNotConfiguredError";
  }
}

function missingLarkEnv() {
  return ["LARK_APP_ID", "LARK_APP_SECRET"].filter(name => !process.env[name]);
}

export function assertLarkConfigured() {
  const missing = missingLarkEnv();
  if (missing.length > 0) {
    throw new LarkSkillNotConfiguredError(missing);
  }
}

export async function searchLarkDocs(_params: LarkSearchParams): Promise<LarkContextItem[]> {
  assertLarkConfigured();

  // Lark document search will be wired here after we choose the exact API surface
  // and scopes for Lewis' workspace.
  return [];
}

export async function searchLarkChatHistory(_params: LarkSearchParams): Promise<LarkContextItem[]> {
  assertLarkConfigured();

  // Lark IM history retrieval is the primary Lark skill for Mia. Wire this to
  // chat message search/history after app scopes and chat access are confirmed.
  return [];
}

export async function searchLarkMinutes(_params: LarkSearchParams): Promise<LarkContextItem[]> {
  assertLarkConfigured();

  // Lark Minutes retrieval will be wired here after OAuth scopes and minute access
  // are confirmed in the workspace.
  return [];
}

export function formatLarkContext(items: LarkContextItem[]) {
  return items
    .map((item) => {
      const source = item.sourceUrl ? ` source=${item.sourceUrl}` : "";
      const updated = item.updatedAt ? ` updated=${item.updatedAt}` : "";
      return `[${item.kind}] ${item.title}${source}${updated}\n${item.text}`;
    })
    .join("\n\n");
}

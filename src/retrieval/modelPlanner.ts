import { loadPlannerPrompt } from "../config.js";
import { generateText } from "../services/llm.js";

export type ModelRetrievalPlan = {
  useSlack: boolean;
  useLarkChat: boolean;
  useLarkMinutes: boolean;
  useLarkDocs: boolean;
  searchQuery: string;
  timeScope: "today" | "recent" | "unspecified";
  reason: string;
};

const DEFAULT_MODEL_PLAN: ModelRetrievalPlan = {
  useSlack: false,
  useLarkChat: false,
  useLarkMinutes: false,
  useLarkDocs: false,
  searchQuery: "",
  timeScope: "unspecified",
  reason: "Planner unavailable; using deterministic fallback."
};

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asBoolean(value: unknown) {
  return value === true;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asTimeScope(value: unknown): ModelRetrievalPlan["timeScope"] {
  return value === "today" || value === "recent" || value === "unspecified" ? value : "unspecified";
}

export async function makeModelRetrievalPlan(userText: string): Promise<ModelRetrievalPlan> {
  try {
    const raw = await generateText({
      system: loadPlannerPrompt(),
      user: [
        "User question:",
        userText,
        "",
        "Return JSON only."
      ].join("\n"),
      temperature: 0
    });

    const parsed = parseJsonObject(raw);
    if (!parsed) return DEFAULT_MODEL_PLAN;

    return {
      useSlack: asBoolean(parsed.useSlack),
      useLarkChat: asBoolean(parsed.useLarkChat),
      useLarkMinutes: asBoolean(parsed.useLarkMinutes),
      useLarkDocs: asBoolean(parsed.useLarkDocs),
      searchQuery: asString(parsed.searchQuery).trim() || userText,
      timeScope: asTimeScope(parsed.timeScope),
      reason: asString(parsed.reason).trim() || "Model planner selected retrieval sources."
    };
  } catch (error) {
    console.warn("[mia] model planner failed", error);
    return DEFAULT_MODEL_PLAN;
  }
}

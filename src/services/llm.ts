import OpenAI from "openai";

const baseURL = process.env.LLM_BASE_URL;
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL || "seed-2.0";

if (!baseURL) throw new Error("Missing LLM_BASE_URL");
if (!apiKey) throw new Error("Missing LLM_API_KEY");

export const llm = new OpenAI({
  baseURL,
  apiKey
});

export async function generateText(params: {
  system: string;
  user: string;
  temperature?: number;
}) {
  const response = await llm.chat.completions.create({
    model,
    temperature: params.temperature ?? 0.2,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

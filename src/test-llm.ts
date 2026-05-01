import "dotenv/config";
import { generateText } from "./services/llm";

async function main() {
  const text = await generateText({
    system: "You are a concise assistant.",
    user: "用一句中文回复：LLM 已连接。"
  });

  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

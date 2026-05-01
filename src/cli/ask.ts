import "dotenv/config";
import { answerLewisQuestionWithDebug } from "../agent.js";

function parseArgs(args: string[]) {
  const debug = args.includes("--debug");
  const question = args.filter(arg => arg !== "--debug").join(" ").trim();
  return { debug, question };
}

async function main() {
  const { debug, question } = parseArgs(process.argv.slice(2));

  if (!question) {
    console.error('Usage: npm run ask -- "某客户之前有没有提到过 Seedance bad case?"');
    console.error('       npm run ask:debug -- "某客户 CEO 今天说了什么?"');
    process.exit(1);
  }

  const result = await answerLewisQuestionWithDebug({
    text: question,
    source: "cli"
  });

  if (debug) {
    console.log("\n--- Retrieval plan ---");
    console.log(JSON.stringify(result.debug.plan, null, 2));
    console.log("\n--- Retrieval notes ---");
    console.log(result.debug.retrievalNotes.join("\n") || "(none)");
  }

  console.log("\n--- Mia ---");
  console.log(result.answer);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

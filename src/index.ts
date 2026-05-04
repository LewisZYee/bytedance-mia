import "dotenv/config";
import { createSlackConnector } from "./connectors/slack.js";
import { createTelegramConnector } from "./connectors/telegram.js";
import type { ConnectorName, Connector } from "./connectors/types.js";
import { createWhatsAppConnector } from "./connectors/whatsapp.js";

function enabledConnectorNames(): ConnectorName[] {
  const raw = process.env.MIA_CONNECTORS || "slack";
  return raw
    .split(",")
    .map(name => name.trim())
    .filter((name): name is ConnectorName => ["slack", "lark", "whatsapp", "telegram"].includes(name));
}

async function createConnector(name: ConnectorName): Promise<Connector> {
  switch (name) {
    case "slack":
      return createSlackConnector();
    case "lark":
      return (await import("./connectors/lark.js")).createLarkConnector();
    case "whatsapp":
      return createWhatsAppConnector();
    case "telegram":
      return createTelegramConnector();
  }
}

async function main() {
  const connectors = await Promise.all(enabledConnectorNames().map(createConnector));
  await Promise.all(connectors.map(connector => connector.start()));
  console.log(`bytedance-mia started connectors: ${connectors.map(connector => connector.name).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

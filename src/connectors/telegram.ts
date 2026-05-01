import type { Connector } from "./types.js";

export function createTelegramConnector(): Connector {
  return {
    name: "telegram",
    async start() {
      throw new Error("Telegram connector is scaffolded but not implemented yet.");
    }
  };
}

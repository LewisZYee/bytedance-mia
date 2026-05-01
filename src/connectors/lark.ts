import type { Connector } from "./types.js";

export function createLarkConnector(): Connector {
  return {
    name: "lark",
    async start() {
      throw new Error("Lark connector is scaffolded but not implemented yet. Next step: wire Lark IM receive/reply APIs.");
    }
  };
}

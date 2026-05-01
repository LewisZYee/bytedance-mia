import type { Connector } from "./types.js";

export function createWhatsAppConnector(): Connector {
  return {
    name: "whatsapp",
    async start() {
      throw new Error("WhatsApp connector is scaffolded but not implemented yet.");
    }
  };
}

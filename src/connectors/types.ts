export type ConnectorName = "slack" | "lark" | "whatsapp" | "telegram";

export type AgentRequest = {
  text: string;
  source: ConnectorName | "cli";
  conversationId?: string;
  threadId?: string;
  userId?: string;
};

export type AgentReply = {
  text: string;
  threadId?: string;
};

export type Connector = {
  name: ConnectorName;
  start(): Promise<void>;
};

export type LarkContextKind = "chat" | "doc" | "minutes";

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
  oldest?: string;
};

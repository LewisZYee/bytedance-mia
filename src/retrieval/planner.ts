import type { CustomerConfig } from "../config.js";
import type { SlackContextMessage } from "../skills/slack.js";

export type Intent =
  | "today_summary"
  | "todo_or_open_questions"
  | "keyword_search"
  | "person_said"
  | "general_context";

export type RetrievalPlan = {
  intent: Intent;
  channels: string[];
  oldest?: string;
  limit: number;
  keywords: string[];
  personAliases: string[];
  personSlackUserIds: string[];
  needsPersonMapping: boolean;
  needsLarkContext: boolean;
  larkTools: {
    chat: boolean;
    minutes: boolean;
    docs: boolean;
  };
  guidance: string;
};

type MatchedCustomer = {
  key: string;
  aliases: string[];
  slackChannels: string[];
  people?: NonNullable<CustomerConfig["customers"][string]["people"]>;
};

function channelNames(text: string) {
  return [...new Set((text.match(/#[a-zA-Z0-9_-]+/g) ?? []).map(x => x.slice(1)))];
}

function matchedCustomers(text: string, config: CustomerConfig): MatchedCustomer[] {
  const lower = text.toLowerCase();
  const matches: MatchedCustomer[] = [];

  for (const [key, customer] of Object.entries(config.customers)) {
    const aliases = [key, ...customer.aliases];
    if (aliases.some(a => lower.includes(a.toLowerCase()))) {
      matches.push({
        key,
        aliases,
        slackChannels: customer.slackChannels,
        ...(customer.people ? { people: customer.people } : {})
      });
    }
  }

  return matches;
}

function oldestIfToday(text: string) {
  const lower = text.toLowerCase();
  if (!lower.includes("今天") && !lower.includes("today")) return undefined;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return String(Math.floor(start.getTime() / 1000));
}

function detectIntent(text: string): Intent {
  if (/(ceo|cto|cfo|founder|创始人|老板|负责人|决策人).*(说|讲|提|问|said|ask)|((说|讲|提|问|said|ask).*(ceo|cto|cfo|founder|创始人|老板|负责人|决策人))/i.test(text)) {
    return "person_said";
  }

  if (/(todo|to-do|待办|action item|follow[- ]?up|未回复|没回|还没回|open question|unanswered|问题还没)/i.test(text)) {
    return "todo_or_open_questions";
  }

  if (/(bad case|seedance|有没有提到|之前.*提|历史|issue|problem|bug|失败|报错|效果不好|case)/i.test(text)) {
    return "keyword_search";
  }

  if (/(今天|today).*(说了什么|发生|总结|summary|recap|what happened)/i.test(text)) {
    return "today_summary";
  }

  return "general_context";
}

function extractKeywords(text: string, intent: Intent) {
  const keywords = new Set<string>();
  const lower = text.toLowerCase();
  const quoted = [...text.matchAll(/["“”']([^"“”']{2,})["“”']/g)]
    .map(match => match[1])
    .filter((keyword): keyword is string => Boolean(keyword));
  const productLike = text.match(/\b[A-Za-z][A-Za-z0-9_-]{2,}\b/g) ?? [];

  for (const keyword of [...quoted, ...productLike]) {
    const normalized = keyword.trim();
    const stopwords = ["today", "what", "did", "the", "and", "for", "with", "ceo", "cto", "cfo"];
    if (!stopwords.includes(normalized.toLowerCase())) {
      keywords.add(normalized);
    }
  }

  if (intent === "keyword_search") {
    if (lower.includes("seedance")) keywords.add("Seedance");
    if (lower.includes("bad case")) {
      for (const keyword of ["bad case", "issue", "problem", "failed", "failure", "bug", "artifact", "效果不好", "失败", "报错", "问题"]) {
        keywords.add(keyword);
      }
    }
  }

  if (intent === "todo_or_open_questions") {
    for (const keyword of ["?", "？", "todo", "待办", "follow up", "action", "帮忙", "确认", "看看", "问题", "未回复", "没回"]) {
      keywords.add(keyword);
    }
  }

  return [...keywords];
}

function resolvePeople(text: string, customers: MatchedCustomer[]) {
  const lower = text.toLowerCase();
  const roleTerms = ["ceo", "cto", "cfo", "founder", "创始人", "老板", "负责人", "决策人"];
  const requestedRoles = roleTerms.filter(role => lower.includes(role));
  const aliases = new Set<string>();
  const slackUserIds = new Set<string>();

  for (const customer of customers) {
    for (const person of Object.values(customer.people ?? {})) {
      const personAliases = person.aliases ?? [];
      const personRoles = person.roles ?? [];
      const matchedByAlias = personAliases.some(alias => lower.includes(alias.toLowerCase()));
      const matchedByRole = requestedRoles.some(role => personRoles.some(personRole => personRole.toLowerCase() === role));

      if (!matchedByAlias && !matchedByRole) continue;

      for (const alias of personAliases) aliases.add(alias);
      for (const userId of person.slackUserIds ?? []) slackUserIds.add(userId);
    }
  }

  return {
    aliases: [...aliases],
    slackUserIds: [...slackUserIds],
    needsPersonMapping: requestedRoles.length > 0 && aliases.size === 0 && slackUserIds.size === 0
  };
}

function retrievalGuidance(intent: Intent) {
  switch (intent) {
    case "today_summary":
      return "Summarize only the retrieved today context, grouped by facts, asks, risks, and next steps.";
    case "todo_or_open_questions":
      return "Extract possible Lewis todos and unanswered customer questions. Do not include resolved chatter unless it supports the todo.";
    case "keyword_search":
      return "Answer whether the requested topic appears in retrieved context. Cite matching messages and say clearly if no direct match was retrieved.";
    case "person_said":
      return "Answer what the requested person or role said. If role-to-person mapping is missing, say that explicitly and avoid pretending to know who the role is.";
    case "general_context":
      return "Answer the user question directly from retrieved context. Do not default to a broad channel summary.";
  }
}

function includesAny(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.some(keyword => lower.includes(keyword.toLowerCase()));
}

function shouldSearchLark(text: string) {
  return /(lark|飞书|文档|doc|docs|会议|纪要|妙记|minutes|meeting|transcript|聊天记录|群聊|私聊)/i.test(text);
}

function larkToolHints(text: string) {
  const lower = text.toLowerCase();

  return {
    chat: /(lark|飞书|聊天记录|群聊|私聊|消息|message|chat)/i.test(text),
    minutes: /(会议|纪要|妙记|minutes|meeting|transcript|录音|总结|待办)/i.test(text),
    docs: /(文档|doc|docs|wiki|知识库|prd|spec|report|报告|方案|资料)/i.test(lower)
  };
}

export function makeRetrievalPlan(userText: string, config: CustomerConfig): RetrievalPlan {
  const intent = detectIntent(userText);
  const customers = matchedCustomers(userText, config);
  const channels = [...new Set([
    ...channelNames(userText),
    ...customers.flatMap(customer => customer.slackChannels)
  ])];
  const people = resolvePeople(userText, customers);
  const todayOldest = oldestIfToday(userText);
  const larkTools = larkToolHints(userText);

  return {
    intent,
    channels,
    ...(todayOldest ? { oldest: todayOldest } : {}),
    limit: intent === "keyword_search" ? 250 : 120,
    keywords: extractKeywords(userText, intent),
    personAliases: people.aliases,
    personSlackUserIds: people.slackUserIds,
    needsPersonMapping: intent === "person_said" && people.needsPersonMapping,
    needsLarkContext: shouldSearchLark(userText),
    larkTools,
    guidance: retrievalGuidance(intent)
  };
}

export function filterFocusedMessages(messages: SlackContextMessage[], plan: RetrievalPlan) {
  if (plan.intent === "today_summary" || plan.intent === "general_context") return messages;

  const matched = messages.filter((message) => {
    if (plan.intent === "person_said") {
      const byUserId = plan.personSlackUserIds.length > 0 && message.userId ? plan.personSlackUserIds.includes(message.userId) : false;
      const byAlias = plan.personAliases.length > 0 && includesAny(message.text, plan.personAliases);
      const byRoleKeyword = plan.needsPersonMapping && includesAny(message.text, ["CEO", "CTO", "CFO", "founder", "创始人", "老板", "负责人", "决策人"]);
      return byUserId || byAlias || byRoleKeyword;
    }

    return includesAny(message.text, plan.keywords);
  });

  const matchedThreadIds = new Set(matched.map(message => message.threadTs || message.ts));
  const sameThreadContext = messages.filter(message => {
    const threadId = message.threadTs || message.ts;
    return matchedThreadIds.has(threadId);
  });

  return sameThreadContext.length > 0 ? sameThreadContext : matched;
}

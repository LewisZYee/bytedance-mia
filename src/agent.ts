import { generateText } from "./services/llm.js";
import { makeRetrievalPlan, filterFocusedMessages, type RetrievalPlan } from "./retrieval/planner.js";
import { makeModelRetrievalPlan, type ModelRetrievalPlan } from "./retrieval/modelPlanner.js";
import { fetchChannelHistory, formatSlackMessages, hasSlackUserToken, searchSlackMessages, SlackContextError } from "./skills/slack.js";
import { loadCustomers, loadSystemPrompt } from "./config.js";
import type { AgentReply, AgentRequest } from "./connectors/types.js";

export type AgentDebugInfo = {
  plan: RetrievalPlan;
  modelPlan: ModelRetrievalPlan;
  retrievalNotes: string[];
};

function isExpectedLarkError(error: unknown) {
  return error instanceof Error && [
    "LarkNotConfiguredError",
    "LarkSkillNotConfiguredError",
    "LarkUserAuthRequiredError"
  ].includes(error.name);
}

function explicitSlackNeed(text: string, plan: RetrievalPlan, modelPlan: ModelRetrievalPlan) {
  if (modelPlan.useSlack) return true;
  if (plan.channels.length > 0) return true;
  if (plan.intent === "keyword_search" || plan.intent === "todo_or_open_questions" || plan.intent === "person_said") return true;
  return /(slack|channel|客户|customer|seedance|bad case|case|未回复|没回|todo|待办|ceo|cto|founder)/i.test(text);
}

function slackSearchQuery(userText: string, plan: RetrievalPlan, modelPlan: ModelRetrievalPlan) {
  const query = [
    ...plan.keywords,
    ...plan.personAliases,
    modelPlan.searchQuery && modelPlan.searchQuery !== userText ? modelPlan.searchQuery : ""
  ].filter(Boolean).join(" ").trim();

  return query || userText;
}

export async function answerLewisQuestionWithDebug(request: string | AgentRequest) {
  const agentRequest = typeof request === "string" ? { text: request, source: "cli" as const } : request;
  const userText = agentRequest.text;
  const plan = makeRetrievalPlan(userText, loadCustomers());
  const modelPlan = await makeModelRetrievalPlan(userText);
  const larkTools = {
    chat: plan.larkTools.chat || modelPlan.useLarkChat,
    minutes: plan.larkTools.minutes || modelPlan.useLarkMinutes,
    docs: plan.larkTools.docs || modelPlan.useLarkDocs
  };
  const needsLarkContext = plan.needsLarkContext || larkTools.chat || larkTools.minutes || larkTools.docs;
  const larkSearchQuery = modelPlan.searchQuery || userText;
  const shouldSearchSlackWorkspace = hasSlackUserToken() && plan.channels.length === 0 && explicitSlackNeed(userText, plan, modelPlan);

  const chunks: string[] = [];
  const retrievalNotes: string[] = [`Model planner: ${modelPlan.reason}`];

  for (const channel of plan.channels) {
    try {
      const messages = await fetchChannelHistory({
        channel,
        limit: plan.limit,
        includeThreads: true,
        ...(plan.oldest ? { oldest: plan.oldest } : {})
      });
      const focusedMessages = filterFocusedMessages(messages, plan);

      const threadReplyCount = messages.filter((m) => m.isThreadReply).length;
      retrievalNotes.push(`#${channel}: ${messages.length} messages, ${threadReplyCount} thread replies, ${focusedMessages.length} focused matches`);

      chunks.push([
        `Slack channel: #${channel}`,
        `Message count: ${messages.length}`,
        `Thread reply count: ${threadReplyCount}`,
        `Focused match count: ${focusedMessages.length}`,
        focusedMessages.length > 0 ? formatSlackMessages(focusedMessages) : "(No focused messages matched the retrieval plan.)"
      ].join("\n"));
    } catch (error) {
      if (error instanceof SlackContextError) {
        retrievalNotes.push(`#${channel}: retrieval failed (${error.code})`);
        chunks.push([
          `Slack channel: #${channel}`,
          `Retrieval error: ${error.message}`
        ].join("\n"));
        continue;
      }

      throw error;
    }
  }

  if (shouldSearchSlackWorkspace) {
    const query = slackSearchQuery(userText, plan, modelPlan);

    try {
      const messages = await searchSlackMessages({
        query,
        limit: Math.min(50, plan.limit)
      });
      const focusedMessages = filterFocusedMessages(messages, plan);

      retrievalNotes.push(`Slack search: ${messages.length} matches, ${focusedMessages.length} focused matches, query="${query}"`);
      chunks.push([
        "Slack workspace search:",
        `Query: ${query}`,
        `Match count: ${messages.length}`,
        focusedMessages.length > 0 ? formatSlackMessages(focusedMessages) : "(No focused Slack search matches.)"
      ].join("\n"));
    } catch (error) {
      if (error instanceof SlackContextError) {
        retrievalNotes.push(`Slack search failed (${error.code})`);
        chunks.push([
          "Slack workspace search:",
          `Retrieval error: ${error.message}`
        ].join("\n"));
      } else {
        throw error;
      }
    }
  }

  if (needsLarkContext) {
    try {
      const {
        formatLarkContext,
        searchLarkChatHistory,
        searchLarkDocs,
        searchLarkMinutes
      } = await import("./skills/lark.js");

      const [chatMessages, minutes, docs] = await Promise.all([
        larkTools.chat ? searchLarkChatHistory({ query: larkSearchQuery, limit: 30, ...(plan.oldest ? { oldest: plan.oldest } : {}) }) : Promise.resolve([]),
        larkTools.minutes ? searchLarkMinutes({ query: larkSearchQuery, limit: 10, ...(plan.oldest ? { oldest: plan.oldest } : {}) }) : Promise.resolve([]),
        larkTools.docs ? searchLarkDocs({ query: larkSearchQuery, limit: 10, ...(plan.oldest ? { oldest: plan.oldest } : {}) }) : Promise.resolve([])
      ]);
      const larkItems = [...chatMessages, ...minutes, ...docs];

      retrievalNotes.push(`Lark: ${larkItems.length} items (chat=${larkTools.chat}, minutes=${larkTools.minutes}, docs=${larkTools.docs})`);
      if (larkItems.length > 0) {
        chunks.push([
          "Lark context:",
          formatLarkContext(larkItems)
        ].join("\n"));
      }
    } catch (error) {
      if (isExpectedLarkError(error)) {
        retrievalNotes.push(`Lark: unavailable (${(error as Error).message})`);
      } else {
        throw error;
      }
    }
  }

  const context = chunks.join("\n\n---\n\n");
  const planSummary = [
    `Intent: ${plan.intent}`,
    `Channels: ${plan.channels.join(", ") || "(none)"}`,
    `Slack workspace search: ${shouldSearchSlackWorkspace ? "yes" : "no"}`,
    `Limit per channel: ${plan.limit}`,
    `Time filter: ${plan.oldest ? "today" : "recent"}`,
    `Keywords: ${plan.keywords.join(", ") || "(none)"}`,
    `Person aliases: ${plan.personAliases.join(", ") || "(none)"}`,
    `Person Slack user IDs: ${plan.personSlackUserIds.join(", ") || "(none)"}`,
    `Needs person mapping: ${plan.needsPersonMapping ? "yes" : "no"}`,
    `Needs Lark context: ${needsLarkContext ? "yes" : "no"}`,
    `Lark tools: chat=${larkTools.chat}, minutes=${larkTools.minutes}, docs=${larkTools.docs}`,
    `Lark search query: ${larkSearchQuery}`,
    `Guidance: ${plan.guidance}`
  ].join("\n");

  console.info("[mia] retrieval plan", JSON.stringify({
    intent: plan.intent,
    channels: plan.channels,
    limit: plan.limit,
    timeFilter: plan.oldest ? "today" : "recent",
    keywords: plan.keywords,
    personAliases: plan.personAliases,
    personSlackUserIds: plan.personSlackUserIds,
    needsPersonMapping: plan.needsPersonMapping,
    needsLarkContext,
    larkTools,
    modelPlan
  }));
  console.info("[mia] retrieval notes", retrievalNotes.join(" | ") || "none");

  const answer = await generateText({
    system: loadSystemPrompt(),
    user: [
      "Lewis asked:",
      userText,
      "",
      "Request source:",
      agentRequest.source,
      "",
      "Retrieval plan:",
      planSummary,
      "",
      "Retrieved context:",
      context || "(No Slack context retrieved. Ask Lewis for #channel name or configure customer alias mapping.)",
      "",
      "Retrieval notes:",
      retrievalNotes.join("\n") || "(No retrieval attempted.)",
      "",
      "Answering instructions:",
      "- Answer Lewis' exact question first. Do not default to a generic channel summary.",
      "- If focused matches are empty, say no direct evidence was retrieved and explain what context is missing.",
      "- If the question asks about a role such as CEO and no person mapping was retrieved, ask Lewis to add that mapping or provide the person's Slack name.",
      "- Keep facts and inference separate.",
      "",
      "Answer in Chinese unless Lewis asks otherwise."
    ].join("\n"),
    temperature: 0.2
  });

  const reply: AgentReply = {
    text: answer,
    ...(agentRequest.threadId ? { threadId: agentRequest.threadId } : {})
  };

  return {
    answer: reply.text,
    reply,
    debug: {
      plan,
      modelPlan,
      retrievalNotes
    }
  };
}

export async function answerLewisQuestion(request: string | AgentRequest): Promise<AgentReply> {
  const result = await answerLewisQuestionWithDebug(request);
  return result.reply;
}

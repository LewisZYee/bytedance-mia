import { generateText } from "./services/llm.js";
import { makeRetrievalPlan, filterFocusedMessages, type RetrievalPlan } from "./retrieval/planner.js";
import { formatLarkContext, LarkSkillNotConfiguredError, searchLarkChatHistory, searchLarkMinutes } from "./skills/lark.js";
import { fetchChannelHistory, formatSlackMessages, SlackContextError } from "./skills/slack.js";
import { loadCustomers, loadSystemPrompt } from "./config.js";
import type { AgentReply, AgentRequest } from "./connectors/types.js";

export type AgentDebugInfo = {
  plan: RetrievalPlan;
  retrievalNotes: string[];
};

export async function answerLewisQuestionWithDebug(request: string | AgentRequest) {
  const agentRequest = typeof request === "string" ? { text: request, source: "cli" as const } : request;
  const userText = agentRequest.text;
  const plan = makeRetrievalPlan(userText, loadCustomers());

  const chunks: string[] = [];
  const retrievalNotes: string[] = [];

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

  if (plan.needsLarkContext) {
    try {
      const [chatMessages, minutes] = await Promise.all([
        searchLarkChatHistory({ query: userText, limit: 30 }),
        searchLarkMinutes({ query: userText, limit: 10 })
      ]);
      const larkItems = [...chatMessages, ...minutes];

      retrievalNotes.push(`Lark: ${larkItems.length} items`);
      if (larkItems.length > 0) {
        chunks.push([
          "Lark context:",
          formatLarkContext(larkItems)
        ].join("\n"));
      }
    } catch (error) {
      if (error instanceof LarkSkillNotConfiguredError) {
        retrievalNotes.push(`Lark: not configured (${error.message})`);
      } else {
        throw error;
      }
    }
  }

  const context = chunks.join("\n\n---\n\n");
  const planSummary = [
    `Intent: ${plan.intent}`,
    `Channels: ${plan.channels.join(", ") || "(none)"}`,
    `Limit per channel: ${plan.limit}`,
    `Time filter: ${plan.oldest ? "today" : "recent"}`,
    `Keywords: ${plan.keywords.join(", ") || "(none)"}`,
    `Person aliases: ${plan.personAliases.join(", ") || "(none)"}`,
    `Person Slack user IDs: ${plan.personSlackUserIds.join(", ") || "(none)"}`,
    `Needs person mapping: ${plan.needsPersonMapping ? "yes" : "no"}`,
    `Needs Lark context: ${plan.needsLarkContext ? "yes" : "no"}`,
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
    needsLarkContext: plan.needsLarkContext
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
      retrievalNotes
    }
  };
}

export async function answerLewisQuestion(request: string | AgentRequest): Promise<AgentReply> {
  const result = await answerLewisQuestionWithDebug(request);
  return result.reply;
}

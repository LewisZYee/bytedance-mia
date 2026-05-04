import fs from "node:fs";
import path from "node:path";

export function readTextFile(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

export function readJsonFile<T>(relativePath: string): T {
  return JSON.parse(readTextFile(relativePath)) as T;
}

export type CustomerConfig = {
  customers: Record<string, {
    aliases: string[];
    slackChannels: string[];
    people?: Record<string, {
      aliases: string[];
      roles?: string[];
      slackUserIds?: string[];
    }>;
  }>;
};

export function loadCustomers() {
  return readJsonFile<CustomerConfig>("config/customers.json");
}

export function loadSystemPrompt() {
  return readTextFile("prompts/system.md");
}

export function loadPlannerPrompt() {
  return readTextFile("prompts/planner.md");
}

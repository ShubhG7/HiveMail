import { prisma } from "./db";
import { decrypt } from "./encryption";

export type LLMProvider = 
  | "gemini-2.5-flash" 
  | "gemini-2.5-pro" 
  | "gemini-2.0-flash"
  | "openai-gpt-4"
  | "openai-gpt-4-turbo"
  | "openai-gpt-3.5-turbo"
  | "anthropic-claude-3-5-sonnet"
  | "anthropic-claude-3-opus"
  | "anthropic-claude-3-haiku"
  | "custom";

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl?: string; // For custom providers
  model?: string; // For custom providers
}

export interface ClassificationResult {
  category: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  needsReply: boolean;
  spamScore: number;
  sensitiveFlags: string[];
  confidence: number;
}

export interface SummaryResult {
  shortSummary: string;
  fullSummary: string;
  whatChanged?: string;
}

export interface ExtractionResult {
  tasks: Array<{
    title: string;
    dueDate?: string;
    priority: string;
  }>;
  deadlines: Array<{
    description: string;
    date: string;
  }>;
  entities: {
    people: string[];
    organizations: string[];
    locations: string[];
    phoneNumbers: string[];
    emails: string[];
    urls: string[];
  };
  keyFacts: string[];
}

export interface ChatResponse {
  answer: string;
  citations: Array<{
    threadId?: string;
    messageId?: string;
    snippet: string;
  }>;
  suggestedActions: Array<{
    type: "open_thread" | "draft_reply" | "create_task" | "filter_search";
    label: string;
    params: Record<string, string>;
  }>;
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

const MODEL_MAP: Partial<Record<LLMProvider, string>> = {
  "gemini-2.5-flash": "models/gemini-2.5-flash-preview-05-20",
  "gemini-2.5-pro": "models/gemini-2.5-pro-preview-05-06",
  "gemini-2.0-flash": "models/gemini-2.0-flash",
  "openai-gpt-4": "gpt-4",
  "openai-gpt-4-turbo": "gpt-4-turbo-preview",
  "openai-gpt-3.5-turbo": "gpt-3.5-turbo",
  "anthropic-claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "anthropic-claude-3-opus": "claude-3-opus-20240229",
  "anthropic-claude-3-haiku": "claude-3-haiku-20240307",
};

/**
 * Get LLM config for a user
 */
export async function getLLMConfig(userId: string): Promise<LLMConfig | null> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  if (!settings?.llmApiKeyEnc) {
    return null;
  }

  const apiKey = decrypt(settings.llmApiKeyEnc);
  if (!apiKey) {
    return null;
  }

  const config: LLMConfig = {
    provider: settings.llmProvider as LLMProvider,
    apiKey,
  };

  // For custom providers, include baseUrl and model
  if (settings.llmProvider === "custom") {
    config.baseUrl = (settings as any).llmBaseUrl || undefined;
    config.model = (settings as any).llmModel || undefined;
  }

  return config;
}

/**
 * Unified LLM caller that supports multiple providers
 */
async function callLLM<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: object
): Promise<T> {
  // Route to appropriate provider
  if (config.provider.startsWith("gemini-")) {
    return callGemini(config, systemPrompt, userPrompt, responseSchema);
  } else if (config.provider.startsWith("openai-")) {
    return callOpenAI(config, systemPrompt, userPrompt, responseSchema);
  } else if (config.provider.startsWith("anthropic-")) {
    return callAnthropic(config, systemPrompt, userPrompt, responseSchema);
  } else if (config.provider === "custom") {
    return callCustom(config, systemPrompt, userPrompt, responseSchema);
  } else {
    throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

/**
 * Call Gemini API
 */
async function callGemini<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: object
): Promise<T> {
  const model = MODEL_MAP[config.provider] || MODEL_MAP["gemini-2.5-flash"];
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${config.apiKey}`;

  const requestBody: any = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${systemPrompt}\n\n${userPrompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 4096,
    },
  };

  if (responseSchema) {
    requestBody.generationConfig.responseMimeType = "application/json";
    requestBody.generationConfig.responseSchema = responseSchema;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("No response from Gemini API");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: object
): Promise<T> {
  const model = MODEL_MAP[config.provider] || "gpt-3.5-turbo";
  const url = `${OPENAI_API_BASE}/chat/completions`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const requestBody: any = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 4096,
  };

  if (responseSchema) {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("No response from OpenAI API");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/**
 * Call Anthropic API
 */
async function callAnthropic<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: object
): Promise<T> {
  const model = MODEL_MAP[config.provider] || "claude-3-haiku-20240307";
  const url = `${ANTHROPIC_API_BASE}/messages`;

  const requestBody: any = {
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  };

  if (responseSchema) {
    // Anthropic doesn't support structured output directly, but we can request JSON
    requestBody.system = `${systemPrompt}\n\nRespond with valid JSON only.`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;

  if (!text) {
    throw new Error("No response from Anthropic API");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/**
 * Call custom LLM API (OpenAI-compatible)
 */
async function callCustom<T>(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: object
): Promise<T> {
  if (!config.baseUrl || !config.model) {
    throw new Error("Custom provider requires baseUrl and model");
  }

  const url = `${config.baseUrl}/chat/completions`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const requestBody: any = {
    model: config.model,
    messages,
    temperature: 0.2,
    max_tokens: 4096,
  };

  if (responseSchema) {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Custom LLM API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("No response from custom LLM API");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/**
 * Classify an email thread
 */
export async function classifyEmail(
  config: LLMConfig,
  content: {
    subject: string;
    from: string;
    snippet: string;
    bodyPreview: string;
    labels: string[];
  }
): Promise<ClassificationResult> {
  const systemPrompt = `You are an email classification assistant. Analyze the email and classify it.

Categories:
- hiring: Job opportunities, interviews, recruiter outreach
- bills: Invoices, payment due, bills, statements
- school: Education, courses, academic communications
- receipts: Purchase confirmations, order receipts
- newsletters: Marketing emails, newsletters, promotional content
- social: Social media notifications, friend requests
- shipping: Package tracking, delivery updates
- finance: Bank statements, investment updates, financial alerts
- misc: Everything else

Return a JSON object with your classification.`;

  const userPrompt = `Classify this email:
Subject: ${content.subject || "(No subject)"}
From: ${content.from}
Labels: ${content.labels.join(", ") || "None"}
Snippet: ${content.snippet || ""}
Body preview: ${content.bodyPreview?.slice(0, 500) || ""}`;

  const schema = {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["hiring", "bills", "school", "receipts", "newsletters", "social", "shipping", "finance", "misc"],
      },
      priority: {
        type: "string",
        enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      },
      needsReply: { type: "boolean" },
      spamScore: { type: "number" },
      sensitiveFlags: {
        type: "array",
        items: { type: "string" },
      },
      confidence: { type: "number" },
    },
    required: ["category", "priority", "needsReply", "spamScore", "sensitiveFlags", "confidence"],
  };

  return callLLM<ClassificationResult>(config, systemPrompt, userPrompt, schema);
}

/**
 * Summarize an email thread
 */
export async function summarizeThread(
  config: LLMConfig,
  thread: {
    subject: string;
    messages: Array<{
      from: string;
      date: string;
      bodyPreview: string;
    }>;
    previousSummary?: string;
  }
): Promise<SummaryResult> {
  const systemPrompt = `You are an email summarization assistant. Create concise summaries of email threads.

Guidelines:
- Short summary: 1-2 sentences, key point only
- Full summary: 2-4 sentences with important details
- If there's a previous summary and new messages, explain what changed`;

  const messagesText = thread.messages
    .map((m, i) => `[${i + 1}] From: ${m.from} (${m.date})\n${m.bodyPreview?.slice(0, 300)}`)
    .join("\n\n");

  const userPrompt = `Summarize this email thread:
Subject: ${thread.subject || "(No subject)"}

Messages:
${messagesText}
${thread.previousSummary ? `\nPrevious summary: ${thread.previousSummary}` : ""}`;

  const schema = {
    type: "object",
    properties: {
      shortSummary: { type: "string" },
      fullSummary: { type: "string" },
      whatChanged: { type: "string" },
    },
    required: ["shortSummary", "fullSummary"],
  };

  return callLLM<SummaryResult>(config, systemPrompt, userPrompt, schema);
}

/**
 * Extract structured information from email
 */
export async function extractFromEmail(
  config: LLMConfig,
  content: {
    subject: string;
    body: string;
  }
): Promise<ExtractionResult> {
  const systemPrompt = `You are an email extraction assistant. Extract structured information from emails.

Extract:
- Tasks: action items mentioned
- Deadlines: dates and time-sensitive items
- Entities: people, organizations, locations, contact info, URLs
- Key facts: important information worth remembering`;

  const userPrompt = `Extract information from this email:
Subject: ${content.subject || "(No subject)"}
Body: ${content.body?.slice(0, 2000) || ""}`;

  const schema = {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            dueDate: { type: "string" },
            priority: { type: "string" },
          },
          required: ["title"],
        },
      },
      deadlines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            date: { type: "string" },
          },
          required: ["description", "date"],
        },
      },
      entities: {
        type: "object",
        properties: {
          people: { type: "array", items: { type: "string" } },
          organizations: { type: "array", items: { type: "string" } },
          locations: { type: "array", items: { type: "string" } },
          phoneNumbers: { type: "array", items: { type: "string" } },
          emails: { type: "array", items: { type: "string" } },
          urls: { type: "array", items: { type: "string" } },
        },
        required: ["people", "organizations", "locations", "phoneNumbers", "emails", "urls"],
      },
      keyFacts: { type: "array", items: { type: "string" } },
    },
    required: ["tasks", "deadlines", "entities", "keyFacts"],
  };

  return callLLM<ExtractionResult>(config, systemPrompt, userPrompt, schema);
}

/**
 * Generate a reply draft
 */
export async function generateReplyDraft(
  config: LLMConfig,
  context: {
    threadSummary: string;
    lastMessage: {
      from: string;
      body: string;
    };
    userInstructions?: string;
    userTone?: string;
    extractedFacts?: string[];
  }
): Promise<string> {
  const systemPrompt = `You are an email reply assistant. Draft professional, helpful replies.

Guidelines:
- Match the appropriate tone (${context.userTone || "professional and friendly"})
- Be concise but complete
- Address the key points from the last message
- Don't be overly formal or robotic`;

  const userPrompt = `Draft a reply for this email thread:

Thread summary: ${context.threadSummary}

Last message from ${context.lastMessage.from}:
${context.lastMessage.body?.slice(0, 1500)}

${context.extractedFacts?.length ? `Key facts: ${context.extractedFacts.join(", ")}` : ""}
${context.userInstructions ? `User instructions: ${context.userInstructions}` : ""}

Write only the reply body, no subject line.`;

  return callLLM<string>(config, systemPrompt, userPrompt);
}

/**
 * Chat with email context
 */
export async function chatWithContext(
  config: LLMConfig,
  query: string,
  context: {
    relevantThreads: Array<{
      threadId: string;
      subject: string;
      summary: string;
      participants: string[];
      lastMessageAt: string;
    }>;
    relevantMessages: Array<{
      messageId: string;
      threadId: string;
      from: string;
      snippet: string;
      date: string;
    }>;
    chatHistory?: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
  }
): Promise<ChatResponse> {
  const systemPrompt = `You are an email assistant with access to the user's email data. Answer questions about their emails.

Guidelines:
- Only answer based on the provided email context
- If you don't have enough information, say so clearly
- Always cite specific emails/threads when making claims
- Suggest helpful follow-up actions when appropriate
- Don't make up information that isn't in the context

You have access to these commands:
- open: <threadId> - Opens a specific thread
- show emails from <sender> last week - Searches by sender and date
- find the email with <search term> - Searches email content`;

  const threadsContext = context.relevantThreads
    .map((t) => `Thread [${t.threadId}]: "${t.subject}" with ${t.participants.join(", ")} - ${t.summary}`)
    .join("\n");

  const messagesContext = context.relevantMessages
    .map((m) => `Message [${m.messageId}] in thread [${m.threadId}]: From ${m.from} on ${m.date} - ${m.snippet}`)
    .join("\n");

  const historyText = context.chatHistory
    ?.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n") || "";

  const userPrompt = `${historyText ? `Chat history:\n${historyText}\n\n` : ""}
Relevant threads:
${threadsContext || "No relevant threads found."}

Relevant messages:
${messagesContext || "No relevant messages found."}

User question: ${query}`;

  const schema = {
    type: "object",
    properties: {
      answer: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            threadId: { type: "string" },
            messageId: { type: "string" },
            snippet: { type: "string" },
          },
        },
      },
      suggestedActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["open_thread", "draft_reply", "create_task", "filter_search"],
            },
            label: { type: "string" },
            params: { type: "object" },
          },
          required: ["type", "label", "params"],
        },
      },
    },
    required: ["answer", "citations", "suggestedActions"],
  };

  return callLLM<ChatResponse>(config, systemPrompt, userPrompt, schema);
}

/**
 * Generate embedding for text using Gemini
 */
export async function generateEmbedding(
  config: LLMConfig,
  text: string
): Promise<number[]> {
  const url = `${GEMINI_API_BASE}/models/text-embedding-004:embedContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: {
        parts: [{ text: text.slice(0, 2048) }],
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini embedding error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

/**
 * Detect sensitive content patterns
 */
export function detectSensitivePatterns(text: string): string[] {
  const patterns: string[] = [];

  // SSN pattern
  if (/\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/.test(text)) {
    patterns.push("potential_ssn");
  }

  // Credit card pattern
  if (/\b(?:\d{4}[-.\s]?){3}\d{4}\b/.test(text)) {
    patterns.push("potential_credit_card");
  }

  // Phone number
  if (/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text)) {
    patterns.push("phone_number");
  }

  // Email addresses (beyond sender/recipient)
  const emails = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g);
  if (emails && emails.length > 2) {
    patterns.push("multiple_emails");
  }

  // Physical address pattern
  if (/\b\d+\s+[A-Za-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)\b/i.test(text)) {
    patterns.push("physical_address");
  }

  // Bank account / routing numbers
  if (/\b(?:account|routing)[:\s#]*\d{8,17}\b/i.test(text)) {
    patterns.push("bank_account");
  }

  // Password / credential mentions
  if (/\b(?:password|passwd|pwd)[:\s]+\S+/i.test(text)) {
    patterns.push("credential");
  }

  return patterns;
}

/**
 * Redact sensitive content from text
 */
export function redactSensitiveContent(text: string): string {
  let redacted = text;

  // Redact SSN
  redacted = redacted.replace(/\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, "[REDACTED-SSN]");

  // Redact credit card
  redacted = redacted.replace(/\b(?:\d{4}[-.\s]?){3}\d{4}\b/g, "[REDACTED-CC]");

  // Redact bank account numbers
  redacted = redacted.replace(/\b(?:account|routing)[:\s#]*\d{8,17}\b/gi, "[REDACTED-ACCOUNT]");

  // Redact passwords
  redacted = redacted.replace(/\b(?:password|passwd|pwd)[:\s]+\S+/gi, "[REDACTED-CREDENTIAL]");

  return redacted;
}

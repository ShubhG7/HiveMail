import { google, gmail_v1 } from "googleapis";
import { prisma } from "./db";
import { decrypt, encrypt, hashContent } from "./encryption";

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: gmail_v1.Schema$MessagePart;
  internalDate: string;
}

export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  date: Date;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  labels: string[];
  hasAttachments: boolean;
  attachments: AttachmentMeta[];
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

/**
 * Creates an authenticated Gmail client for a user
 */
export async function getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
  const oauthToken = await prisma.oAuthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "google",
      },
    },
  });

  if (!oauthToken) {
    throw new Error("No OAuth token found for user");
  }

  const accessToken = decrypt(oauthToken.accessTokenEnc);
  const refreshToken = decrypt(oauthToken.refreshTokenEnc);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: oauthToken.expiry?.getTime(),
  });

  // Handle token refresh
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.oAuthToken.update({
        where: {
          userId_provider: {
            userId,
            provider: "google",
          },
        },
        data: {
          accessTokenEnc: encrypt(tokens.access_token),
          expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });
    }
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Fetches messages for initial backfill
 */
export async function fetchBackfillMessages(
  gmail: gmail_v1.Gmail,
  options: {
    afterDate: Date;
    includeLabels?: string[];
    excludeLabels?: string[];
    maxResults?: number;
  }
): Promise<string[]> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  // Build query
  const queryParts: string[] = [];
  
  // Date filter
  const afterTimestamp = Math.floor(options.afterDate.getTime() / 1000);
  queryParts.push(`after:${afterTimestamp}`);

  // Label filters
  if (options.excludeLabels?.length) {
    options.excludeLabels.forEach((label) => {
      queryParts.push(`-label:${label}`);
    });
  }

  const query = queryParts.join(" ");

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(options.maxResults || 500, 500),
      pageToken,
    });

    if (response.data.messages) {
      for (const msg of response.data.messages) {
        if (msg.id) {
          messageIds.push(msg.id);
        }
      }
    }

    pageToken = response.data.nextPageToken || undefined;

    // Respect max results
    if (options.maxResults && messageIds.length >= options.maxResults) {
      break;
    }
  } while (pageToken);

  return messageIds;
}

/**
 * Fetches incremental changes using Gmail history API
 */
export async function fetchHistoryChanges(
  gmail: gmail_v1.Gmail,
  startHistoryId: string
): Promise<{
  messageIds: string[];
  newHistoryId: string | null;
}> {
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let newHistoryId: string | null = null;

  try {
    do {
      const response = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
        pageToken,
      });

      newHistoryId = response.data.historyId || null;

      if (response.data.history) {
        for (const record of response.data.history) {
          // Messages added
          if (record.messagesAdded) {
            for (const added of record.messagesAdded) {
              if (added.message?.id) {
                messageIds.add(added.message.id);
              }
            }
          }
          // Label changes (might affect categorization)
          if (record.labelsAdded) {
            for (const labeled of record.labelsAdded) {
              if (labeled.message?.id) {
                messageIds.add(labeled.message.id);
              }
            }
          }
          if (record.labelsRemoved) {
            for (const unlabeled of record.labelsRemoved) {
              if (unlabeled.message?.id) {
                messageIds.add(unlabeled.message.id);
              }
            }
          }
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (error: any) {
    // If historyId is too old, we need to do a full sync
    if (error.code === 404) {
      return { messageIds: [], newHistoryId: null };
    }
    throw error;
  }

  return {
    messageIds: Array.from(messageIds),
    newHistoryId,
  };
}

/**
 * Fetches a single message with full payload
 */
export async function fetchMessage(
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<GmailMessage | null> {
  try {
    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    return response.data as GmailMessage;
  } catch (error: any) {
    if (error.code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetches messages in batch
 */
export async function fetchMessagesBatch(
  gmail: gmail_v1.Gmail,
  messageIds: string[],
  batchSize: number = 50
): Promise<GmailMessage[]> {
  const messages: GmailMessage[] = [];

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((id) => fetchMessage(gmail, id))
    );
    messages.push(...results.filter((m): m is GmailMessage => m !== null));
  }

  return messages;
}

/**
 * Parses a Gmail message into our internal format
 */
export function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const headers = message.payload?.headers || [];
  const getHeader = (name: string): string | null => {
    const header = headers.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    );
    return header?.value || null;
  };

  // Parse addresses
  const parseAddress = (value: string | null): { email: string; name: string | null } => {
    if (!value) return { email: "", name: null };
    const match = value.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
    if (match) {
      return { email: match[2], name: match[1] || null };
    }
    return { email: value, name: null };
  };

  const parseAddressList = (value: string | null): string[] => {
    if (!value) return [];
    return value.split(",").map((addr) => parseAddress(addr.trim()).email).filter(Boolean);
  };

  const from = parseAddress(getHeader("From"));
  const date = getHeader("Date");

  // Extract body
  const { bodyText, bodyHtml } = extractBody(message.payload);

  // Check for attachments
  const attachments: AttachmentMeta[] = [];
  extractAttachments(message.payload, attachments);

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    fromAddress: from.email,
    fromName: from.name,
    toAddresses: parseAddressList(getHeader("To")),
    ccAddresses: parseAddressList(getHeader("Cc")),
    bccAddresses: parseAddressList(getHeader("Bcc")),
    date: date ? new Date(date) : new Date(parseInt(message.internalDate)),
    subject: getHeader("Subject"),
    snippet: message.snippet,
    bodyText,
    bodyHtml,
    labels: message.labelIds || [],
    hasAttachments: attachments.length > 0,
    attachments,
  };
}

function extractBody(payload: gmail_v1.Schema$MessagePart): {
  bodyText: string | null;
  bodyHtml: string | null;
} {
  let bodyText: string | null = null;
  let bodyHtml: string | null = null;

  const processPayload = (part: gmail_v1.Schema$MessagePart) => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      bodyText = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      bodyHtml = Buffer.from(part.body.data, "base64").toString("utf-8");
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        processPayload(subPart);
      }
    }
  };

  processPayload(payload);

  // If no plain text, try to extract from HTML
  if (!bodyText && bodyHtml) {
    bodyText = htmlToText(bodyHtml);
  }

  return { bodyText, bodyHtml };
}

function extractAttachments(
  payload: gmail_v1.Schema$MessagePart,
  attachments: AttachmentMeta[]
) {
  if (payload.filename && payload.body?.attachmentId) {
    attachments.push({
      filename: payload.filename,
      mimeType: payload.mimeType || "application/octet-stream",
      size: payload.body.size || 0,
      attachmentId: payload.body.attachmentId,
    });
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      extractAttachments(part, attachments);
    }
  }
}

/**
 * Basic HTML to text conversion
 */
export function htmlToText(html: string): string {
  return html
    // Remove scripts and styles
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Replace common tags
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

/**
 * Send an email reply using Gmail API
 */
export async function sendReply(
  gmail: gmail_v1.Gmail,
  options: {
    threadId: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<string> {
  const boundary = "boundary_" + Date.now();

  const emailLines = [
    `To: ${options.to.join(", ")}`,
    ...(options.cc?.length ? [`Cc: ${options.cc.join(", ")}`] : []),
    `Subject: ${options.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...(options.inReplyTo ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(options.references ? [`References: ${options.references}`] : []),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    options.body,
    "",
    `--${boundary}--`,
  ];

  const email = emailLines.join("\r\n");
  const encodedEmail = Buffer.from(email).toString("base64url");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedEmail,
      threadId: options.threadId,
    },
  });

  return response.data.id!;
}

/**
 * Get the current Gmail profile and history ID
 */
export async function getGmailProfile(gmail: gmail_v1.Gmail): Promise<{
  email: string;
  historyId: string;
}> {
  const response = await gmail.users.getProfile({ userId: "me" });
  return {
    email: response.data.emailAddress!,
    historyId: response.data.historyId!,
  };
}

/**
 * Generate a Gmail deep link for a message
 */
export function getGmailMessageLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

/**
 * Generate a Gmail deep link for a thread
 */
export function getGmailThreadLink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

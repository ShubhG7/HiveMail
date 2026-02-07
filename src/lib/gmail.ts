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

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Send an email reply using Gmail API
 */
export async function sendReply(
  gmail: gmail_v1.Gmail,
  options: {
    threadId?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyHtml?: string;
    attachments?: Attachment[];
    inReplyTo?: string;
    references?: string;
  }
): Promise<string> {
  const boundary = "boundary_" + Date.now();
  const hasAttachments = options.attachments && options.attachments.length > 0;
  const isHtml = !!options.bodyHtml;

  // Build email headers
  const emailParts: string[] = [
    `To: ${options.to.join(", ")}`,
    ...(options.cc?.length ? [`Cc: ${options.cc.join(", ")}`] : []),
    ...(options.bcc?.length ? [`Bcc: ${options.bcc.join(", ")}`] : []),
    `Subject: ${options.subject}`,
    "MIME-Version: 1.0",
    ...(options.inReplyTo ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(options.references ? [`References: ${options.references}`] : []),
  ];

  if (hasAttachments) {
    // Multipart/mixed for attachments
    emailParts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    emailParts.push("");

    // Add message body as multipart/alternative
    const altBoundary = "alt_" + Date.now();
    emailParts.push(`--${boundary}`);
    emailParts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    emailParts.push("");

    // Plain text part
    emailParts.push(`--${altBoundary}`);
    emailParts.push("Content-Type: text/plain; charset=UTF-8");
    emailParts.push("Content-Transfer-Encoding: 7bit");
    emailParts.push("");
    emailParts.push(options.body);
    emailParts.push("");

    // HTML part if provided
    if (isHtml) {
      emailParts.push(`--${altBoundary}`);
      emailParts.push("Content-Type: text/html; charset=UTF-8");
      emailParts.push("Content-Transfer-Encoding: 7bit");
      emailParts.push("");
      emailParts.push(options.bodyHtml!);
      emailParts.push("");
    }

    emailParts.push(`--${altBoundary}--`);

    // Add attachments
    for (const attachment of options.attachments!) {
      emailParts.push(`--${boundary}`);
      emailParts.push(`Content-Type: ${attachment.contentType}`);
      emailParts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      emailParts.push("Content-Transfer-Encoding: base64");
      emailParts.push("");
      emailParts.push(attachment.content.toString("base64"));
      emailParts.push("");
    }

    emailParts.push(`--${boundary}--`);
  } else {
    // Simple multipart/alternative for text/html
    if (isHtml) {
      emailParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      emailParts.push("");

      // Plain text
      emailParts.push(`--${boundary}`);
      emailParts.push("Content-Type: text/plain; charset=UTF-8");
      emailParts.push("");
      emailParts.push(options.body);
      emailParts.push("");

      // HTML
      emailParts.push(`--${boundary}`);
      emailParts.push("Content-Type: text/html; charset=UTF-8");
      emailParts.push("");
      emailParts.push(options.bodyHtml!);
      emailParts.push("");

      emailParts.push(`--${boundary}--`);
    } else {
      // Plain text only
      emailParts.push("Content-Type: text/plain; charset=UTF-8");
      emailParts.push("");
      emailParts.push(options.body);
    }
  }

  const email = emailParts.join("\r\n");
  const encodedEmail = Buffer.from(email).toString("base64url");

  const requestBody: gmail_v1.Schema$Message = {
    raw: encodedEmail,
  };

  if (options.threadId) {
    requestBody.threadId = options.threadId;
  }

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody,
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

/**
 * Setup Gmail push notifications using Watch API
 * Requires a public webhook URL that Gmail can POST to
 */
export async function watchGmail(
  gmail: gmail_v1.Gmail,
  webhookUrl: string,
  topicName?: string
): Promise<{
  expiration: number;
  historyId: string;
}> {
  const requestBody: gmail_v1.Schema$WatchRequest = {
    topicName: topicName || undefined,
    labelIds: ["INBOX"], // Watch for inbox messages
  };

  // If no topicName provided, Gmail will use the webhook URL directly
  // For production, you should use Google Cloud Pub/Sub
  const response = await gmail.users.watch({
    userId: "me",
    requestBody,
  });

  return {
    expiration: response.data.expiration || 0,
    historyId: response.data.historyId || "",
  };
}

/**
 * Stop Gmail push notifications
 */
export async function stopWatchGmail(
  gmail: gmail_v1.Gmail
): Promise<void> {
  await gmail.users.stop({
    userId: "me",
  });
}

/**
 * Setup Gmail push notifications using Watch API
 * 
 * This registers the user's Gmail account to send push notifications
 * to our Pub/Sub topic when new emails arrive.
 * 
 * Prerequisites:
 * 1. Create a Cloud Pub/Sub topic (e.g., projects/your-project/topics/gmail-push)
 * 2. Grant Gmail publish permissions to the topic
 * 3. Set GOOGLE_PUBSUB_TOPIC env var
 * 
 * @returns The expiration time of the watch (typically 7 days)
 */
export async function setupGmailWatch(gmail: gmail_v1.Gmail): Promise<{
  historyId: string;
  expiration: number;
} | null> {
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  
  if (!topicName) {
    console.warn("[Gmail Watch] GOOGLE_PUBSUB_TOPIC not configured, skipping watch setup");
    return null;
  }

  try {
    const response = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["INBOX"], // Only watch inbox for new emails
        labelFilterBehavior: "INCLUDE",
      },
    });

    console.log("[Gmail Watch] Watch registered successfully", {
      historyId: response.data.historyId,
      expiration: response.data.expiration,
    });

    return {
      historyId: response.data.historyId!,
      expiration: parseInt(response.data.expiration!),
    };
  } catch (error: any) {
    console.error("[Gmail Watch] Failed to setup watch", {
      error: error.message,
      code: error.code,
    });
    return null;
  }
}

/**
 * Stop Gmail push notifications
 */
export async function stopGmailWatch(gmail: gmail_v1.Gmail): Promise<boolean> {
  try {
    await gmail.users.stop({ userId: "me" });
    console.log("[Gmail Watch] Watch stopped successfully");
    return true;
  } catch (error: any) {
    console.error("[Gmail Watch] Failed to stop watch", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Check if Gmail watch is active and renew if needed
 * 
 * Gmail watches expire after 7 days, so this should be called
 * periodically (e.g., daily via cron) to renew them.
 */
export async function renewGmailWatchIfNeeded(
  gmail: gmail_v1.Gmail,
  currentExpiration: number | null
): Promise<{
  historyId: string;
  expiration: number;
} | null> {
  // Renew if expiration is within 24 hours or unknown
  const renewThreshold = Date.now() + 24 * 60 * 60 * 1000;
  
  if (!currentExpiration || currentExpiration < renewThreshold) {
    console.log("[Gmail Watch] Watch expiring soon or not set, renewing...");
    return setupGmailWatch(gmail);
  }
  
  console.log("[Gmail Watch] Watch still valid", {
    expiresIn: Math.round((currentExpiration - Date.now()) / (60 * 60 * 1000)) + " hours",
  });
  
  return null;
}

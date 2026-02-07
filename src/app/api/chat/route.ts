import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLLMConfig, chatWithContext, generateEmbedding } from "@/lib/llm";
import { parseSearchQuery } from "@/lib/utils";
import { getCachedEmailStats } from "@/lib/email-stats";

// Detect if message is asking for stats/analytics
function isStatsQuery(message: string): boolean {
  const statsKeywords = [
    "how many", "count", "total", "number of",
    "statistics", "stats", "analytics",
    "percentage", "percent", "%",
    "most", "least", "top", "bottom",
    "breakdown", "summary", "overview",
    "rejection", "rejected", "accepted", "offer",
    "unread", "replied", "needs reply",
    "this week", "this month", "today", "yesterday",
    "average", "trend", "compare"
  ];
  const lowerMessage = message.toLowerCase();
  return statsKeywords.some(keyword => lowerMessage.includes(keyword));
}


export async function POST(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { message, sessionId } = body;

    if (!message || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    console.log("[Chat API] Processing chat message", {
      userId: session.user.id,
      sessionId,
      messageLength: message.length,
    });

    const llmConfig = await getLLMConfig(session.user.id);
    
    if (!llmConfig) {
      console.warn("[Chat API] LLM not configured for user", { userId: session.user.id });
      return NextResponse.json(
        { error: "LLM API key not configured. Please add your API key in Settings." },
        { status: 400 }
      );
    }

    console.log("[Chat API] LLM config loaded", {
      userId: session.user.id,
      provider: llmConfig.provider,
    });

    // Check if this is a stats query
    const wantsStats = isStatsQuery(message);
    let emailStats = null;
    
    if (wantsStats) {
      console.log("[Chat API] Getting cached email statistics for stats query");
      emailStats = await getCachedEmailStats(session.user.id, 60); // Cache for 60 minutes
      console.log("[Chat API] Stats retrieved", {
        totalThreads: emailStats.totalThreads,
        rejectionCount: emailStats.rejectionCount,
        offerCount: emailStats.offerCount,
      });
    }

    // Parse search intent from message
    const { terms, filters } = parseSearchQuery(message);
    const searchText = terms.join(" ");

    // Build search query
    const whereClause: any = { userId: session.user.id };

    if (filters.from) {
      whereClause.messages = {
        some: { fromAddress: { contains: filters.from, mode: "insensitive" } },
      };
    }
    if (filters.category) {
      whereClause.category = filters.category;
    }
    if (filters.after) {
      whereClause.lastMessageAt = { gte: new Date(filters.after) };
    }
    if (filters.before) {
      whereClause.lastMessageAt = { lte: new Date(filters.before) };
    }

    // Hybrid search: SQL + Vector
    const relevantThreads: any[] = [];
    const relevantMessages: any[] = [];

    // Text search
    if (searchText) {
      try {
        console.log("[Chat API] Performing text search", { searchText });

        const textSearchThreads = await prisma.thread.findMany({
          where: {
            ...whereClause,
            OR: [
              { subject: { contains: searchText, mode: "insensitive" } },
              { summary: { contains: searchText, mode: "insensitive" } },
              { participants: { hasSome: [searchText] } },
            ],
          },
          orderBy: { lastMessageAt: "desc" },
          take: 10,
        });
        relevantThreads.push(...textSearchThreads);

        // Message search
        const textSearchMessages = await prisma.message.findMany({
          where: {
            userId: session.user.id,
            OR: [
              { subject: { contains: searchText, mode: "insensitive" } },
              { snippet: { contains: searchText, mode: "insensitive" } },
              { fromAddress: { contains: searchText, mode: "insensitive" } },
            ],
          },
          orderBy: { date: "desc" },
          take: 10,
        });
        relevantMessages.push(...textSearchMessages);

        console.log("[Chat API] Text search completed", {
          threads: textSearchThreads.length,
          messages: textSearchMessages.length,
        });
      } catch (textSearchError: any) {
        console.error("[Chat API] Text search failed:", {
          error: textSearchError.message,
          stack: textSearchError.stack,
        });
        // Continue without text search results
      }
    }

    // Vector search (if we have embeddings and provider supports it)
    try {
      console.log("[Chat API] Attempting to generate embedding for vector search");
      const queryEmbedding = await generateEmbedding(llmConfig, message);
      
      // Only do vector search if we got a valid embedding
      if (queryEmbedding && queryEmbedding.length > 0) {
        try {
          console.log("[Chat API] Performing vector search", { embeddingDimension: queryEmbedding.length });

          // Use raw SQL for vector similarity search
          const vectorResults = await prisma.$queryRaw`
            SELECT id, subject, summary, "summaryShort", participants, "lastMessageAt", category
            FROM "Thread"
            WHERE "userId" = ${session.user.id}
              AND embedding IS NOT NULL
            ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
            LIMIT 5
          ` as any[];

          console.log("[Chat API] Vector search completed", { results: vectorResults.length });

          // Merge with text results, avoiding duplicates
          const existingIds = new Set(relevantThreads.map((t) => t.id));
          for (const result of vectorResults) {
            if (!existingIds.has(result.id)) {
              relevantThreads.push(result);
            }
          }
        } catch (vectorError: any) {
          console.warn("[Chat API] Vector search query failed:", {
            error: vectorError.message,
            code: vectorError.code,
          });
          // Continue with text search only
        }
      } else {
        console.log("[Chat API] Skipping vector search - embeddings not available for this provider");
      }
    } catch (embeddingError: any) {
      // Embeddings are optional - continue with text search only
      console.warn("[Chat API] Embedding generation failed, using text search only:", {
        error: embeddingError.message,
      });
    }

    console.log("[Chat API] Search completed", {
      totalThreads: relevantThreads.length,
      totalMessages: relevantMessages.length,
    });

    // Get or create chat session
    let chatSession;
    try {
      if (sessionId) {
        chatSession = await prisma.chatSession.findFirst({
          where: { id: sessionId, userId: session.user.id },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 10,
            },
          },
        });
        console.log("[Chat API] Found existing chat session", { sessionId });
      }

      if (!chatSession) {
        chatSession = await prisma.chatSession.create({
          data: {
            userId: session.user.id,
            title: message.slice(0, 50),
          },
          include: { messages: true },
        });
        console.log("[Chat API] Created new chat session", { sessionId: chatSession.id });
      }
    } catch (sessionError: any) {
      console.error("[Chat API] Failed to get/create chat session:", {
        error: sessionError.message,
        stack: sessionError.stack,
      });
      throw new Error(`Failed to manage chat session: ${sessionError.message}`);
    }

    // Save user message
    try {
      await prisma.chatMessage.create({
        data: {
          sessionId: chatSession.id,
          role: "USER",
          content: message,
        },
      });
      console.log("[Chat API] Saved user message");
    } catch (saveError: any) {
      console.error("[Chat API] Failed to save user message:", {
        error: saveError.message,
      });
      // Continue - not critical
    }

    // Get chat history
    const chatHistory = chatSession.messages
      .reverse()
      .map((m) => ({
        role: m.role.toLowerCase() as "user" | "assistant",
        content: m.content,
      }));

    // Generate response
    let response;
    try {
      console.log("[Chat API] Calling LLM with context", {
        provider: llmConfig.provider,
        threadsCount: relevantThreads.length,
        messagesCount: relevantMessages.length,
        historyLength: chatHistory.length,
        hasStats: !!emailStats,
      });

      response = await chatWithContext(llmConfig, message, {
        relevantThreads: relevantThreads.slice(0, 10).map((t) => ({
          threadId: t.id,
          subject: t.subject || "(No subject)",
          summary: t.summary || t.summaryShort || "",
          participants: t.participants || [],
          lastMessageAt: t.lastMessageAt?.toISOString() || "",
        })),
        relevantMessages: relevantMessages.slice(0, 10).map((m) => ({
          messageId: m.id,
          threadId: m.threadId || "",
          from: m.fromAddress,
          snippet: m.snippet || "",
          date: m.date.toISOString(),
        })),
        chatHistory,
        emailStats: emailStats || undefined,
      });

      console.log("[Chat API] LLM response received", {
        answerLength: response?.answer?.length ?? 0,
        citationsCount: response?.citations?.length ?? 0,
        actionsCount: response?.suggestedActions?.length ?? 0,
        hasResponse: !!response,
      });

      // Validate response structure
      if (!response || !response.answer) {
        throw new Error("Invalid response from LLM: missing answer field");
      }
    } catch (llmError: any) {
      console.error("[Chat API] LLM call failed:", {
        error: llmError.message,
        stack: llmError.stack,
        provider: llmConfig.provider,
        errorType: llmError.name,
        errorString: String(llmError),
      });

      // Provide user-friendly error message
      let userMessage = "Failed to generate response";
      const errorMsg = llmError.message || String(llmError);
      
      if (errorMsg.includes("400") || errorMsg.includes("Bad Request")) {
        userMessage = "Invalid API request. Please check your API key and model settings.";
      } else if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
        userMessage = "Invalid API key. Please check your API key in Settings.";
      } else if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
        userMessage = "Rate limit exceeded. Please try again in a moment.";
      } else if (errorMsg.includes("quota") || errorMsg.includes("billing")) {
        userMessage = "API quota exceeded. Please check your provider billing.";
      } else if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
        userMessage = "Request timed out. Please try again.";
      } else if (errorMsg.includes("JSON") || errorMsg.includes("parse")) {
        userMessage = "Failed to parse LLM response. The model may have returned invalid JSON. Please try again.";
      } else if (errorMsg.includes("No response")) {
        userMessage = "The LLM provider did not return a response. Please check your API key and try again.";
      } else if (errorMsg) {
        // Don't expose full error to user, but log it
        userMessage = "Failed to generate response. Please try again or check your API key settings.";
      }

      // If we have stats but LLM failed, return a basic response with stats
      if (emailStats && wantsStats) {
        const statsAnswer = `Based on your email statistics:
- Total threads: ${emailStats.totalThreads}
- Total messages: ${emailStats.totalMessages}
- Unread threads: ${emailStats.unreadThreads}
- Threads needing reply: ${emailStats.needsReplyCount}
- Rejection emails: ${emailStats.rejectionCount}
- Offer/positive emails: ${emailStats.offerCount}

Category breakdown:
${emailStats.categoryBreakdown.map(c => `- ${c.category}: ${c.count}`).join("\n")}

${emailStats.topSenders.length > 0 ? `Top senders:\n${emailStats.topSenders.slice(0, 5).map(s => `- ${s.email}: ${s.count} emails`).join("\n")}` : ""}

Note: I encountered an issue generating a detailed response, but here are your email statistics.`;

        return NextResponse.json({
          sessionId: chatSession.id,
          answer: statsAnswer,
          citations: [],
          suggestedActions: [],
          warning: userMessage,
        });
      }

      throw new Error(userMessage);
    }

    // Save assistant message
    try {
      await prisma.chatMessage.create({
        data: {
          sessionId: chatSession.id,
          role: "ASSISTANT",
          content: response.answer,
          citations: response.citations as any,
          suggestedActions: response.suggestedActions as any,
        },
      });
      console.log("[Chat API] Saved assistant message");
    } catch (saveError: any) {
      console.error("[Chat API] Failed to save assistant message:", {
        error: saveError.message,
      });
      // Continue - the response is still valid
    }

    console.log("[Chat API] Request completed successfully");

    return NextResponse.json({
      sessionId: chatSession.id,
      answer: response.answer,
      citations: response.citations,
      suggestedActions: response.suggestedActions,
    });
  } catch (error: any) {
    console.error("[Chat API] Error processing request:", {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause,
      userId: session?.user?.id,
    });
    
    // Provide more specific error messages
    let errorMessage = "Failed to process chat message";
    if (error.message?.includes("API key")) {
      errorMessage = "Invalid API key. Please check your API key in Settings.";
    } else if (error.message?.includes("rate limit") || error.message?.includes("429")) {
      errorMessage = "Rate limit exceeded. Please try again in a moment.";
    } else if (error.message?.includes("quota") || error.message?.includes("billing")) {
      errorMessage = "API quota exceeded. Please check your provider billing.";
    } else if (error.message?.includes("embedding") || error.message?.includes("vector")) {
      errorMessage = "Search feature temporarily unavailable. Please try again.";
    } else if (error.message?.includes("chat session")) {
      errorMessage = "Failed to manage chat session. Please try again.";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { 
        error: errorMessage, 
        details: process.env.NODE_ENV === "development" ? {
          message: error.message,
          stack: error.stack?.split('\n').slice(0, 3).join('\n'),
        } : undefined 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      const chatSession = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId: session.user.id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!chatSession) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }

      return NextResponse.json(chatSession);
    }

    // List all chat sessions
    const sessions = await prisma.chatSession.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Failed to get chat sessions:", error);
    return NextResponse.json(
      { error: "Failed to get chat sessions" },
      { status: 500 }
    );
  }
}

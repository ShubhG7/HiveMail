import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLLMConfig, chatWithContext, generateEmbedding } from "@/lib/llm";
import { parseSearchQuery } from "@/lib/utils";

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

    const llmConfig = await getLLMConfig(session.user.id);
    
    if (!llmConfig) {
      return NextResponse.json(
        { error: "LLM API key not configured. Please add your API key in Settings." },
        { status: 400 }
      );
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
    let relevantThreads: any[] = [];
    let relevantMessages: any[] = [];

    // Text search
    if (searchText) {
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
    }

    // Vector search (if we have embeddings)
    try {
      const queryEmbedding = await generateEmbedding(llmConfig, message);
      
      // Use raw SQL for vector similarity search
      const vectorResults = await prisma.$queryRaw`
        SELECT id, subject, summary, "summaryShort", participants, "lastMessageAt", category
        FROM "Thread"
        WHERE "userId" = ${session.user.id}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
        LIMIT 5
      ` as any[];

      // Merge with text results, avoiding duplicates
      const existingIds = new Set(relevantThreads.map((t) => t.id));
      for (const result of vectorResults) {
        if (!existingIds.has(result.id)) {
          relevantThreads.push(result);
        }
      }
    } catch (embeddingError) {
      console.warn("Vector search failed, using text search only:", embeddingError);
    }

    // Get or create chat session
    let chatSession;
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
    }

    if (!chatSession) {
      chatSession = await prisma.chatSession.create({
        data: {
          userId: session.user.id,
          title: message.slice(0, 50),
        },
        include: { messages: true },
      });
    }

    // Save user message
    await prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "USER",
        content: message,
      },
    });

    // Get chat history
    const chatHistory = chatSession.messages
      .reverse()
      .map((m) => ({
        role: m.role.toLowerCase() as "user" | "assistant",
        content: m.content,
      }));

    // Generate response
    const response = await chatWithContext(llmConfig, message, {
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
    });

    // Save assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "ASSISTANT",
        content: response.answer,
        citations: response.citations as any,
        suggestedActions: response.suggestedActions as any,
      },
    });

    return NextResponse.json({
      sessionId: chatSession.id,
      answer: response.answer,
      citations: response.citations,
      suggestedActions: response.suggestedActions,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Failed to process chat message" },
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

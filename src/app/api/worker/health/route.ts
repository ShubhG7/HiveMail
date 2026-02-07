import { NextResponse } from "next/server";

export async function GET() {
  const workerUrl = process.env.WORKER_BASE_URL;

  if (!workerUrl) {
    return NextResponse.json({
      healthy: false,
      error: "WORKER_BASE_URL not configured",
      url: null,
    });
  }

  try {
    const response = await fetch(`${workerUrl}/health`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // Add timeout
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        healthy: true,
        timestamp: data.timestamp,
        url: workerUrl,
      });
    } else {
      return NextResponse.json({
        healthy: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        url: workerUrl,
      });
    }
  } catch (error: any) {
    return NextResponse.json({
      healthy: false,
      error: error.message || "Failed to connect to worker",
      url: workerUrl,
    });
  }
}

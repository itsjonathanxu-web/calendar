import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const rows = await db.chatMessage.findMany({
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return NextResponse.json({
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      proposals: r.toolCalls ? JSON.parse(r.toolCalls) : [],
      createdAt: r.createdAt,
    })),
  });
}

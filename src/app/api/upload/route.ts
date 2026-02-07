import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

// Max file size: 25MB (Gmail's limit)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Allowed MIME types for email attachments
const ALLOWED_TYPES = new Set([
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "text/html",
  "application/rtf",
  
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  
  // Archives
  "application/zip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/gzip",
  
  // Code/Data
  "application/json",
  "application/xml",
  "text/xml",
  
  // Audio/Video
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm",
]);

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  base64?: string; // For small files, include base64 for direct attachment
}

export async function POST(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    
    if (!files.length) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    const uploadedFiles: UploadedFile[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File too large (max 25MB)`);
        continue;
      }

      // Validate file type
      if (!ALLOWED_TYPES.has(file.type)) {
        errors.push(`${file.name}: File type not allowed`);
        continue;
      }

      // Generate unique ID and path
      const fileId = randomUUID();
      const extension = file.name.split(".").pop() || "bin";
      const filename = `${fileId}.${extension}`;
      
      // Create temp directory for uploads
      const uploadDir = join(process.cwd(), "tmp", "uploads", session.user.id);
      await mkdir(uploadDir, { recursive: true });
      
      const filePath = join(uploadDir, filename);
      
      // Read file content
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      
      // Save file
      await writeFile(filePath, buffer);
      
      // For small files (< 5MB), include base64 for direct attachment
      const base64 = file.size < 5 * 1024 * 1024 
        ? buffer.toString("base64")
        : undefined;

      uploadedFiles.push({
        id: fileId,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        path: filePath,
        base64,
      });
    }

    return NextResponse.json({
      files: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error: any) {
    console.error("[Upload API] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload files" },
      { status: 500 }
    );
  }
}

// Delete uploaded files (cleanup)
export async function DELETE(request: NextRequest) {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { fileIds } = await request.json();
    
    if (!fileIds || !Array.isArray(fileIds)) {
      return NextResponse.json(
        { error: "File IDs required" },
        { status: 400 }
      );
    }

    const { unlink } = await import("fs/promises");
    const uploadDir = join(process.cwd(), "tmp", "uploads", session.user.id);

    for (const fileId of fileIds) {
      // Find and delete files matching this ID
      try {
        const { readdir } = await import("fs/promises");
        const files = await readdir(uploadDir);
        
        for (const file of files) {
          if (file.startsWith(fileId)) {
            await unlink(join(uploadDir, file));
          }
        }
      } catch {
        // Ignore errors for individual file deletions
      }
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[Upload API] Delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete files" },
      { status: 500 }
    );
  }
}

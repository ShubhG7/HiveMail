"""Database utilities for the worker."""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
from typing import Generator, Any, Optional
import json

from config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@contextmanager
def get_db() -> Generator[Session, None, None]:
    """Get a database session."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_user_oauth_token(db: Session, user_id: str) -> Optional[dict]:
    """Get OAuth token for a user."""
    result = db.execute(
        text("""
            SELECT "accessTokenEnc", "refreshTokenEnc", expiry, scope, "historyId"
            FROM "OAuthToken"
            WHERE "userId" = :user_id AND provider = 'google'
        """),
        {"user_id": user_id}
    ).fetchone()
    
    if not result:
        return None
    
    return {
        "access_token_enc": result[0],
        "refresh_token_enc": result[1],
        "expiry": result[2],
        "scope": result[3],
        "history_id": result[4],
    }


def update_user_history_id(db: Session, user_id: str, history_id: str):
    """Update the history ID for a user."""
    db.execute(
        text("""
            UPDATE "OAuthToken"
            SET "historyId" = :history_id, "updatedAt" = NOW()
            WHERE "userId" = :user_id AND provider = 'google'
        """),
        {"user_id": user_id, "history_id": history_id}
    )


def get_user_settings(db: Session, user_id: str) -> Optional[dict]:
    """Get settings for a user."""
    result = db.execute(
        text("""
            SELECT "llmProvider", "llmApiKeyEnc", "redactionMode", 
                   "includeLabels", "excludeLabels", "backfillDays"
            FROM "UserSettings"
            WHERE "userId" = :user_id
        """),
        {"user_id": user_id}
    ).fetchone()
    
    if not result:
        return None
    
    return {
        "llm_provider": result[0],
        "llm_api_key_enc": result[1],
        "redaction_mode": result[2],
        "include_labels": result[3],
        "exclude_labels": result[4],
        "backfill_days": result[5],
    }


def upsert_thread(db: Session, user_id: str, thread_data: dict):
    """Upsert a thread."""
    db.execute(
        text("""
            INSERT INTO "Thread" (
                id, "userId", "gmailThreadId", subject, participants,
                "lastMessageAt", category, priority, summary, "summaryShort",
                "needsReply", "isRead", "isStarred", labels, "messageCount",
                "createdAt", "updatedAt", "processedAt"
            ) VALUES (
                gen_random_uuid(), :user_id, :gmail_thread_id, :subject, :participants,
                :last_message_at, :category, :priority, :summary, :summary_short,
                :needs_reply, :is_read, :is_starred, :labels, :message_count,
                NOW(), NOW(), NOW()
            )
            ON CONFLICT ("userId", "gmailThreadId") DO UPDATE SET
                subject = EXCLUDED.subject,
                participants = EXCLUDED.participants,
                "lastMessageAt" = EXCLUDED."lastMessageAt",
                category = EXCLUDED.category,
                priority = EXCLUDED.priority,
                summary = EXCLUDED.summary,
                "summaryShort" = EXCLUDED."summaryShort",
                "needsReply" = EXCLUDED."needsReply",
                labels = EXCLUDED.labels,
                "messageCount" = EXCLUDED."messageCount",
                "updatedAt" = NOW(),
                "processedAt" = NOW()
            RETURNING id
        """),
        {
            "user_id": user_id,
            "gmail_thread_id": thread_data["gmail_thread_id"],
            "subject": thread_data.get("subject"),
            "participants": thread_data.get("participants", []),
            "last_message_at": thread_data.get("last_message_at"),
            "category": thread_data.get("category", "misc"),
            "priority": thread_data.get("priority", "NORMAL"),
            "summary": thread_data.get("summary"),
            "summary_short": thread_data.get("summary_short"),
            "needs_reply": thread_data.get("needs_reply", False),
            "is_read": thread_data.get("is_read", True),
            "is_starred": thread_data.get("is_starred", False),
            "labels": thread_data.get("labels", []),
            "message_count": thread_data.get("message_count", 0),
        }
    )


def upsert_message(db: Session, user_id: str, message_data: dict):
    """Upsert a message."""
    db.execute(
        text("""
            INSERT INTO "Message" (
                id, "userId", "gmailMessageId", "gmailThreadId", "threadId",
                "fromAddress", "fromName", "toAddresses", "ccAddresses", "bccAddresses",
                date, subject, snippet, "bodyTextEnc", "bodyHtmlEnc", "bodyHash",
                labels, category, "spamScore", "sensitiveFlags", extracted,
                "isRead", "isStarred", "hasAttachments", attachments,
                "createdAt", "updatedAt", "processedAt"
            ) VALUES (
                gen_random_uuid(), :user_id, :gmail_message_id, :gmail_thread_id, 
                (SELECT id FROM "Thread" WHERE "userId" = :user_id AND "gmailThreadId" = :gmail_thread_id),
                :from_address, :from_name, :to_addresses, :cc_addresses, :bcc_addresses,
                :date, :subject, :snippet, :body_text_enc, :body_html_enc, :body_hash,
                :labels, :category, :spam_score, :sensitive_flags, :extracted,
                :is_read, :is_starred, :has_attachments, :attachments,
                NOW(), NOW(), NOW()
            )
            ON CONFLICT ("userId", "gmailMessageId") DO UPDATE SET
                "fromAddress" = EXCLUDED."fromAddress",
                "fromName" = EXCLUDED."fromName",
                "toAddresses" = EXCLUDED."toAddresses",
                "ccAddresses" = EXCLUDED."ccAddresses",
                labels = EXCLUDED.labels,
                category = EXCLUDED.category,
                "spamScore" = EXCLUDED."spamScore",
                "sensitiveFlags" = EXCLUDED."sensitiveFlags",
                extracted = EXCLUDED.extracted,
                "updatedAt" = NOW(),
                "processedAt" = NOW()
        """),
        {
            "user_id": user_id,
            "gmail_message_id": message_data["gmail_message_id"],
            "gmail_thread_id": message_data["gmail_thread_id"],
            "from_address": message_data["from_address"],
            "from_name": message_data.get("from_name"),
            "to_addresses": message_data.get("to_addresses", []),
            "cc_addresses": message_data.get("cc_addresses", []),
            "bcc_addresses": message_data.get("bcc_addresses", []),
            "date": message_data["date"],
            "subject": message_data.get("subject"),
            "snippet": message_data.get("snippet"),
            "body_text_enc": message_data.get("body_text_enc"),
            "body_html_enc": message_data.get("body_html_enc"),
            "body_hash": message_data.get("body_hash"),
            "labels": message_data.get("labels", []),
            "category": message_data.get("category", "misc"),
            "spam_score": message_data.get("spam_score", 0),
            "sensitive_flags": message_data.get("sensitive_flags", []),
            "extracted": json.dumps(message_data.get("extracted")) if message_data.get("extracted") else None,
            "is_read": message_data.get("is_read", False),
            "is_starred": message_data.get("is_starred", False),
            "has_attachments": message_data.get("has_attachments", False),
            "attachments": json.dumps(message_data.get("attachments")) if message_data.get("attachments") else None,
        }
    )


def update_job_status(
    db: Session, 
    job_id: str, 
    status: str,
    progress: Optional[int] = None,
    total_items: Optional[int] = None,
    error: Optional[str] = None
):
    """Update job status."""
    updates = ["status = :status", '"updatedAt" = NOW()']
    params = {"job_id": job_id, "status": status}
    
    if status == "RUNNING":
        updates.append('"startedAt" = NOW()')
    elif status in ["COMPLETED", "FAILED", "CANCELLED"]:
        updates.append('"completedAt" = NOW()')
    
    if progress is not None:
        updates.append("progress = :progress")
        params["progress"] = progress
    
    if total_items is not None:
        updates.append('"totalItems" = :total_items')
        params["total_items"] = total_items
    
    if error is not None:
        updates.append("error = :error")
        params["error"] = error
    
    db.execute(
        text(f'UPDATE "SyncJob" SET {", ".join(updates)} WHERE id = :job_id'),
        params
    )


def log_processing(
    db: Session,
    user_id: str,
    job_id: Optional[str],
    correlation_id: Optional[str],
    level: str,
    message: str,
    metadata: Optional[dict] = None
):
    """Log a processing event."""
    db.execute(
        text("""
            INSERT INTO "ProcessingLog" (
                id, "userId", "jobId", "correlationId", level, message, metadata, "createdAt"
            ) VALUES (
                gen_random_uuid(), :user_id, :job_id, :correlation_id, :level, :message, :metadata, NOW()
            )
        """),
        {
            "user_id": user_id,
            "job_id": job_id,
            "correlation_id": correlation_id,
            "level": level,
            "message": message,
            "metadata": json.dumps(metadata) if metadata else None,
        }
    )


def update_thread_embedding(db: Session, thread_id: str, embedding: list[float]):
    """Update thread embedding."""
    db.execute(
        text("""
            UPDATE "Thread"
            SET embedding = :embedding::vector
            WHERE id = :thread_id
        """),
        {"thread_id": thread_id, "embedding": str(embedding)}
    )

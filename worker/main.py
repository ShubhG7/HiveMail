"""Worker main entry point with FastAPI."""

import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import text
import structlog

import structlog
from dotenv import load_dotenv
import os

# Load env variables from .env file in the same directory
env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(env_path):
    load_dotenv(env_path)

from config import get_settings
from db import (
    get_db, get_user_oauth_token, get_user_settings,
    update_user_history_id, update_job_status, log_processing,
    compute_and_store_email_stats
)
from gmail_client import (
    get_gmail_service_from_encrypted, fetch_message_ids_for_backfill,
    fetch_history_changes, fetch_message, parse_message, get_gmail_profile
)
from pipeline import message_processing_graph, thread_processing_graph
from fastapi.middleware.cors import CORSMiddleware

settings = get_settings()
logger = structlog.get_logger()

app = FastAPI(title="Hivemail Worker", version="1.0.0")

# CORS middleware for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobPayload(BaseModel):
    """Payload for a sync job."""
    userId: str
    jobType: str  # BACKFILL, INCREMENTAL, PROCESS_THREAD, PROCESS_MESSAGE
    correlationId: str
    metadata: Optional[Dict[str, Any]] = None


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ===== ANALYTICS ENDPOINTS =====

class AnalyticsRequest(BaseModel):
    """Request for analytics queries."""
    userId: str


@app.get("/api/analytics/stats")
async def get_analytics_stats(userId: str):
    """
    Get comprehensive email statistics using DuckDB.
    
    Falls back to PostgreSQL if DuckDB is unavailable.
    """
    try:
        from analytics import get_email_stats_fast, export_email_metadata_to_parquet
        
        # Export to Parquet (cached if recent)
        export_email_metadata_to_parquet(userId, force_refresh=False)
        
        # Get fast stats
        stats = get_email_stats_fast(userId)
        
        # Also get thread-level stats from PostgreSQL (not in Parquet yet)
        with get_db() as db:
            thread_count = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id'),
                {"user_id": userId}
            ).scalar() or 0
            
            unread_threads = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id AND "isRead" = false'),
                {"user_id": userId}
            ).scalar() or 0
            
            needs_reply_count = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id AND "needsReply" = true'),
                {"user_id": userId}
            ).scalar() or 0
            
            starred_count = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id AND "isStarred" = true'),
                {"user_id": userId}
            ).scalar() or 0
        
        return {
            "totalThreads": thread_count,
            "totalMessages": stats["total_messages"],
            "unreadThreads": unread_threads,
            "needsReplyCount": needs_reply_count,
            "starredCount": starred_count,
            "categoryBreakdown": stats["category_breakdown"],
            "topSenders": stats["top_senders"],
            "monthlyCounts": stats["monthly_counts"],
            "messagesWithAttachments": stats["messages_with_attachments"],
            "avgSpamScore": stats["avg_spam_score"],
        }
    except ImportError:
        # DuckDB not available, return error
        raise HTTPException(
            status_code=503,
            detail="DuckDB analytics not available. Please install duckdb and pyarrow."
        )
    except Exception as e:
        logger.error("analytics_stats_failed", user_id=userId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get analytics: {str(e)}")


@app.get("/api/analytics/temporal")
async def get_temporal_analytics(
    userId: str,
    period: str = "month",  # day, week, or month
    startDate: Optional[str] = None,
    endDate: Optional[str] = None
):
    """
    Get temporal analytics (email counts over time).
    
    Args:
        userId: User ID
        period: 'day', 'week', or 'month'
        startDate: Optional start date (YYYY-MM-DD)
        endDate: Optional end date (YYYY-MM-DD)
    """
    try:
        from analytics import get_temporal_analytics
        from datetime import date as date_type
        
        start = date_type.fromisoformat(startDate) if startDate else None
        end = date_type.fromisoformat(endDate) if endDate else None
        
        results = get_temporal_analytics(userId, period=period, start_date=start, end_date=end)
        return {"period": period, "data": results}
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="DuckDB analytics not available"
        )
    except Exception as e:
        logger.error("temporal_analytics_failed", user_id=userId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get temporal analytics: {str(e)}")


@app.get("/api/analytics/senders")
async def get_sender_analytics(
    userId: str,
    senderEmail: Optional[str] = None,
    limit: int = 50
):
    """
    Get sender analytics.
    
    Args:
        userId: User ID
        senderEmail: Optional specific sender email
        limit: Max number of results (default 50)
    """
    try:
        from analytics import get_sender_analytics
        
        results = get_sender_analytics(userId, sender_email=senderEmail)
        if limit and not senderEmail:
            results = results[:limit]
        
        return {"senders": results}
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="DuckDB analytics not available"
        )
    except Exception as e:
        logger.error("sender_analytics_failed", user_id=userId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get sender analytics: {str(e)}")


@app.get("/api/analytics/dashboard")
async def get_dashboard_analytics(userId: str):
    """
    Get optimized dashboard data using DuckDB.
    
    Returns all data needed for the dashboard in a single call.
    """
    try:
        from analytics import (
            get_email_stats_fast, get_temporal_analytics,
            export_email_metadata_to_parquet
        )
        from datetime import date, timedelta
        
        # Export to Parquet
        export_email_metadata_to_parquet(userId, force_refresh=False)
        
        # Get fast stats
        stats = get_email_stats_fast(userId)
        
        # Get 7-day trend
        end_date = date.today()
        start_date = end_date - timedelta(days=7)
        daily_trend = get_temporal_analytics(
            userId, period="day", start_date=start_date, end_date=end_date
        )
        
        # Get thread-level stats from PostgreSQL
        with get_db() as db:
            thread_count = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id'),
                {"user_id": userId}
            ).scalar() or 0
            
            unread_threads = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id AND "isRead" = false'),
                {"user_id": userId}
            ).scalar() or 0
            
            needs_reply_count = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id AND "needsReply" = true'),
                {"user_id": userId}
            ).scalar() or 0
            
            starred_count = db.execute(
                text('SELECT COUNT(*) FROM "Thread" WHERE "userId" = :user_id AND "isStarred" = true'),
                {"user_id": userId}
            ).scalar() or 0
            
            # Get recent important threads (still need PostgreSQL for this)
            recent_important = db.execute(
                text("""
                    SELECT id, subject, "summaryShort", category, priority, "needsReply", "lastMessageAt", participants
                    FROM "Thread"
                    WHERE "userId" = :user_id
                    AND (priority IN ('HIGH', 'URGENT') OR "needsReply" = true)
                    ORDER BY "lastMessageAt" DESC
                    LIMIT 5
                """),
                {"user_id": userId}
            ).fetchall()
            
            # Get upcoming deadlines
            upcoming_deadlines = db.execute(
                text("""
                    SELECT t.id, t.title, t."dueAt", t.priority, th.subject as thread_subject
                    FROM "Task" t
                    LEFT JOIN "Thread" th ON t."threadId" = th.id
                    WHERE t."userId" = :user_id
                    AND t.status != 'COMPLETED'
                    AND t."dueAt" >= CURRENT_DATE
                    AND t."dueAt" <= CURRENT_DATE + INTERVAL '7 days'
                    ORDER BY t."dueAt" ASC
                    LIMIT 5
                """),
                {"user_id": userId}
            ).fetchall()
        
        # Format results
        category_distribution = [
            {"category": cat, "count": count}
            for cat, count in stats["category_breakdown"].items()
        ]
        
        trend_7_days = [
            {
                "date": item["period"],
                "count": item["message_count"]
            }
            for item in daily_trend
        ]
        
        top_senders = [
            {"email": sender["email"], "count": sender["count"]}
            for sender in stats["top_senders"]
        ]
        
        recent_important_formatted = [
            {
                "id": row[0],
                "subject": row[1],
                "summaryShort": row[2],
                "category": row[3],
                "priority": row[4],
                "needsReply": row[5],
                "lastMessageAt": row[6].isoformat() if row[6] else None,
                "participants": row[7] if row[7] else [],
            }
            for row in recent_important
        ]
        
        upcoming_deadlines_formatted = [
            {
                "id": row[0],
                "title": row[1],
                "dueAt": row[2].isoformat() if row[2] else None,
                "priority": row[3],
                "threadSubject": row[4],
            }
            for row in upcoming_deadlines
        ]
        
        return {
            "summary": {
                "totalThreads": thread_count,
                "totalMessages": stats["total_messages"],
                "unreadCount": unread_threads,
                "needsReplyCount": needs_reply_count,
                "starredCount": starred_count,
            },
            "categoryDistribution": category_distribution,
            "trend7Days": trend_7_days,
            "topSenders": top_senders,
            "recentImportant": recent_important_formatted,
            "upcomingDeadlines": upcoming_deadlines_formatted,
        }
    except ImportError:
        # DuckDB not available
        raise HTTPException(
            status_code=503,
            detail="DuckDB analytics not available. Falling back to PostgreSQL."
        )
    except Exception as e:
        logger.error("dashboard_analytics_failed", user_id=userId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get dashboard analytics: {str(e)}")


@app.post("/api/jobs")
async def handle_job(
    payload: JobPayload,
    x_correlation_id: Optional[str] = Header(None)
):
    """Handle a sync job."""
    correlation_id = x_correlation_id or payload.correlationId
    
    logger.info(
        "job_received",
        user_id=payload.userId,
        job_type=payload.jobType,
        correlation_id=correlation_id,
    )
    
    try:
        if payload.jobType == "BACKFILL":
            await process_backfill_job(payload.userId, payload.metadata, correlation_id)
        elif payload.jobType == "INCREMENTAL":
            await process_incremental_job(payload.userId, payload.metadata, correlation_id)
        elif payload.jobType == "PROCESS_THREAD":
            await process_thread_job(payload.userId, payload.metadata, correlation_id)
        elif payload.jobType == "PROCESS_MESSAGE":
            await process_message_job(payload.userId, payload.metadata, correlation_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown job type: {payload.jobType}")
        
        return {"status": "completed", "correlationId": correlation_id}
    
    except Exception as e:
        error_message = str(e)
        error_traceback = None
        try:
            import traceback
            error_traceback = traceback.format_exc()
        except:
            pass
        
        logger.error(
            "job_failed",
            user_id=payload.userId,
            job_type=payload.jobType,
            correlation_id=correlation_id,
            error=error_message,
            traceback=error_traceback,
        )
        
        # Update job status to failed
        job_id = payload.metadata.get("jobId") if payload.metadata else None
        if job_id:
            try:
                with get_db() as db:
                    update_job_status(db, job_id, "FAILED", error=error_message)
            except Exception as db_error:
                logger.error("failed_to_update_job_status", job_id=job_id, error=str(db_error))
        
        # Return error response instead of raising to avoid double logging
        return {
            "status": "failed",
            "correlationId": correlation_id,
            "error": error_message
        }


async def process_backfill_job(
    user_id: str,
    metadata: Optional[Dict[str, Any]],
    correlation_id: str
):
    """Process a backfill sync job."""
    job_id = metadata.get("jobId") if metadata else None
    backfill_days = metadata.get("backfillDays", 30) if metadata else 30
    exclude_labels = metadata.get("excludeLabels", ["SPAM", "TRASH"]) if metadata else ["SPAM", "TRASH"]
    
    with get_db() as db:
        # Get user tokens and settings
        oauth_token = get_user_oauth_token(db, user_id)
        user_settings = get_user_settings(db, user_id)
        
        if not oauth_token:
            raise Exception("No OAuth token found for user")
        
        if job_id:
            update_job_status(db, job_id, "RUNNING")
        
        log_processing(
            db, user_id, job_id, correlation_id,
            "info", f"Starting backfill for {backfill_days} days",
            {"backfill_days": backfill_days, "exclude_labels": exclude_labels}
        )
    
    # Get Gmail service
    gmail_service = get_gmail_service_from_encrypted(
        oauth_token["access_token_enc"],
        oauth_token["refresh_token_enc"]
    )
    
    # Fetch message IDs
    after_date = datetime.utcnow() - timedelta(days=backfill_days)
    message_ids = fetch_message_ids_for_backfill(
        gmail_service,
        after_date,
        exclude_labels=exclude_labels,
        max_results=5000,  # Limit for initial sync
    )
    
    total_messages = len(message_ids)
    logger.info("backfill_messages_found", user_id=user_id, count=total_messages)
    
    if job_id:
        with get_db() as db:
            update_job_status(db, job_id, "RUNNING", total_items=total_messages)
    
    # Process messages in batches
    processed = 0
    threads_to_process = set()
    
    for message_id in message_ids:
        try:
            # Run message processing pipeline
            initial_state = {
                "user_id": user_id,
                "job_id": job_id,
                "correlation_id": correlation_id,
                "llm_api_key_enc": user_settings.get("llm_api_key_enc") if user_settings else None,
                "llm_provider": user_settings.get("llm_provider", "gemini-2.5-flash") if user_settings else "gemini-2.5-flash",
                "llm_base_url": user_settings.get("llm_base_url") if user_settings else None,
                "llm_model": user_settings.get("llm_model") if user_settings else None,
                "redaction_mode": user_settings.get("redaction_mode", "OFF") if user_settings else "OFF",
                "gmail_service": gmail_service,
                "message_id": message_id,
                "raw_message": None,
                "parsed_message": None,
                "classification": None,
                "extraction": None,
                "sensitive_flags": [],
                "processed": False,
                "error": None,
            }
            
            result = message_processing_graph.invoke(initial_state)
            
            if result.get("processed"):
                processed += 1
                # Track thread for later processing
                if result.get("parsed_message", {}).get("gmail_thread_id"):
                    threads_to_process.add(result["parsed_message"]["gmail_thread_id"])
            
            # Update progress periodically
            if processed % 50 == 0 and job_id:
                with get_db() as db:
                    update_job_status(db, job_id, "RUNNING", progress=processed)
                    logger.info("backfill_progress", user_id=user_id, processed=processed, total=total_messages)
            
            # Log failure if not processed
            if not result.get("processed"):
                error_msg = result.get("error", "Unknown error")
                logger.warning("message_processing_failed", user_id=user_id, message_id=message_id, error=error_msg)
                if job_id:
                    with get_db() as db:
                        log_processing(
                            db, user_id, job_id, correlation_id,
                            "error", f"Message processing failed: {error_msg}",
                            {"message_id": message_id}
                        )
        
        except Exception as e:
            logger.warning("message_processing_loop_failed", user_id=user_id, message_id=message_id, error=str(e))
            if job_id:
                with get_db() as db:
                    log_processing(
                        db, user_id, job_id, correlation_id,
                        "error", f"Message processing loop failed: {str(e)}",
                        {"message_id": message_id}
                    )
    
    # Process threads
    logger.info("backfill_processing_threads", user_id=user_id, count=len(threads_to_process))
    
    for gmail_thread_id in threads_to_process:
        await process_single_thread(
            user_id, gmail_thread_id, gmail_service,
            user_settings, job_id, correlation_id
        )
    
    # Update history ID for future incremental syncs
    profile = get_gmail_profile(gmail_service)
    with get_db() as db:
        update_user_history_id(db, user_id, profile["history_id"])
        
        if job_id:
            # Mark as completed with progress = totalItems to ensure 100%
            update_job_status(db, job_id, "COMPLETED", progress=total_messages, total_items=total_messages)
        
        log_processing(
            db, user_id, job_id, correlation_id,
            "info", f"Backfill completed: {processed} messages, {len(threads_to_process)} threads",
            {"processed_messages": processed, "processed_threads": len(threads_to_process)}
        )
        
        # Compute and store email statistics for fast chat queries
        try:
            compute_and_store_email_stats(db, user_id)
            logger.info("email_stats_computed", user_id=user_id)
        except Exception as e:
            logger.warning("email_stats_computation_failed", user_id=user_id, error=str(e))


async def process_incremental_job(
    user_id: str,
    metadata: Optional[Dict[str, Any]],
    correlation_id: str
):
    """Process an incremental sync job."""
    job_id = metadata.get("jobId") if metadata else None
    
    with get_db() as db:
        oauth_token = get_user_oauth_token(db, user_id)
        user_settings = get_user_settings(db, user_id)
        
        if not oauth_token:
            raise Exception("No OAuth token found for user")
        
        history_id = oauth_token.get("history_id")
        
        if not history_id:
            logger.info("no_history_id_falling_back_to_backfill", user_id=user_id)
            # No history ID, do a short backfill to sync recent emails
            # Use 7 days to ensure we get all recent emails
            await process_backfill_job(
                user_id,
                {"jobId": job_id, "backfillDays": 7, "excludeLabels": user_settings.get("excludeLabels", ["SPAM", "TRASH"]) if user_settings else ["SPAM", "TRASH"]},
                correlation_id
            )
            return
        
        if job_id:
            update_job_status(db, job_id, "RUNNING")
    
    # Get Gmail service
    gmail_service = get_gmail_service_from_encrypted(
        oauth_token["access_token_enc"],
        oauth_token["refresh_token_enc"]
    )
    
    # Fetch changes
    changes = fetch_history_changes(gmail_service, history_id)
    message_ids = changes["message_ids"]
    new_history_id = changes["new_history_id"]
    
    # If history_id was too old (404), new_history_id will be None
    # Fall back to backfill to ensure all recent emails are synced
    if new_history_id is None and not message_ids:
        logger.info("history_id_too_old_falling_back_to_backfill", user_id=user_id)
        # History ID too old, do a short backfill to sync recent emails
        await process_backfill_job(
            user_id,
            {"jobId": job_id, "backfillDays": 7, "excludeLabels": user_settings.get("excludeLabels", ["SPAM", "TRASH"]) if user_settings else ["SPAM", "TRASH"]},
            correlation_id
        )
        return
    
    if not message_ids:
        logger.info("incremental_no_changes", user_id=user_id)
        if new_history_id:
            with get_db() as db:
                update_user_history_id(db, user_id, new_history_id)
                if job_id:
                    # Mark as completed with 0/0 to show no new emails
                    update_job_status(db, job_id, "COMPLETED", progress=0, total_items=0)
                    logger.info("incremental_no_changes_completed", user_id=user_id, job_id=job_id)
        return
    
    logger.info("incremental_changes_found", user_id=user_id, count=len(message_ids))
    
    if job_id:
        with get_db() as db:
            update_job_status(db, job_id, "RUNNING", total_items=len(message_ids))
    
    # Process messages
    processed = 0
    failed = 0
    skipped = 0  # Messages that were already processed or duplicates
    threads_to_process = set()
    
    for message_id in message_ids:
        try:
            initial_state = {
                "user_id": user_id,
                "job_id": job_id,
                "correlation_id": correlation_id,
                "llm_api_key_enc": user_settings.get("llm_api_key_enc") if user_settings else None,
                "llm_provider": user_settings.get("llm_provider", "gemini-2.5-flash") if user_settings else "gemini-2.5-flash",
                "llm_base_url": user_settings.get("llm_base_url") if user_settings else None,
                "llm_model": user_settings.get("llm_model") if user_settings else None,
                "redaction_mode": user_settings.get("redaction_mode", "OFF") if user_settings else "OFF",
                "gmail_service": gmail_service,
                "message_id": message_id,
                "raw_message": None,
                "parsed_message": None,
                "classification": None,
                "extraction": None,
                "sensitive_flags": [],
                "processed": False,
                "error": None,
            }
            
            result = message_processing_graph.invoke(initial_state)
            
            if result.get("processed"):
                processed += 1
                if result.get("parsed_message", {}).get("gmail_thread_id"):
                    threads_to_process.add(result["parsed_message"]["gmail_thread_id"])
            else:
                # Message was not processed - could be duplicate, already exists, or failed
                if result.get("error"):
                    failed += 1
                else:
                    skipped += 1  # Likely already exists in DB
            
            # Update progress periodically (every 10 messages for incremental)
            if processed % 10 == 0 and job_id:
                with get_db() as db:
                    current_total = processed + failed
                    update_job_status(db, job_id, "RUNNING", progress=processed, total_items=current_total if current_total > 0 else processed)
                    logger.info("incremental_progress", user_id=user_id, processed=processed, failed=failed, skipped=skipped, total_attempted=current_total)
        
        except Exception as e:
            failed += 1
            logger.warning("message_processing_failed", user_id=user_id, message_id=message_id, error=str(e))
    
    # Update progress to final value before processing threads
    # Use processed count as the total since that's what actually got synced
    if job_id:
        with get_db() as db:
            # Total should be the number of successfully processed messages
            # This ensures progress shows 100% when sync completes
            final_total = processed if processed > 0 else (processed + failed)
            update_job_status(db, job_id, "RUNNING", progress=processed, total_items=final_total)
            logger.info("incremental_final_progress", user_id=user_id, processed=processed, failed=failed, skipped=skipped, total=final_total)
    
    # Process threads (with error handling to prevent blocking completion)
    thread_errors = []
    for gmail_thread_id in threads_to_process:
        try:
            await process_single_thread(
                user_id, gmail_thread_id, gmail_service,
                user_settings, job_id, correlation_id
            )
        except Exception as e:
            logger.warning("thread_processing_failed", user_id=user_id, thread_id=gmail_thread_id, error=str(e))
            thread_errors.append({"thread_id": gmail_thread_id, "error": str(e)})
            # Continue processing other threads even if one fails
    
    # Update history ID and mark job as completed
    # Wrap in try-except to ensure completion happens even if there are errors
    try:
        with get_db() as db:
            if new_history_id:
                update_user_history_id(db, user_id, new_history_id)
            
            if job_id:
                # Mark as completed - use processed count as total since that's what actually got synced
                final_total = processed if processed > 0 else (processed + failed)
                update_job_status(db, job_id, "COMPLETED", progress=processed, total_items=final_total)
                logger.info("incremental_completed", user_id=user_id, processed=processed, failed=failed, skipped=skipped, total=final_total, gmail_total=len(message_ids), threads=len(threads_to_process))
    except Exception as e:
        # Even if there's an error, try to mark the job as completed
        logger.error("error_marking_job_completed", user_id=user_id, job_id=job_id, error=str(e))
        if job_id:
            try:
                with get_db() as db:
                    final_total = processed if processed > 0 else (processed + failed)
                    update_job_status(db, job_id, "COMPLETED", progress=processed, total_items=final_total)
                    db.commit()
            except Exception as db_error:
                logger.error("failed_to_mark_job_completed", job_id=job_id, error=str(db_error))
    
    # Log and compute stats (outside the try-except to ensure it runs)
    with get_db() as db:
        log_processing(
            db, user_id, job_id, correlation_id,
            "info", f"Incremental sync completed: {processed}/{len(message_ids)} messages processed",
            {"processed_messages": processed, "total_messages": len(message_ids), "processed_threads": len(threads_to_process)}
        )
        
        # Compute and store email statistics for fast chat queries
        try:
            compute_and_store_email_stats(db, user_id)
            logger.info("email_stats_computed", user_id=user_id)
        except Exception as e:
            logger.warning("email_stats_computation_failed", user_id=user_id, error=str(e))


async def process_single_thread(
    user_id: str,
    gmail_thread_id: str,
    gmail_service,
    user_settings: Optional[Dict[str, Any]],
    job_id: Optional[str],
    correlation_id: str
):
    """Process a single thread."""
    # Get messages for this thread from the database
    with get_db() as db:
        result = db.execute(
            text("""
            SELECT "gmailMessageId", "fromAddress", date, subject, snippet, "bodyTextEnc", labels
            FROM "Message"
            WHERE "userId" = :user_id AND "gmailThreadId" = :gmail_thread_id
            ORDER BY date ASC
            """),
            {"user_id": user_id, "gmail_thread_id": gmail_thread_id}
        ).fetchall()
        
        if not result:
            return
        
        messages = []
        for row in result:
            from encryption import decrypt
            body_text = decrypt(row[5]) if row[5] else None
            messages.append({
                "gmail_message_id": row[0],
                "from_address": row[1],
                "date": row[2].isoformat() if row[2] else None,
                "subject": row[3],
                "snippet": row[4],
                "body_text": body_text,
                "labels": row[6] or [],
            })
    
    # Run thread processing pipeline
    initial_state = {
        "user_id": user_id,
        "job_id": job_id,
        "correlation_id": correlation_id,
        "llm_api_key_enc": user_settings.get("llm_api_key_enc") if user_settings else None,
        "llm_provider": user_settings.get("llm_provider", "gemini-2.5-flash") if user_settings else "gemini-2.5-flash",
        "llm_base_url": user_settings.get("llm_base_url") if user_settings else None,
        "llm_model": user_settings.get("llm_model") if user_settings else None,
        "gmail_thread_id": gmail_thread_id,
        "messages": messages,
        "summary": None,
        "embedding": None,
        "processed": False,
        "error": None,
    }
    
    thread_processing_graph.invoke(initial_state)


async def process_thread_job(
    user_id: str,
    metadata: Optional[Dict[str, Any]],
    correlation_id: str
):
    """Process a specific thread."""
    if not metadata or "threadId" not in metadata:
        raise Exception("threadId required in metadata")
    
    job_id = metadata.get("jobId")
    gmail_thread_id = metadata["threadId"]
    
    with get_db() as db:
        oauth_token = get_user_oauth_token(db, user_id)
        user_settings = get_user_settings(db, user_id)
        
        if not oauth_token:
            raise Exception("No OAuth token found for user")
        
        if job_id:
            update_job_status(db, job_id, "RUNNING")
    
    gmail_service = get_gmail_service_from_encrypted(
        oauth_token["access_token_enc"],
        oauth_token["refresh_token_enc"]
    )
    
    await process_single_thread(
        user_id, gmail_thread_id, gmail_service,
        user_settings, job_id, correlation_id
    )
    
    if job_id:
        with get_db() as db:
            update_job_status(db, job_id, "COMPLETED")


async def process_message_job(
    user_id: str,
    metadata: Optional[Dict[str, Any]],
    correlation_id: str
):
    """Process a specific message."""
    if not metadata or "messageId" not in metadata:
        raise Exception("messageId required in metadata")
    
    job_id = metadata.get("jobId")
    message_id = metadata["messageId"]
    
    with get_db() as db:
        oauth_token = get_user_oauth_token(db, user_id)
        user_settings = get_user_settings(db, user_id)
        
        if not oauth_token:
            raise Exception("No OAuth token found for user")
        
        if job_id:
            update_job_status(db, job_id, "RUNNING")
    
    gmail_service = get_gmail_service_from_encrypted(
        oauth_token["access_token_enc"],
        oauth_token["refresh_token_enc"]
    )
    
    initial_state = {
        "user_id": user_id,
        "job_id": job_id,
        "correlation_id": correlation_id,
        "llm_api_key_enc": user_settings.get("llm_api_key_enc") if user_settings else None,
        "llm_provider": user_settings.get("llm_provider", "gemini-2.5-flash") if user_settings else "gemini-2.5-flash",
        "redaction_mode": user_settings.get("redaction_mode", "OFF") if user_settings else "OFF",
        "gmail_service": gmail_service,
        "message_id": message_id,
        "raw_message": None,
        "parsed_message": None,
        "classification": None,
        "extraction": None,
        "sensitive_flags": [],
        "processed": False,
        "error": None,
    }
    
    result = message_processing_graph.invoke(initial_state)
    
    if job_id:
        with get_db() as db:
            if result.get("processed"):
                update_job_status(db, job_id, "COMPLETED")
            else:
                update_job_status(db, job_id, "FAILED", error=result.get("error"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

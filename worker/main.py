"""Worker main entry point with FastAPI."""

import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
import structlog

from config import get_settings
from db import (
    get_db, get_user_oauth_token, get_user_settings,
    update_user_history_id, update_job_status, log_processing
)
from gmail_client import (
    get_gmail_service_from_encrypted, fetch_message_ids_for_backfill,
    fetch_history_changes, fetch_message, parse_message, get_gmail_profile
)
from pipeline import message_processing_graph, thread_processing_graph

settings = get_settings()
logger = structlog.get_logger()

app = FastAPI(title="Hivemail Worker", version="1.0.0")


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
        logger.error(
            "job_failed",
            user_id=payload.userId,
            job_type=payload.jobType,
            correlation_id=correlation_id,
            error=str(e),
        )
        
        # Update job status to failed
        job_id = payload.metadata.get("jobId") if payload.metadata else None
        if job_id:
            with get_db() as db:
                update_job_status(db, job_id, "FAILED", error=str(e))
        
        raise HTTPException(status_code=500, detail=str(e))


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
        
        except Exception as e:
            logger.warning("message_processing_failed", user_id=user_id, message_id=message_id, error=str(e))
    
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
            update_job_status(db, job_id, "COMPLETED", progress=processed)
        
        log_processing(
            db, user_id, job_id, correlation_id,
            "info", f"Backfill completed: {processed} messages, {len(threads_to_process)} threads",
            {"processed_messages": processed, "processed_threads": len(threads_to_process)}
        )


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
            # No history ID, do a short backfill instead
            await process_backfill_job(
                user_id,
                {"jobId": job_id, "backfillDays": 7, "excludeLabels": ["SPAM", "TRASH"]},
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
    
    if not message_ids:
        logger.info("incremental_no_changes", user_id=user_id)
        if new_history_id:
            with get_db() as db:
                update_user_history_id(db, user_id, new_history_id)
                if job_id:
                    update_job_status(db, job_id, "COMPLETED", progress=0, total_items=0)
        return
    
    logger.info("incremental_changes_found", user_id=user_id, count=len(message_ids))
    
    if job_id:
        with get_db() as db:
            update_job_status(db, job_id, "RUNNING", total_items=len(message_ids))
    
    # Process messages
    processed = 0
    threads_to_process = set()
    
    for message_id in message_ids:
        try:
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
            
            if result.get("processed"):
                processed += 1
                if result.get("parsed_message", {}).get("gmail_thread_id"):
                    threads_to_process.add(result["parsed_message"]["gmail_thread_id"])
        
        except Exception as e:
            logger.warning("message_processing_failed", user_id=user_id, message_id=message_id, error=str(e))
    
    # Process threads
    for gmail_thread_id in threads_to_process:
        await process_single_thread(
            user_id, gmail_thread_id, gmail_service,
            user_settings, job_id, correlation_id
        )
    
    # Update history ID
    if new_history_id:
        with get_db() as db:
            update_user_history_id(db, user_id, new_history_id)
            
            if job_id:
                update_job_status(db, job_id, "COMPLETED", progress=processed)
            
            log_processing(
                db, user_id, job_id, correlation_id,
                "info", f"Incremental sync completed: {processed} messages",
                {"processed_messages": processed, "processed_threads": len(threads_to_process)}
            )


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
            """
            SELECT "gmailMessageId", "fromAddress", date, subject, snippet, "bodyTextEnc", labels
            FROM "Message"
            WHERE "userId" = %s AND "gmailThreadId" = %s
            ORDER BY date ASC
            """,
            (user_id, gmail_thread_id)
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

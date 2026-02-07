"""LangGraph pipeline for email processing."""

from typing import TypedDict, List, Dict, Any, Optional, Annotated
from datetime import datetime
from langgraph.graph import StateGraph, END
from sqlalchemy import text
import structlog

from db import (
    get_db, get_user_oauth_token, get_user_settings,
    upsert_thread, upsert_message, update_thread_embedding,
    update_user_history_id, update_job_status, log_processing
)
from gmail_client import (
    get_gmail_service_from_encrypted, fetch_message_ids_for_backfill,
    fetch_history_changes, fetch_message, parse_message, get_gmail_profile
)
from llm_service import (
    get_llm, classify_email, classify_with_rules, summarize_thread, extract_from_email,
    generate_embedding, detect_sensitive_patterns, redact_sensitive_content
)
from encryption import encrypt, hash_content
from error_handling import LLMError, should_retry, get_user_friendly_message, log_error_for_support

logger = structlog.get_logger()


class EmailProcessingState(TypedDict):
    """State for email processing pipeline."""
    user_id: str
    job_id: Optional[str]
    correlation_id: str
    
    # Settings
    llm_api_key_enc: Optional[str]
    llm_provider: str
    llm_base_url: Optional[str]
    llm_model: Optional[str]
    redaction_mode: str
    
    # Gmail service
    gmail_service: Any
    
    # Current message being processed
    message_id: str
    raw_message: Optional[Dict[str, Any]]
    parsed_message: Optional[Dict[str, Any]]
    
    # Processing results
    classification: Optional[Dict[str, Any]]
    extraction: Optional[Dict[str, Any]]
    sensitive_flags: List[str]
    
    # Output
    processed: bool
    error: Optional[str]


class ThreadProcessingState(TypedDict):
    """State for thread processing pipeline."""
    user_id: str
    job_id: Optional[str]
    correlation_id: str
    
    # Settings
    llm_api_key_enc: Optional[str]
    llm_provider: str
    llm_base_url: Optional[str]
    llm_model: Optional[str]
    
    # Thread data
    gmail_thread_id: str
    messages: List[Dict[str, Any]]
    
    # Processing results
    summary: Optional[Dict[str, Any]]
    embedding: Optional[List[float]]
    
    # Output
    processed: bool
    error: Optional[str]


# ===== EMAIL PROCESSING NODES =====

def fetch_message_node(state: EmailProcessingState) -> EmailProcessingState:
    """Fetch message from Gmail."""
    try:
        raw_message = fetch_message(state["gmail_service"], state["message_id"])
        if not raw_message:
            return {**state, "error": "Message not found", "processed": False}
        return {**state, "raw_message": raw_message}
    except Exception as e:
        logger.error("fetch_message_failed", message_id=state["message_id"], error=str(e))
        try:
            with get_db() as db:
                log_processing(
                    db, state["user_id"], state.get("job_id"), state.get("correlation_id"),
                    "error", f"Fetch message failed: {str(e)}",
                    {"message_id": state["message_id"]}
                )
        except:
            pass
        return {**state, "error": str(e), "processed": False}


def parse_message_node(state: EmailProcessingState) -> EmailProcessingState:
    """Parse the raw message."""
    if not state.get("raw_message"):
        return state
    
    try:
        parsed = parse_message(state["raw_message"])
        return {**state, "parsed_message": parsed}
    except Exception as e:
        logger.error("parse_message_failed", message_id=state["message_id"], error=str(e))
        try:
            with get_db() as db:
                log_processing(
                    db, state["user_id"], state.get("job_id"), state.get("correlation_id"),
                    "error", f"Parse message failed: {str(e)}",
                    {"message_id": state["message_id"]}
                )
        except:
            pass
        return {**state, "error": str(e), "processed": False}


def detect_sensitive_node(state: EmailProcessingState) -> EmailProcessingState:
    """Detect sensitive content in the message."""
    if not state.get("parsed_message"):
        return state
    
    parsed = state["parsed_message"]
    text = f"{parsed.get('subject', '')} {parsed.get('body_text', '')}"
    
    flags = detect_sensitive_patterns(text)
    return {**state, "sensitive_flags": flags}


def classify_message_node(state: EmailProcessingState) -> EmailProcessingState:
    """Classify the message using rules first, then LLM fallback."""
    if not state.get("parsed_message"):
        return state
    
    parsed = state["parsed_message"]
    
    # Try rule-based classification first (cost-effective)
    rule_result = classify_with_rules(
        subject=parsed.get("subject", ""),
        from_address=parsed.get("from_address", ""),
        snippet=parsed.get("snippet", ""),
        body_preview=parsed.get("body_text", "")[:500],  # Use first 500 chars for rules
        labels=parsed.get("labels", []),
    )
    
    # If rules matched with high confidence, use that result
    if rule_result and rule_result.confidence >= 0.8:
        logger.info(
            "classification_by_rules",
            message_id=state["message_id"],
            category=rule_result.category,
            confidence=rule_result.confidence,
        )
        return {**state, "classification": rule_result.model_dump(), "classified_by": "rules"}
    
    # Rules didn't match or low confidence - use LLM
    if not state.get("llm_api_key_enc"):
        # No LLM key, use rule result if available or fallback
        if rule_result:
            return {**state, "classification": rule_result.model_dump(), "classified_by": "rules"}
        return {**state, "classification": {
            "category": "misc",
            "priority": "NORMAL",
            "needs_reply": False,
            "spam_score": 0,
            "sensitive_flags": state.get("sensitive_flags", []),
            "confidence": 0,
        }}
    
    # Apply redaction if needed for LLM
    body_preview = parsed.get("body_text", "")
    if state["redaction_mode"] == "REDACT_BEFORE_LLM" and body_preview:
        body_preview = redact_sensitive_content(body_preview)
    elif state["redaction_mode"] == "SUMMARIES_ONLY":
        body_preview = ""  # Don't send body to LLM
    
    try:
        llm = get_llm(
            state["llm_api_key_enc"], 
            state["llm_provider"],
            state.get("llm_base_url"),
            state.get("llm_model")
        )
        result = classify_email(
            llm,
            subject=parsed.get("subject", ""),
            from_address=parsed.get("from_address", ""),
            snippet=parsed.get("snippet", ""),
            body_preview=body_preview,
            labels=parsed.get("labels", []),
        )
        logger.info(
            "classification_by_llm",
            message_id=state["message_id"],
            category=result.category,
            confidence=result.confidence,
        )
        return {**state, "classification": result.model_dump(), "classified_by": "llm"}
    except LLMError as e:
        # Log error with context for support
        logger.error(
            "llm_classification_error",
            **log_error_for_support(e, {
                "user_id": state["user_id"],
                "message_id": state["message_id"],
                "job_id": state.get("job_id"),
            })
        )
        # Use fallback classification - still process the email
        return {**state, "classification": {
            "category": "misc",
            "priority": "NORMAL",
            "needs_reply": False,
            "spam_score": 0,
            "sensitive_flags": state.get("sensitive_flags", []),
            "confidence": 0,
        }, "llm_error": {
            "type": e.error_type.value,
            "message": get_user_friendly_message(e),
            "retryable": should_retry(e),
        }}
    except Exception as e:
        logger.warning("classify_message_failed", message_id=state["message_id"], error=str(e))
        try:
            with get_db() as db:
                log_processing(
                    db, state["user_id"], state.get("job_id"), state.get("correlation_id"),
                    "warning", f"Classification failed: {str(e)}",
                    {"message_id": state["message_id"]}
                )
        except:
            pass
        # Use fallback classification
        return {**state, "classification": {
            "category": "misc",
            "priority": "NORMAL",
            "needs_reply": False,
            "spam_score": 0,
            "sensitive_flags": state.get("sensitive_flags", []),
            "confidence": 0,
        }}


def extract_entities_node(state: EmailProcessingState) -> EmailProcessingState:
    """Extract entities from the message."""
    if not state.get("parsed_message") or not state.get("llm_api_key_enc"):
        return state
    
    parsed = state["parsed_message"]
    
    # Skip extraction for summaries-only mode
    if state["redaction_mode"] == "SUMMARIES_ONLY":
        return {**state, "extraction": {"tasks": [], "deadlines": [], "entities": {}, "key_facts": []}}
    
    body = parsed.get("body_text", "")
    if state["redaction_mode"] == "REDACT_BEFORE_LLM" and body:
        body = redact_sensitive_content(body)
    
    try:
        llm = get_llm(
            state["llm_api_key_enc"], 
            state["llm_provider"],
            state.get("llm_base_url"),
            state.get("llm_model")
        )
        result = extract_from_email(
            llm,
            subject=parsed.get("subject", ""),
            body=body,
        )
        return {**state, "extraction": result.model_dump()}
    except LLMError as e:
        logger.error(
            "llm_extraction_error",
            **log_error_for_support(e, {
                "user_id": state["user_id"],
                "message_id": state["message_id"],
                "job_id": state.get("job_id"),
            })
        )
        # Return empty extraction - still process the email
        return {**state, "extraction": {"tasks": [], "deadlines": [], "entities": {}, "key_facts": []}, "llm_error": {
            "type": e.error_type.value,
            "message": get_user_friendly_message(e),
            "retryable": should_retry(e),
        }}
    except Exception as e:
        logger.warning("extract_entities_failed", message_id=state["message_id"], error=str(e))
        return {**state, "extraction": {"tasks": [], "deadlines": [], "entities": {}, "key_facts": []}}


def persist_message_node(state: EmailProcessingState) -> EmailProcessingState:
    """Persist the processed message to database."""
    if not state.get("parsed_message"):
        return {**state, "processed": False}
    
    parsed = state["parsed_message"]
    classification = state.get("classification", {})
    extraction = state.get("extraction")
    
    # Encrypt body if present
    body_text_enc = encrypt(parsed["body_text"]) if parsed.get("body_text") else None
    body_html_enc = encrypt(parsed["body_html"]) if parsed.get("body_html") else None
    body_hash = hash_content(parsed["body_text"]) if parsed.get("body_text") else None
    
    message_data = {
        "gmail_message_id": parsed["gmail_message_id"],
        "gmail_thread_id": parsed["gmail_thread_id"],
        "from_address": parsed["from_address"],
        "from_name": parsed.get("from_name"),
        "to_addresses": parsed.get("to_addresses", []),
        "cc_addresses": parsed.get("cc_addresses", []),
        "bcc_addresses": parsed.get("bcc_addresses", []),
        "date": parsed["date"],
        "subject": parsed.get("subject"),
        "snippet": parsed.get("snippet"),
        "body_text_enc": body_text_enc,
        "body_html_enc": body_html_enc,
        "body_hash": body_hash,
        "labels": parsed.get("labels", []),
        "category": classification.get("category", "misc"),
        "spam_score": classification.get("spam_score", 0),
        "sensitive_flags": state.get("sensitive_flags", []) + classification.get("sensitive_flags", []),
        "extracted": extraction,
        "is_read": "UNREAD" not in parsed.get("labels", []),
        "is_starred": "STARRED" in parsed.get("labels", []),
        "has_attachments": parsed.get("has_attachments", False),
        "attachments": parsed.get("attachments"),
    }
    
    try:
        with get_db() as db:
            upsert_message(db, state["user_id"], message_data)
            log_processing(
                db, state["user_id"], state["job_id"], state["correlation_id"],
                "info", f"Processed message {parsed['gmail_message_id']}",
                {"category": classification.get("category"), "sensitive_flags": state.get("sensitive_flags", [])}
            )
        return {**state, "processed": True}
    except Exception as e:
        logger.error("persist_message_failed", message_id=state["message_id"], error=str(e))
        try:
            with get_db() as db:
                log_processing(
                    db, state["user_id"], state.get("job_id"), state.get("correlation_id"),
                    "error", f"Persist message failed: {str(e)}",
                    {"message_id": state["message_id"]}
                )
        except:
            pass
        return {**state, "error": str(e), "processed": False}


# ===== THREAD PROCESSING NODES =====

def summarize_thread_node(state: ThreadProcessingState) -> ThreadProcessingState:
    """Summarize the thread."""
    if not state.get("messages") or not state.get("llm_api_key_enc"):
        return state
    
    try:
        llm = get_llm(
            state["llm_api_key_enc"], 
            state["llm_provider"],
            state.get("llm_base_url"),
            state.get("llm_model")
        )
        
        # Get the first message subject
        subject = state["messages"][0].get("subject", "") if state["messages"] else ""
        
        # Format messages for summarization
        messages_for_summary = [
            {
                "from": m.get("from_address", "Unknown"),
                "date": m.get("date", "Unknown"),
                "body": m.get("body_text", m.get("snippet", ""))[:300],
            }
            for m in state["messages"]
        ]
        
        result = summarize_thread(llm, subject, messages_for_summary)
        return {**state, "summary": result.model_dump()}
    except LLMError as e:
        logger.error(
            "llm_summarization_error",
            **log_error_for_support(e, {
                "user_id": state["user_id"],
                "thread_id": state["gmail_thread_id"],
                "job_id": state.get("job_id"),
            })
        )
        # Return empty summary - still process the thread
        return {**state, "summary": {"short_summary": "", "full_summary": ""}, "llm_error": {
            "type": e.error_type.value,
            "message": get_user_friendly_message(e),
            "retryable": should_retry(e),
        }}
    except Exception as e:
        logger.warning("summarize_thread_failed", thread_id=state["gmail_thread_id"], error=str(e))
        return {**state, "summary": {"short_summary": "", "full_summary": ""}}


def generate_embedding_node(state: ThreadProcessingState) -> ThreadProcessingState:
    """Generate embedding for the thread."""
    if not state.get("llm_api_key_enc"):
        return state
    
    try:
        summary = state.get("summary", {})
        subject = state["messages"][0].get("subject", "") if state["messages"] else ""
        
        # Combine subject and summary for embedding
        text_for_embedding = f"{subject} {summary.get('full_summary', '')}"
        
        if text_for_embedding.strip():
            embedding = generate_embedding(
                state["llm_api_key_enc"], 
                text_for_embedding,
                state["llm_provider"]
            )
            if embedding:
                return {**state, "embedding": embedding}
    except Exception as e:
        logger.warning("generate_embedding_failed", thread_id=state["gmail_thread_id"], error=str(e))
    
    return state


def persist_thread_node(state: ThreadProcessingState) -> ThreadProcessingState:
    """Persist the processed thread to database."""
    if not state.get("messages"):
        return {**state, "processed": False}
    
    messages = state["messages"]
    summary = state.get("summary", {})
    
    # Aggregate thread data from messages
    participants = list(set(
        m.get("from_address") for m in messages if m.get("from_address")
    ))
    
    last_message = max(messages, key=lambda m: m.get("date", datetime.min))
    first_message = min(messages, key=lambda m: m.get("date", datetime.max))
    
    # Determine needs_reply from messages
    needs_reply = any(
        m.get("classification", {}).get("needs_reply", False)
        for m in messages
    )
    
    # Get most common category
    categories = [m.get("classification", {}).get("category", "misc") for m in messages]
    category = max(set(categories), key=categories.count) if categories else "misc"
    
    thread_data = {
        "gmail_thread_id": state["gmail_thread_id"],
        "subject": first_message.get("subject"),
        "participants": participants,
        "last_message_at": last_message.get("date"),
        "category": category,
        "priority": "NORMAL",  # Could be enhanced
        "summary": summary.get("full_summary"),
        "summary_short": summary.get("short_summary"),
        "needs_reply": needs_reply,
        "is_read": all("UNREAD" not in m.get("labels", []) for m in messages),
        "is_starred": any("STARRED" in m.get("labels", []) for m in messages),
        "labels": list(set(label for m in messages for label in m.get("labels", []))),
        "message_count": len(messages),
    }
    
    try:
        with get_db() as db:
            upsert_thread(db, state["user_id"], thread_data)
            
            # Update embedding if available
            if state.get("embedding"):
                # Get the thread ID
                result = db.execute(
                    text("""SELECT id FROM "Thread" WHERE "userId" = :user_id AND "gmailThreadId" = :gmail_thread_id"""),
                    {"user_id": state["user_id"], "gmail_thread_id": state["gmail_thread_id"]}
                ).fetchone()
                if result:
                    update_thread_embedding(db, result[0], state["embedding"])
            
            log_processing(
                db, state["user_id"], state["job_id"], state["correlation_id"],
                "info", f"Processed thread {state['gmail_thread_id']}",
                {"message_count": len(messages), "category": category}
            )
        return {**state, "processed": True}
    except Exception as e:
        logger.error("persist_thread_failed", thread_id=state["gmail_thread_id"], error=str(e))
        return {**state, "error": str(e), "processed": False}


# ===== BUILD GRAPHS =====

def build_message_processing_graph() -> StateGraph:
    """Build the message processing graph."""
    graph = StateGraph(EmailProcessingState)
    
    graph.add_node("fetch_message", fetch_message_node)
    graph.add_node("parse_message", parse_message_node)
    graph.add_node("detect_sensitive", detect_sensitive_node)
    graph.add_node("classify_message", classify_message_node)
    graph.add_node("extract_entities", extract_entities_node)
    graph.add_node("persist_message", persist_message_node)
    
    graph.set_entry_point("fetch_message")
    graph.add_edge("fetch_message", "parse_message")
    graph.add_edge("parse_message", "detect_sensitive")
    graph.add_edge("detect_sensitive", "classify_message")
    graph.add_edge("classify_message", "extract_entities")
    graph.add_edge("extract_entities", "persist_message")
    graph.add_edge("persist_message", END)
    
    return graph.compile()


def build_thread_processing_graph() -> StateGraph:
    """Build the thread processing graph."""
    graph = StateGraph(ThreadProcessingState)
    
    graph.add_node("summarize_thread", summarize_thread_node)
    graph.add_node("generate_embedding", generate_embedding_node)
    graph.add_node("persist_thread", persist_thread_node)
    
    graph.set_entry_point("summarize_thread")
    graph.add_edge("summarize_thread", "generate_embedding")
    graph.add_edge("generate_embedding", "persist_thread")
    graph.add_edge("persist_thread", END)
    
    return graph.compile()


# Create compiled graphs
message_processing_graph = build_message_processing_graph()
thread_processing_graph = build_thread_processing_graph()

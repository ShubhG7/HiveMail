"""DuckDB-powered analytics for fast email queries.

Inspired by msgvault's approach of using DuckDB with Parquet files for
lightning-fast analytics queries on large email datasets.
"""

import os
import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, date
from sqlalchemy import text
import structlog

from db import get_db
from config import get_settings

settings = get_settings()
logger = structlog.get_logger()

# Directory for storing Parquet files (one per user)
PARQUET_DIR = Path(os.getenv("PARQUET_DATA_DIR", "/tmp/hivemail_analytics"))


def ensure_parquet_dir(user_id: str) -> Path:
    """Ensure Parquet directory exists for a user."""
    user_dir = PARQUET_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


def export_email_metadata_to_parquet(user_id: str, force_refresh: bool = False) -> Path:
    """
    Export email metadata from PostgreSQL to Parquet for fast DuckDB queries.
    
    This creates a Parquet file with all message metadata (excluding encrypted bodies)
    that can be queried extremely fast with DuckDB.
    
    Args:
        user_id: User ID to export data for
        force_refresh: If True, regenerate even if file exists
    
    Returns:
        Path to the Parquet file
    """
    user_dir = ensure_parquet_dir(user_id)
    parquet_file = user_dir / "messages.parquet"
    
    # Check if file exists and is recent (within last hour)
    if not force_refresh and parquet_file.exists():
        file_age = datetime.now().timestamp() - parquet_file.stat().st_mtime
        if file_age < 3600:  # Less than 1 hour old
            logger.info("parquet_cache_hit", user_id=user_id, age_seconds=file_age)
            return parquet_file
    
    logger.info("exporting_to_parquet", user_id=user_id)
    
    with get_db() as db:
        # Fetch all message metadata (excluding encrypted bodies for performance)
        result = db.execute(
            text("""
                SELECT 
                    "gmailMessageId",
                    "gmailThreadId",
                    "fromAddress",
                    "fromName",
                    "toAddresses",
                    "ccAddresses",
                    "bccAddresses",
                    date,
                    subject,
                    snippet,
                    labels,
                    category,
                    "spamScore",
                    "sensitiveFlags",
                    "isRead",
                    "isStarred",
                    "hasAttachments",
                    "createdAt",
                    "updatedAt"
                FROM "Message"
                WHERE "userId" = :user_id
                ORDER BY date DESC
            """),
            {"user_id": user_id}
        )
        
        rows = result.fetchall()
        columns = result.keys()
        
        if not rows:
            logger.warning("no_messages_to_export", user_id=user_id)
            # Create empty Parquet file
            schema = pa.schema([
                ("gmailMessageId", pa.string()),
                ("gmailThreadId", pa.string()),
                ("fromAddress", pa.string()),
                ("fromName", pa.string()),
                ("toAddresses", pa.list_(pa.string())),
                ("ccAddresses", pa.list_(pa.string())),
                ("bccAddresses", pa.list_(pa.string())),
                ("date", pa.timestamp("us")),
                ("subject", pa.string()),
                ("snippet", pa.string()),
                ("labels", pa.list_(pa.string())),
                ("category", pa.string()),
                ("spamScore", pa.float64()),
                ("sensitiveFlags", pa.list_(pa.string())),
                ("isRead", pa.bool_()),
                ("isStarred", pa.bool_()),
                ("hasAttachments", pa.bool_()),
                ("createdAt", pa.timestamp("us")),
                ("updatedAt", pa.timestamp("us")),
            ])
            table = pa.Table.from_arrays([[] for _ in schema], schema=schema)
            pq.write_table(table, parquet_file)
            return parquet_file
        
        # Convert to Arrow table
        data = {col: [] for col in columns}
        for row in rows:
            for i, col in enumerate(columns):
                value = row[i]
                # Handle list types (PostgreSQL arrays)
                if isinstance(value, list):
                    data[col].append(value)
                else:
                    data[col].append(value)
        
        # Create Arrow table
        arrays = []
        schema_fields = []
        for col in columns:
            if col in ["toAddresses", "ccAddresses", "bccAddresses", "labels", "sensitiveFlags"]:
                # List of strings
                pa_type = pa.list_(pa.string())
            elif col in ["date", "createdAt", "updatedAt"]:
                pa_type = pa.timestamp("us")
            elif col == "spamScore":
                pa_type = pa.float64()
            elif col in ["isRead", "isStarred", "hasAttachments"]:
                pa_type = pa.bool_()
            else:
                pa_type = pa.string()
            
            schema_fields.append(pa.field(col, pa_type))
            # Convert None to appropriate default for each type
            cleaned_data = []
            for val in data[col]:
                if val is None:
                    if pa_type == pa.string():
                        cleaned_data.append("")
                    elif pa_type == pa.float64():
                        cleaned_data.append(0.0)
                    elif pa_type == pa.bool_():
                        cleaned_data.append(False)
                    elif pa_type == pa.timestamp("us"):
                        cleaned_data.append(None)  # Will be handled by Arrow
                    else:
                        cleaned_data.append(None)
                else:
                    cleaned_data.append(val)
            arrays.append(pa.array(cleaned_data, type=pa_type))
        
        schema = pa.schema(schema_fields)
        table = pa.Table.from_arrays(arrays, schema=schema)
        
        # Write to Parquet
        pq.write_table(table, parquet_file, compression="snappy")
        logger.info("parquet_export_complete", user_id=user_id, row_count=len(rows))
    
    return parquet_file


def get_duckdb_connection(user_id: str) -> duckdb.DuckDBPyConnection:
    """Get a DuckDB connection with user's Parquet data loaded."""
    conn = duckdb.connect()
    
    # Export/load Parquet data
    parquet_file = export_email_metadata_to_parquet(user_id)
    
    # Register Parquet file as a table
    conn.execute(f"""
        CREATE OR REPLACE TABLE messages AS 
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    
    return conn


def query_email_analytics(
    user_id: str,
    query: str,
    params: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Execute an analytics query using DuckDB.
    
    The 'messages' table is available with all message metadata.
    
    Example queries:
        - "SELECT category, COUNT(*) as count FROM messages GROUP BY category"
        - "SELECT DATE_TRUNC('month', date) as month, COUNT(*) FROM messages GROUP BY month"
        - "SELECT fromAddress, COUNT(*) as count FROM messages GROUP BY fromAddress ORDER BY count DESC LIMIT 10"
    
    Args:
        user_id: User ID
        query: SQL query (use 'messages' table)
        params: Optional query parameters
    
    Returns:
        List of result dictionaries
    """
    conn = get_duckdb_connection(user_id)
    
    try:
        if params:
            # Simple parameter substitution (for basic use cases)
            for key, value in params.items():
                query = query.replace(f":{key}", str(value))
        
        result = conn.execute(query).fetchall()
        columns = [desc[0] for desc in conn.description]
        
        return [dict(zip(columns, row)) for row in result]
    finally:
        conn.close()


def get_email_stats_fast(user_id: str) -> Dict[str, Any]:
    """
    Compute email statistics using DuckDB for fast performance.
    
    This is much faster than PostgreSQL for complex aggregations on large datasets.
    """
    conn = get_duckdb_connection(user_id)
    
    try:
        stats = {}
        
        # Total counts
        stats["total_messages"] = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        
        # Category breakdown
        category_result = conn.execute("""
            SELECT category, COUNT(*) as count 
            FROM messages 
            GROUP BY category
        """).fetchall()
        stats["category_breakdown"] = {row[0]: row[1] for row in category_result}
        
        # Top senders
        top_senders = conn.execute("""
            SELECT fromAddress, COUNT(*) as count 
            FROM messages 
            GROUP BY fromAddress 
            ORDER BY count DESC 
            LIMIT 10
        """).fetchall()
        stats["top_senders"] = [{"email": row[0], "count": row[1]} for row in top_senders]
        
        # Messages by month
        monthly = conn.execute("""
            SELECT 
                DATE_TRUNC('month', date) as month,
                COUNT(*) as count
            FROM messages
            GROUP BY month
            ORDER BY month DESC
            LIMIT 12
        """).fetchall()
        stats["monthly_counts"] = [{"month": row[0].isoformat(), "count": row[1]} for row in monthly]
        
        # Unread count
        stats["unread_count"] = conn.execute("""
            SELECT COUNT(*) FROM messages WHERE NOT isRead
        """).fetchone()[0]
        
        # Messages with attachments
        stats["messages_with_attachments"] = conn.execute("""
            SELECT COUNT(*) FROM messages WHERE hasAttachments
        """).fetchone()[0]
        
        # Average spam score
        avg_spam = conn.execute("SELECT AVG(spamScore) FROM messages").fetchone()[0]
        stats["avg_spam_score"] = float(avg_spam) if avg_spam else 0.0
        
        return stats
    finally:
        conn.close()


def get_sender_analytics(user_id: str, sender_email: Optional[str] = None) -> Dict[str, Any]:
    """
    Get analytics for a specific sender or all senders.
    
    Uses DuckDB for fast aggregation.
    """
    conn = get_duckdb_connection(user_id)
    
    try:
        if sender_email:
            query = f"""
                SELECT 
                    fromAddress,
                    COUNT(*) as message_count,
                    COUNT(DISTINCT gmailThreadId) as thread_count,
                    MIN(date) as first_message,
                    MAX(date) as last_message,
                    AVG(spamScore) as avg_spam_score,
                    COUNT(*) FILTER (WHERE hasAttachments) as messages_with_attachments
                FROM messages
                WHERE fromAddress = '{sender_email}'
                GROUP BY fromAddress
            """
        else:
            query = """
                SELECT 
                    fromAddress,
                    COUNT(*) as message_count,
                    COUNT(DISTINCT gmailThreadId) as thread_count,
                    MIN(date) as first_message,
                    MAX(date) as last_message,
                    AVG(spamScore) as avg_spam_score,
                    COUNT(*) FILTER (WHERE hasAttachments) as messages_with_attachments
                FROM messages
                GROUP BY fromAddress
                ORDER BY message_count DESC
                LIMIT 50
            """
        
        result = conn.execute(query).fetchall()
        columns = [desc[0] for desc in conn.description]
        
        return [dict(zip(columns, row)) for row in result]
    finally:
        conn.close()


def get_temporal_analytics(
    user_id: str,
    period: str = "month",
    start_date: Optional[date] = None,
    end_date: Optional[date] = None
) -> List[Dict[str, Any]]:
    """
    Get email counts over time (daily, weekly, monthly).
    
    Args:
        user_id: User ID
        period: 'day', 'week', or 'month'
        start_date: Optional start date
        end_date: Optional end date
    """
    conn = get_duckdb_connection(user_id)
    
    try:
        trunc_func = {
            "day": "DATE_TRUNC('day', date)",
            "week": "DATE_TRUNC('week', date)",
            "month": "DATE_TRUNC('month', date)",
        }.get(period, "DATE_TRUNC('month', date)")
        
        where_clause = ""
        if start_date:
            where_clause += f" AND date >= '{start_date}'"
        if end_date:
            where_clause += f" AND date <= '{end_date}'"
        
        query = f"""
            SELECT 
                {trunc_func} as period,
                COUNT(*) as message_count,
                COUNT(DISTINCT gmailThreadId) as thread_count,
                COUNT(*) FILTER (WHERE NOT isRead) as unread_count
            FROM messages
            WHERE 1=1 {where_clause}
            GROUP BY period
            ORDER BY period DESC
        """
        
        result = conn.execute(query).fetchall()
        return [
            {
                "period": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                "message_count": row[1],
                "thread_count": row[2],
                "unread_count": row[3],
            }
            for row in result
        ]
    finally:
        conn.close()

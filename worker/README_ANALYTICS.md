# DuckDB Analytics Integration

This module integrates DuckDB for fast email analytics queries, inspired by [msgvault](https://wesmckinney.com/blog/announcing-msgvault/).

## Overview

DuckDB is used alongside PostgreSQL to provide lightning-fast analytics queries on large email datasets. The system:

1. **Exports email metadata to Parquet files** - Creates efficient columnar storage for fast queries
2. **Uses DuckDB for analytics** - Queries Parquet files directly for aggregations and time-series analysis
3. **Keeps PostgreSQL as source of truth** - All writes go to PostgreSQL, DuckDB is read-only for analytics

## Features

- **Fast aggregations**: Category breakdowns, top senders, monthly trends
- **Temporal analytics**: Email counts by day/week/month
- **Sender analytics**: Detailed stats per sender
- **Automatic caching**: Parquet files are cached and refreshed hourly

## Usage

### Basic Analytics

```python
from analytics import get_email_stats_fast

# Get comprehensive email statistics
stats = get_email_stats_fast(user_id)
# Returns: {
#   "total_messages": 12345,
#   "category_breakdown": {"hiring": 100, "bills": 50, ...},
#   "top_senders": [{"email": "...", "count": 100}, ...],
#   "monthly_counts": [...],
#   ...
# }
```

### Custom Queries

```python
from analytics import query_email_analytics

# Custom SQL query on messages table
results = query_email_analytics(
    user_id,
    "SELECT category, COUNT(*) as count FROM messages GROUP BY category"
)
```

### Temporal Analytics

```python
from analytics import get_temporal_analytics

# Get monthly email counts
monthly = get_temporal_analytics(user_id, period="month")

# Get daily counts for date range
from datetime import date
daily = get_temporal_analytics(
    user_id,
    period="day",
    start_date=date(2024, 1, 1),
    end_date=date(2024, 12, 31)
)
```

### Sender Analytics

```python
from analytics import get_sender_analytics

# Get top 50 senders
top_senders = get_sender_analytics(user_id)

# Get stats for specific sender
sender_stats = get_sender_analytics(user_id, sender_email="example@email.com")
```

## Integration with Email Stats

The `compute_and_store_email_stats` function in `db.py` automatically uses DuckDB when available:

```python
from db import compute_and_store_email_stats

# Automatically uses DuckDB if available, falls back to PostgreSQL
with get_db() as db:
    compute_and_store_email_stats(db, user_id, use_duckdb=True)
```

## Configuration

Set the Parquet data directory via environment variable:

```bash
PARQUET_DATA_DIR=/path/to/parquet/files
```

Default: `/tmp/hivemail_analytics`

## Performance

- **Parquet export**: ~1-2 seconds for 100K messages
- **Analytics queries**: Sub-second for most aggregations
- **Cache**: Parquet files are cached for 1 hour, regenerated on-demand

## Benefits Over PostgreSQL-Only

1. **Faster aggregations**: DuckDB is optimized for analytical queries
2. **Columnar storage**: Parquet format is more efficient for analytics
3. **Reduced load on PostgreSQL**: Analytics queries don't impact transactional workload
4. **Scalability**: Handles millions of emails efficiently

## Future Enhancements

- [ ] Incremental Parquet updates (only export new messages)
- [ ] Thread-level Parquet exports
- [ ] Real-time analytics dashboard integration
- [ ] Export to DuckDB database format for even faster queries


import os
import sys
from dotenv import load_dotenv

# Load env variables from worker/.env
worker_env = os.path.join(os.getcwd(), 'worker', '.env')
if os.path.exists(worker_env):
    print(f"Loading .env from {worker_env}")
    load_dotenv(worker_env)
else:
    print(f"Warning: .env not found at {worker_env}")

# Add worker directory to path
sys.path.append(os.path.join(os.getcwd(), 'worker'))

from worker.main import get_db, get_user_oauth_token, get_user_settings, fetch_message_ids_for_backfill, get_gmail_service_from_encrypted
from worker.pipeline import message_processing_graph
from datetime import datetime, timedelta

def test_pipeline():
    print("Connecting to database...")
    try:
        with get_db() as db:
            # Get a user
            from sqlalchemy import text
            user_row = db.execute(text('SELECT id FROM "User" LIMIT 1')).fetchone()
            if not user_row:
                print("No user found.")
                return
            user_id = user_row[0]
            print(f"Using User ID: {user_id}")
            
            oauth_token = get_user_oauth_token(db, user_id)
            user_settings = get_user_settings(db, user_id)
            
            if not oauth_token:
                print("No OAuth token found.")
                # Is there any other user?
                users = db.execute(text('SELECT "userId" FROM "OAuthToken" LIMIT 1')).fetchone()
                if users:
                    user_id = users[0]
                    print(f"Switching to User ID with token: {user_id}")
                    oauth_token = get_user_oauth_token(db, user_id)
                    user_settings = get_user_settings(db, user_id)
                else:
                    print("No OAuth tokens at all.")
                    return

        print("Got OAuth token.")
        
        # Get Gmail service
        gmail_service = get_gmail_service_from_encrypted(
            oauth_token["access_token_enc"],
            oauth_token["refresh_token_enc"]
        )
        print("Got Gmail service.")
        
        # Fetch 1 message ID
        print("Fetching 1 message ID...")
        after_date = datetime.utcnow() - timedelta(days=30)
        message_ids = fetch_message_ids_for_backfill(
            gmail_service,
            after_date,
            exclude_labels=["SPAM", "TRASH"],
            max_results=1
        )
        
        if not message_ids:
            print("No message IDs found.")
            return
            
        message_id = message_ids[0]
        print(f"Testing Message ID: {message_id}")
        
        # Run pipeline
        initial_state = {
            "user_id": user_id,
            "job_id": "debug_job",
            "correlation_id": "debug_run",
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
        
        print("Invoking graph...")
        result = message_processing_graph.invoke(initial_state)
        
        print("\n=== RESULT ===")
        print(f"Processed: {result.get('processed')}")
        print(f"Error: {result.get('error')}")
        if result.get('parsed_message'):
            print(f"Subject: {result['parsed_message'].get('subject')}")
        
    except Exception as e:
        print(f"Pipeline failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_pipeline()

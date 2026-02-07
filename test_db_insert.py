
import os
import sys
from dotenv import load_dotenv
from datetime import datetime

# Load env
worker_env = os.path.join(os.getcwd(), 'worker', '.env')
if os.path.exists(worker_env):
    load_dotenv(worker_env)

sys.path.append(os.path.join(os.getcwd(), 'worker'))

from worker.db import get_db, upsert_message
from worker.encryption import encrypt

def test_insert():
    print("Testing message insertion...")
    try:
        # Mock message data
        message_data = {
            "gmail_message_id": "test_msg_id_123",
            "gmail_thread_id": "test_thread_id_123",
            "from_address": "test@example.com",
            "from_name": "Test User",
            "date": datetime.now(),
            "subject": "Test Subject",
            "snippet": "Test Snippet",
            "body_text_enc": encrypt("test body"),
            "labels": ["INBOX"],
            "to_addresses": ["me@example.com"],
        }
        
        # User ID - need a valid one? Or just random?
        # Ideally existing user. I'll pick one from DB.
        with get_db() as db:
            from sqlalchemy import text
            user = db.execute(text('SELECT id FROM "User" LIMIT 1')).fetchone()
            if not user:
                print("No user found in DB. Cannot test insert.")
                return
            
            user_id = user[0]
            print(f"Using User ID: {user_id}")
            
            upsert_message(db, user_id, message_data)
        
        print("Insert successful!")
        
    except Exception as e:
        print(f"Insert failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_insert()

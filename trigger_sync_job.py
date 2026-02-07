
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

from worker.db import get_db
from sqlalchemy import text
import uuid

def trigger_job():
    print("Connecting to database...")
    try:
        with get_db() as db:
            # Get a user
            user = db.execute(text('SELECT id FROM "User" LIMIT 1')).fetchone()
            if not user:
                print("No user found.")
                return
            
            user_id = user[0]
            print(f"Using User ID: {user_id}")
            
            # Create a new job
            job_id = str(uuid.uuid4())
            print(f"Creating job {job_id}...")
            
            db.execute(
                text("""
                    INSERT INTO "SyncJob" (
                        id, "userId", "jobType", status, progress, "totalItems", metadata, "createdAt", "updatedAt"
                    ) VALUES (
                        :job_id, :user_id, 'BACKFILL', 'PENDING', 0, 0, :metadata, NOW(), NOW()
                    )
                """),
                {
                    "job_id": job_id,
                    "user_id": user_id,
                    "metadata": '{"backfillDays": 30, "excludeLabels": ["SPAM", "TRASH"], "jobId": "' + job_id + '"}'
                }
            )
            print("Job created successfully.")
            
    except Exception as e:
        print(f"Failed to create job: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    trigger_job()

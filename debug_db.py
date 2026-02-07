
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
import json

def check_logs():
    print("Connecting to database...")
    try:
        with get_db() as db:
            # Get latest sync job
            print("\nFetching latest SyncJob...")
            result = db.execute(
                text("""
                    SELECT id, "userId", "jobType", status, progress, "totalItems", error, "createdAt", "startedAt", "completedAt"
                    FROM "SyncJob"
                    ORDER BY "createdAt" DESC
                    LIMIT 1
                """)
            ).fetchone()
            
            if not result:
                print("No SyncJob found.")
                return

            job_id = result[0]
            print(f"Latest Job ID: {job_id}")
            print(f"Type: {result[2]}")
            print(f"Status: {result[3]}")
            print(f"Progress: {result[4]}/{result[5]}")
            print(f"Error: {result[6]}")
            print(f"Created/Started/Completed: {result[7]} / {result[8]} / {result[9]}")
            
            # Get processing logs for this job
            print(f"\nFetching logs for Job {job_id}...")
            logs = db.execute(
                text("""
                    SELECT level, message, metadata, "createdAt"
                    FROM "ProcessingLog"
                    WHERE "jobId" = :job_id
                    ORDER BY "createdAt" DESC
                    LIMIT 20
                """),
                {"job_id": job_id}
            ).fetchall()
            
            if not logs:
                print("No processing logs found for this job.")
            else:
                for log in logs:
                    print(f"[{log[3]}] {log[0].upper()}: {log[1]}")
                    if log[2]:
                        try:
                            meta = json.loads(log[2])
                            print(f"  Metadata: {meta}")
                        except:
                            print(f"  Metadata: {log[2]}")

            # message count
            count = db.execute(text('SELECT count(*) FROM "Message"')).fetchone()
            print(f"\nTotal Messages in DB: {count[0]}")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_logs()

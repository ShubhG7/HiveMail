
import os
import sys
from dotenv import load_dotenv
from sqlalchemy import text

# Load env variables from worker/.env
worker_env = os.path.join(os.getcwd(), 'worker', '.env')
if os.path.exists(worker_env):
    load_dotenv(worker_env)

# Add worker directory to path
sys.path.append(os.path.join(os.getcwd(), 'worker'))

from worker.db import get_db

def diagnose():
    print("Diagnosing Sync Jobs...")
    with get_db() as db:
        # List Failed Jobs
        print("\n=== FAILED JOBS ===")
        failed_jobs = db.execute(text("""
            SELECT id, "jobType", status, progress, "totalItems", error, "createdAt", "updatedAt"
            FROM "SyncJob"
            WHERE status = 'FAILED'
            ORDER BY "createdAt" DESC
            LIMIT 5
        """)).fetchall()
        
        if not failed_jobs:
            print("No failed jobs found.")
        else:
            for job in failed_jobs:
                print(f"Job ID: {job[0]}")
                print(f"Type: {job[1]}, Status: {job[2]}")
                print(f"Progress: {job[3]}/{job[4]}")
                print(f"Error: {job[5]}")
                print(f"Created: {job[6]}")
                print("-" * 30)

        # List Error Logs
        print("\n=== RECENT ERROR LOGS ===")
        error_logs = db.execute(text("""
            SELECT "jobId", message, "createdAt"
            FROM "ProcessingLog"
            WHERE level = 'error'
            ORDER BY "createdAt" DESC
            LIMIT 10
        """)).fetchall()
        
        if not error_logs:
            print("No error logs found.")
        else:
            for log in error_logs:
                print(f"Job: {log[0]}")
                print(f"Time: {log[2]}")
                print(f"Message: {log[1]}")
                print("-" * 30)

        # List Suspiciously Stuck Jobs
        print("\n=== STUCK JOBS (RUNNING > 1h) ===")
        stuck_jobs = db.execute(text("""
            SELECT id, "jobType", status, progress, "totalItems", "createdAt"
            FROM "SyncJob"
            WHERE status = 'RUNNING' AND "createdAt" < NOW() - INTERVAL '1 hour'
        """)).fetchall()
        
        if not stuck_jobs:
            print("No stuck jobs found.")
        else:
            for job in stuck_jobs:
                print(f"Job ID: {job[0]}")
                print(f"Processing: {job[3]}/{job[4]}")
                print(f"Created: {job[5]}")

if __name__ == "__main__":
    diagnose()

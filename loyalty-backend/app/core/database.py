import os
from contextlib import contextmanager
from dotenv import load_dotenv
from psycopg_pool import ConnectionPool

load_dotenv()

# Read PostgreSQL connection string from environment
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in environment variables.")

# Connection pool to manage database connections safely
pool = ConnectionPool(conninfo=DATABASE_URL, min_size=1, max_size=10, open=True)


@contextmanager
def get_db_connection():
    # Yield a pooled connection and commit on success or rollback on error
    with pool.connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def check_db_connection() -> bool:
    # Run a lightweight query to verify database connectivity
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
            return cur.fetchone() is not None
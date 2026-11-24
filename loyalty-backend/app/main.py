from fastapi import FastAPI, HTTPException
from app.core.database import check_db_connection, pool
from app.routers import auth, customer, loyalty, merchant

app = FastAPI(title="Loyalty App Backend", version="0.1.0")

# Register routers
app.include_router(auth.router)
app.include_router(customer.router)
app.include_router(loyalty.router)
app.include_router(merchant.router)


@app.on_event("shutdown")
def shutdown_event():
    # Close connection pool cleanly when application stops
    pool.close()


@app.get("/health")
def health_check():
    # Verify both API liveness and PostgreSQL reachability
    try:
        db_ok = check_db_connection()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")

    return {"status": "ok", "database": "connected" if db_ok else "error"}
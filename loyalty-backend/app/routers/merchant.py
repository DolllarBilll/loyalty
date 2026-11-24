from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.database import get_db_connection

router = APIRouter(prefix="/merchant", tags=["Merchant"])


class UpdateRewardRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    points_required: Optional[int] = Field(default=None, gt=0)
    is_active: Optional[bool] = None


@router.get("/{merchant_id}/dashboard", status_code=status.HTTP_200_OK)
def get_merchant_dashboard(merchant_id: UUID):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify merchant exists and fetch basic settings
            cur.execute(
                """
                SELECT id, name, category, points_per_euro, inactivity_days_trigger, is_active
                FROM merchants
                WHERE id = %s
                """,
                (str(merchant_id),),
            )
            merchant = cur.fetchone()
            if not merchant:
                raise HTTPException(status_code=404, detail="Merchant not found.")

            # Aggregate total earned/redeemed points and unique customers
            cur.execute(
                """
                SELECT
                    COUNT(DISTINCT customer_id) AS unique_customers,
                    COALESCE(SUM(CASE WHEN type = 'EARN' THEN points_delta ELSE 0 END), 0) AS total_points_awarded,
                    COALESCE(SUM(CASE WHEN type = 'REDEEM' THEN ABS(points_delta) ELSE 0 END), 0) AS total_points_redeemed,
                    COUNT(*) AS total_transactions
                FROM transactions
                WHERE merchant_id = %s
                """,
                (str(merchant_id),),
            )
            stats = cur.fetchone()

    return {
        "merchant_id": str(merchant[0]),
        "name": merchant[1],
        "category": merchant[2],
        "points_per_euro": float(merchant[3]),
        "inactivity_days_trigger": merchant[4],
        "is_active": merchant[5],
        "stats": {
            "unique_customers": stats[0],
            "total_points_awarded": int(stats[1]),
            "total_points_redeemed": int(stats[2]),
            "total_transactions": stats[3],
        },
    }


@router.get("/{merchant_id}/rewards", status_code=status.HTTP_200_OK)
def get_merchant_rewards(merchant_id: UUID):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify merchant exists
            cur.execute("SELECT id FROM merchants WHERE id = %s", (str(merchant_id),))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Merchant not found.")

            # List rewards configured for this merchant
            cur.execute(
                """
                SELECT id, title, points_required, is_active, created_at
                FROM rewards
                WHERE merchant_id = %s
                ORDER BY points_required ASC, created_at DESC
                """,
                (str(merchant_id),),
            )
            rows = cur.fetchall()

    return {
        "merchant_id": str(merchant_id),
        "rewards": [
            {
                "reward_id": str(r[0]),
                "title": r[1],
                "points_required": r[2],
                "is_active": r[3],
                "created_at": r[4],
            }
            for r in rows
        ],
    }


@router.patch("/{merchant_id}/rewards/{reward_id}", status_code=status.HTTP_200_OK)
def update_merchant_reward(
    merchant_id: UUID,
    reward_id: UUID,
    payload: UpdateRewardRequest,
):
    updates = []
    params = []

    # Collect only explicitly provided fields to support partial updates
    if payload.title is not None:
        updates.append("title = %s")
        params.append(payload.title.strip())

    if payload.points_required is not None:
        updates.append("points_required = %s")
        params.append(payload.points_required)

    if payload.is_active is not None:
        updates.append("is_active = %s")
        params.append(payload.is_active)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update (title, points_required, is_active).",
        )

    params.extend([str(reward_id), str(merchant_id)])

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Update reward scoped to the owning merchant
            cur.execute(
                f"""
                UPDATE rewards
                SET {", ".join(updates)}
                WHERE id = %s AND merchant_id = %s
                RETURNING id, merchant_id, title, points_required, is_active, created_at
                """,
                tuple(params),
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(status_code=404, detail="Reward not found for this merchant.")

    return {
        "reward_id": str(updated[0]),
        "merchant_id": str(updated[1]),
        "title": updated[2],
        "points_required": updated[3],
        "is_active": updated[4],
        "created_at": updated[5],
    }


@router.get("/{merchant_id}/transactions", status_code=status.HTTP_200_OK)
def get_merchant_transactions(merchant_id: UUID, limit: int = 30):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch recent transactions joined with customer name
            cur.execute(
                """
                SELECT
                    t.id,
                    t.customer_id,
                    u.full_name,
                    t.type,
                    t.points_delta,
                    t.purchase_amount,
                    t.reward_id,
                    t.created_at
                FROM transactions t
                JOIN users u ON u.id = t.customer_id
                WHERE t.merchant_id = %s
                ORDER BY t.created_at DESC
                LIMIT %s
                """,
                (str(merchant_id), limit),
            )
            rows = cur.fetchall()

    return {
        "merchant_id": str(merchant_id),
        "transactions": [
            {
                "transaction_id": str(r[0]),
                "customer_id": str(r[1]),
                "customer_name": r[2],
                "type": r[3],
                "points_delta": r[4],
                "purchase_amount": float(r[5]) if r[5] is not None else None,
                "reward_id": str(r[6]) if r[6] is not None else None,
                "created_at": r[7],
            }
            for r in rows
        ],
    }
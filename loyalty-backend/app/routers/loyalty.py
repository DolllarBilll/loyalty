import math
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from psycopg import errors
from pydantic import BaseModel, Field

from app.core.database import get_db_connection

router = APIRouter(tags=["Loyalty"])

REDEMPTION_TTL_MINUTES = 10


class CreateRewardRequest(BaseModel):
    merchant_id: UUID
    title: str = Field(..., min_length=2, max_length=150)
    points_required: int = Field(..., gt=0)


class UpdateRewardRequest(BaseModel):
    merchant_id: UUID
    title: str | None = Field(default=None, min_length=2, max_length=150)
    points_required: int | None = Field(default=None, gt=0)
    is_active: bool | None = None


class AwardPointsRequest(BaseModel):
    merchant_id: UUID
    static_qr_code: str = Field(..., min_length=3, max_length=100)
    purchase_amount: Decimal | None = Field(default=None, gt=0)
    fixed_points: int | None = Field(default=None, gt=0)


class GenerateRedemptionRequest(BaseModel):
    customer_id: UUID
    merchant_id: UUID
    reward_id: UUID


class ConfirmRedemptionRequest(BaseModel):
    merchant_id: UUID
    qr_token: str | None = Field(default=None, min_length=4, max_length=120)
    six_digit_code: str | None = Field(default=None, min_length=6, max_length=6)


@router.post("/merchant/rewards", status_code=status.HTTP_201_CREATED)
def create_reward(payload: CreateRewardRequest):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Ensure target merchant exists and is active
            cur.execute(
                """
                SELECT id
                FROM merchants
                WHERE id = %s AND is_active = TRUE
                """,
                (str(payload.merchant_id),),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Active merchant not found.")

            # Insert new reward rule for this merchant
            cur.execute(
                """
                INSERT INTO rewards (merchant_id, title, points_required)
                VALUES (%s, %s, %s)
                RETURNING id, merchant_id, title, points_required, is_active, created_at
                """,
                (str(payload.merchant_id), payload.title.strip(), payload.points_required),
            )
            row = cur.fetchone()

    return {
        "reward_id": str(row[0]),
        "merchant_id": str(row[1]),
        "title": row[2],
        "points_required": row[3],
        "is_active": row[4],
        "created_at": row[5],
    }


@router.patch("/merchant/rewards/{reward_id}", status_code=status.HTTP_200_OK)
def update_reward(reward_id: UUID, payload: UpdateRewardRequest):
    # Ensure at least one mutable field is provided
    if (
        payload.title is None
        and payload.points_required is None
        and payload.is_active is None
    ):
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update (title, points_required, or is_active).",
        )

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify reward exists and belongs to the requesting merchant
            cur.execute(
                """
                SELECT id, merchant_id, title, points_required, is_active
                FROM rewards
                WHERE id = %s AND merchant_id = %s
                """,
                (str(reward_id), str(payload.merchant_id)),
            )
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(
                    status_code=404,
                    detail="Reward not found for this merchant.",
                )

            next_title = (
                payload.title.strip() if payload.title is not None else existing[2]
            )
            if not next_title:
                raise HTTPException(
                    status_code=400,
                    detail="Reward title cannot be empty.",
                )

            next_points = (
                payload.points_required
                if payload.points_required is not None
                else existing[3]
            )
            next_active = (
                payload.is_active if payload.is_active is not None else existing[4]
            )

            # Update reward fields in database
            cur.execute(
                """
                UPDATE rewards
                SET title = %s, points_required = %s, is_active = %s
                WHERE id = %s AND merchant_id = %s
                RETURNING id, merchant_id, title, points_required, is_active
                """,
                (
                    next_title,
                    next_points,
                    next_active,
                    str(reward_id),
                    str(payload.merchant_id),
                ),
            )
            updated = cur.fetchone()

    return {
        "reward_id": str(updated[0]),
        "merchant_id": str(updated[1]),
        "title": updated[2],
        "points_required": updated[3],
        "is_active": updated[4],
    }


@router.delete("/merchant/rewards/{reward_id}", status_code=status.HTTP_200_OK)
def delete_reward(reward_id: UUID, merchant_id: UUID = Query(...)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify reward exists and belongs to the requesting merchant
            cur.execute(
                """
                SELECT id
                FROM rewards
                WHERE id = %s AND merchant_id = %s
                """,
                (str(reward_id), str(merchant_id)),
            )
            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Reward not found for this merchant.",
                )

            try:
                # Delete reward row if unreferenced by historical redemptions or transactions
                cur.execute(
                    """
                    DELETE FROM rewards
                    WHERE id = %s AND merchant_id = %s
                    """,
                    (str(reward_id), str(merchant_id)),
                )
            except errors.ForeignKeyViolation:
                # Preserve historical audit records by deactivating instead of hard-deleting
                cur.execute(
                    """
                    UPDATE rewards
                    SET is_active = FALSE
                    WHERE id = %s AND merchant_id = %s
                    """,
                    (str(reward_id), str(merchant_id)),
                )
                return {
                    "deleted": False,
                    "deactivated": True,
                    "reward_id": str(reward_id),
                    "detail": "Reward had historical records, so it was marked as inactive instead.",
                }

    return {
        "deleted": True,
        "deactivated": False,
        "reward_id": str(reward_id),
    }


@router.post("/merchant/points/award", status_code=status.HTTP_200_OK)
def award_points(payload: AwardPointsRequest):
    # Require either a purchase amount or an explicit point count
    if payload.purchase_amount is None and payload.fixed_points is None:
        raise HTTPException(
            status_code=400,
            detail="Provide either purchase_amount or fixed_points.",
        )

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch active merchant points conversion rate
            cur.execute(
                """
                SELECT points_per_euro
                FROM merchants
                WHERE id = %s AND is_active = TRUE
                """,
                (str(payload.merchant_id),),
            )
            merchant_row = cur.fetchone()
            if not merchant_row:
                raise HTTPException(status_code=404, detail="Active merchant not found.")

            points_per_euro = Decimal(str(merchant_row[0]))

            # Look up customer via static QR identifier
            cur.execute(
                """
                SELECT id, full_name
                FROM users
                WHERE static_qr_code = %s AND role = 'CUSTOMER'
                """,
                (payload.static_qr_code.strip(),),
            )
            customer_row = cur.fetchone()
            if not customer_row:
                raise HTTPException(status_code=404, detail="Customer QR not found.")

            customer_id, customer_name = customer_row[0], customer_row[1]

            # Compute points earned from fixed points or euro spend
            if payload.fixed_points is not None:
                points_earned = payload.fixed_points
            else:
                points_earned = math.floor(payload.purchase_amount * points_per_euro)

            if points_earned <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="Calculated points must be greater than zero.",
                )

            # Create or increment customer's points balance for this merchant
            cur.execute(
                """
                INSERT INTO customer_merchant_wallets (
                    customer_id, merchant_id, points_balance, last_visit_at, updated_at
                )
                VALUES (%s, %s, %s, NOW(), NOW())
                ON CONFLICT (customer_id, merchant_id)
                DO UPDATE SET
                    points_balance = customer_merchant_wallets.points_balance + EXCLUDED.points_balance,
                    last_visit_at = NOW(),
                    updated_at = NOW()
                RETURNING points_balance
                """,
                (str(customer_id), str(payload.merchant_id), points_earned),
            )
            new_balance = cur.fetchone()[0]

            # Append earning record to transaction ledger
            cur.execute(
                """
                INSERT INTO transactions (
                    customer_id, merchant_id, type, points_delta, purchase_amount
                )
                VALUES (%s, %s, 'EARN', %s, %s)
                RETURNING id, created_at
                """,
                (
                    str(customer_id),
                    str(payload.merchant_id),
                    points_earned,
                    payload.purchase_amount,
                ),
            )
            tx_id, created_at = cur.fetchone()

    return {
        "transaction_id": str(tx_id),
        "customer_id": str(customer_id),
        "customer_name": customer_name,
        "merchant_id": str(payload.merchant_id),
        "points_awarded": points_earned,
        "new_balance": new_balance,
        "created_at": created_at,
    }


@router.get("/customer/{customer_id}/redeem/active", status_code=status.HTTP_200_OK)
def get_active_redemption_code(customer_id: UUID):
    now = datetime.now(timezone.utc)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch latest unexpired PENDING redemption code for this customer
            cur.execute(
                """
                SELECT
                    rc.id,
                    rc.reward_id,
                    r.title,
                    r.points_required,
                    rc.qr_token,
                    rc.six_digit_code,
                    rc.status,
                    rc.expires_at,
                    rc.created_at
                FROM redemption_codes rc
                JOIN rewards r ON r.id = rc.reward_id
                WHERE rc.customer_id = %s
                  AND rc.status = 'PENDING'
                  AND rc.expires_at > %s
                ORDER BY rc.created_at DESC
                LIMIT 1
                """,
                (str(customer_id), now),
            )
            row = cur.fetchone()

    if not row:
        return {"active_redemption": None}

    return {
        "active_redemption": {
            "redemption_id": str(row[0]),
            "reward_id": str(row[1]),
            "reward_title": row[2],
            "points_required": row[3],
            "qr_token": row[4],
            "six_digit_code": row[5],
            "status": row[6],
            "expires_at": row[7],
            "created_at": row[8],
        }
    }


@router.post("/customer/redeem/generate", status_code=status.HTTP_201_CREATED)
def generate_redemption_code(payload: GenerateRedemptionRequest):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify reward belongs to the merchant and is active
            cur.execute(
                """
                SELECT title, points_required
                FROM rewards
                WHERE id = %s AND merchant_id = %s AND is_active = TRUE
                """,
                (str(payload.reward_id), str(payload.merchant_id)),
            )
            reward_row = cur.fetchone()
            if not reward_row:
                raise HTTPException(status_code=404, detail="Active reward not found.")

            reward_title, points_required = reward_row[0], reward_row[1]

            # Verify customer has enough points at this merchant
            cur.execute(
                """
                SELECT points_balance
                FROM customer_merchant_wallets
                WHERE customer_id = %s AND merchant_id = %s
                """,
                (str(payload.customer_id), str(payload.merchant_id)),
            )
            wallet_row = cur.fetchone()
            current_balance = wallet_row[0] if wallet_row else 0

            if current_balance < points_required:
                raise HTTPException(
                    status_code=400,
                    detail="Insufficient points for this reward.",
                )

            # Generate unique dynamic QR token and 6-digit code valid for 10 minutes
            qr_token = f"RDM-{secrets.token_urlsafe(18)}"
            six_digit_code = f"{secrets.randbelow(900000) + 100000:06d}"
            expires_at = datetime.now(timezone.utc) + timedelta(
                minutes=REDEMPTION_TTL_MINUTES
            )

            cur.execute(
                """
                INSERT INTO redemption_codes (
                    customer_id, merchant_id, reward_id, qr_token, six_digit_code, expires_at
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, status, created_at
                """,
                (
                    str(payload.customer_id),
                    str(payload.merchant_id),
                    str(payload.reward_id),
                    qr_token,
                    six_digit_code,
                    expires_at,
                ),
            )
            code_id, code_status, created_at = cur.fetchone()

    return {
        "redemption_id": str(code_id),
        "reward_id": str(payload.reward_id),
        "reward_title": reward_title,
        "points_required": points_required,
        "qr_token": qr_token,
        "six_digit_code": six_digit_code,
        "status": code_status,
        "expires_at": expires_at,
        "created_at": created_at,
    }


@router.post("/merchant/redeem/confirm", status_code=status.HTTP_200_OK)
def confirm_redemption(payload: ConfirmRedemptionRequest):
    if not payload.qr_token and not payload.six_digit_code:
        raise HTTPException(
            status_code=400,
            detail="Provide either qr_token or six_digit_code.",
        )

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Lock target redemption record to avoid double redemption
            if payload.qr_token:
                cur.execute(
                    """
                    SELECT id, customer_id, reward_id, status, expires_at
                    FROM redemption_codes
                    WHERE merchant_id = %s AND qr_token = %s
                    FOR UPDATE
                    """,
                    (str(payload.merchant_id), payload.qr_token.strip()),
                )
            else:
                cur.execute(
                    """
                    SELECT id, customer_id, reward_id, status, expires_at
                    FROM redemption_codes
                    WHERE merchant_id = %s AND six_digit_code = %s AND status = 'PENDING'
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (str(payload.merchant_id), payload.six_digit_code.strip()),
                )

            redemption_row = cur.fetchone()
            if not redemption_row:
                raise HTTPException(status_code=404, detail="Redemption code not found.")

            redemption_id, customer_id, reward_id, code_status, expires_at = redemption_row
            now = datetime.now(timezone.utc)

            if code_status != "PENDING":
                raise HTTPException(
                    status_code=409,
                    detail=f"Redemption code is already {code_status}.",
                )

            if expires_at <= now:
                # Mark expired redemption code for audit trail
                cur.execute(
                    """
                    UPDATE redemption_codes
                    SET status = 'EXPIRED'
                    WHERE id = %s
                    """,
                    (str(redemption_id),),
                )
                raise HTTPException(
                    status_code=410,
                    detail="Redemption code has expired.",
                )

            # Fetch reward points requirement
            cur.execute(
                """
                SELECT title, points_required
                FROM rewards
                WHERE id = %s
                """,
                (str(reward_id),),
            )
            reward_row = cur.fetchone()
            if not reward_row:
                raise HTTPException(status_code=404, detail="Reward not found.")

            reward_title, points_required = reward_row[0], reward_row[1]

            # Lock customer wallet row before deducting points
            cur.execute(
                """
                SELECT points_balance
                FROM customer_merchant_wallets
                WHERE customer_id = %s AND merchant_id = %s
                FOR UPDATE
                """,
                (str(customer_id), str(payload.merchant_id)),
            )
            wallet_row = cur.fetchone()
            current_balance = wallet_row[0] if wallet_row else 0

            if current_balance < points_required:
                raise HTTPException(
                    status_code=400,
                    detail="Customer has insufficient points.",
                )

            new_balance = current_balance - points_required

            # Deduct points and refresh last visit timestamp
            cur.execute(
                """
                UPDATE customer_merchant_wallets
                SET points_balance = %s, last_visit_at = NOW(), updated_at = NOW()
                WHERE customer_id = %s AND merchant_id = %s
                """,
                (new_balance, str(customer_id), str(payload.merchant_id)),
            )

            # Insert negative points movement in transactions ledger
            cur.execute(
                """
                INSERT INTO transactions (
                    customer_id, merchant_id, type, points_delta, reward_id
                )
                VALUES (%s, %s, 'REDEEM', %s, %s)
                RETURNING id
                """,
                (
                    str(customer_id),
                    str(payload.merchant_id),
                    -points_required,
                    str(reward_id),
                ),
            )
            tx_id = cur.fetchone()[0]

            # Mark redemption code as used
            cur.execute(
                """
                UPDATE redemption_codes
                SET status = 'USED', used_at = NOW()
                WHERE id = %s
                """,
                (str(redemption_id),),
            )

    return {
        "status": "REDEEMED",
        "transaction_id": str(tx_id),
        "redemption_id": str(redemption_id),
        "reward_title": reward_title,
        "points_deducted": points_required,
        "new_balance": new_balance,
    }
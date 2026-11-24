from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.core.database import get_db_connection

router = APIRouter(prefix="/customer", tags=["Customer"])


@router.get("/{customer_id}/profile", status_code=status.HTTP_200_OK)
def get_customer_profile(customer_id: UUID):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch customer details including static QR code
            cur.execute(
                """
                SELECT id, full_name, email, phone, static_qr_code, notifications_enabled, created_at
                FROM users
                WHERE id = %s AND role = 'CUSTOMER'
                """,
                (str(customer_id),),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Customer not found.")

    return {
        "customer_id": str(row[0]),
        "full_name": row[1],
        "email": row[2],
        "phone": row[3],
        "static_qr_code": row[4],
        "notifications_enabled": row[5],
        "created_at": row[6],
    }


@router.get("/{customer_id}/wallets", status_code=status.HTTP_200_OK)
def get_customer_wallets(customer_id: UUID):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify customer exists
            cur.execute(
                """
                SELECT id
                FROM users
                WHERE id = %s AND role = 'CUSTOMER'
                """,
                (str(customer_id),),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Customer not found.")

            # Fetch wallets joined with merchant metadata
            cur.execute(
                """
                SELECT
                    w.merchant_id,
                    m.name,
                    m.category,
                    m.points_per_euro,
                    w.points_balance,
                    w.last_visit_at
                FROM customer_merchant_wallets w
                JOIN merchants m ON m.id = w.merchant_id
                WHERE w.customer_id = %s AND m.is_active = TRUE
                ORDER BY w.updated_at DESC
                """,
                (str(customer_id),),
            )
            wallet_rows = cur.fetchall()

            wallets = []
            for w in wallet_rows:
                merchant_id = str(w[0])
                balance = w[4]

                # Fetch active rewards for this merchant and flag redeemable ones
                cur.execute(
                    """
                    SELECT id, title, points_required
                    FROM rewards
                    WHERE merchant_id = %s AND is_active = TRUE
                    ORDER BY points_required ASC
                    """,
                    (merchant_id,),
                )
                rewards = [
                    {
                        "reward_id": str(r[0]),
                        "title": r[1],
                        "points_required": r[2],
                        "can_redeem": balance >= r[2],
                    }
                    for r in cur.fetchall()
                ]

                wallets.append(
                    {
                        "merchant_id": merchant_id,
                        "merchant_name": w[1],
                        "category": w[2],
                        "points_per_euro": float(w[3]),
                        "points_balance": balance,
                        "last_visit_at": w[5],
                        "rewards": rewards,
                    }
                )

    return {
        "customer_id": str(customer_id),
        "wallets": wallets,
    }


@router.get("/{customer_id}/transactions", status_code=status.HTTP_200_OK)
def get_customer_transactions(customer_id: UUID, limit: int = 20):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch customer transaction history with merchant names
            cur.execute(
                """
                SELECT
                    t.id,
                    t.merchant_id,
                    m.name,
                    t.type,
                    t.points_delta,
                    t.purchase_amount,
                    t.reward_id,
                    t.created_at
                FROM transactions t
                JOIN merchants m ON m.id = t.merchant_id
                WHERE t.customer_id = %s
                ORDER BY t.created_at DESC
                LIMIT %s
                """,
                (str(customer_id), limit),
            )
            rows = cur.fetchall()

    return {
        "customer_id": str(customer_id),
        "transactions": [
            {
                "transaction_id": str(r[0]),
                "merchant_id": str(r[1]),
                "merchant_name": r[2],
                "type": r[3],
                "points_delta": r[4],
                "purchase_amount": float(r[5]) if r[5] is not None else None,
                "reward_id": str(r[6]) if r[6] is not None else None,
                "created_at": r[7],
            }
            for r in rows
        ],
    }
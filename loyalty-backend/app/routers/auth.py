import hashlib
import hmac
import secrets
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

from app.core.database import get_db_connection

router = APIRouter(prefix="/auth", tags=["Auth"])


def hash_password(password: str) -> str:
    # Generate a salted PBKDF2-HMAC-SHA256 password hash
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    # Verify plain password against stored "salt$digest" hash in constant time
    try:
        salt, expected_digest = stored_hash.split("$", 1)
    except ValueError:
        return False

    actual_digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    ).hex()
    return hmac.compare_digest(actual_digest, expected_digest)


class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=5, max_length=180)
    phone: str | None = Field(default=None, max_length=30)
    password: str = Field(..., min_length=6)
    role: Literal["CUSTOMER", "MERCHANT"]

    # Required only when role == "MERCHANT"
    business_name: str | None = Field(default=None, min_length=2, max_length=150)
    business_category: str | None = Field(default=None, max_length=80)
    points_per_euro: Decimal = Field(default=Decimal("10.00"), gt=0)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=180)
    password: str = Field(..., min_length=6)


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest):
    # Validate merchant-specific fields if role is MERCHANT
    if payload.role == "MERCHANT" and not payload.business_name:
        raise HTTPException(
            status_code=400,
            detail="business_name is required when registering as MERCHANT.",
        )

    # Generate unique static QR identifier only for CUSTOMER accounts
    static_qr = f"USR-{secrets.token_hex(8).upper()}" if payload.role == "CUSTOMER" else None
    password_hash = hash_password(payload.password)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # Insert user record
                cur.execute(
                    """
                    INSERT INTO users (
                        full_name, email, phone, password_hash, role, static_qr_code
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id, full_name, email, role, static_qr_code, created_at
                    """,
                    (
                        payload.full_name,
                        payload.email.lower().strip(),
                        payload.phone,
                        password_hash,
                        payload.role,
                        static_qr,
                    ),
                )
                user_row = cur.fetchone()
                user_id = user_row[0]

                merchant_data = None
                # Create linked merchant profile if user registered as MERCHANT
                if payload.role == "MERCHANT":
                    cur.execute(
                        """
                        INSERT INTO merchants (
                            owner_id, name, category, points_per_euro
                        )
                        VALUES (%s, %s, %s, %s)
                        RETURNING id, name, category, points_per_euro
                        """,
                        (
                            str(user_id),
                            payload.business_name,
                            payload.business_category,
                            payload.points_per_euro,
                        ),
                    )
                    m_row = cur.fetchone()
                    merchant_data = {
                        "merchant_id": str(m_row[0]),
                        "name": m_row[1],
                        "category": m_row[2],
                        "points_per_euro": float(m_row[3]),
                    }

    except UniqueViolation:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    return {
        "user_id": str(user_row[0]),
        "full_name": user_row[1],
        "email": user_row[2],
        "role": user_row[3],
        "static_qr_code": user_row[4],
        "merchant": merchant_data,
        "created_at": user_row[5],
    }


@router.post("/login", status_code=status.HTTP_200_OK)
def login_user(payload: LoginRequest):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Fetch user by normalized email
            cur.execute(
                """
                SELECT id, full_name, email, password_hash, role, static_qr_code
                FROM users
                WHERE email = %s
                """,
                (payload.email.lower().strip(),),
            )
            user_row = cur.fetchone()

            if not user_row or not verify_password(payload.password, user_row[3]):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password.",
                )

            user_id, full_name, email, _, role, static_qr = user_row
            merchant_data = None

            # Include linked merchant info when logging in as MERCHANT
            if role == "MERCHANT":
                cur.execute(
                    """
                    SELECT id, name, category, points_per_euro
                    FROM merchants
                    WHERE owner_id = %s
                    """,
                    (str(user_id),),
                )
                m_row = cur.fetchone()
                if m_row:
                    merchant_data = {
                        "merchant_id": str(m_row[0]),
                        "name": m_row[1],
                        "category": m_row[2],
                        "points_per_euro": float(m_row[3]),
                    }

    return {
        "user_id": str(user_id),
        "full_name": full_name,
        "email": email,
        "role": role,
        "static_qr_code": static_qr,
        "merchant": merchant_data,
    }
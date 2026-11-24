CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table for both customers and merchant owners/cashiers
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    phone VARCHAR(30),
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('CUSTOMER', 'MERCHANT')),
    static_qr_code VARCHAR(100) UNIQUE, -- Used for CUSTOMER accounts (e.g. "USR-9F8A2C...")
    fcm_token TEXT,
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Participating merchants and their loyalty/inactivity rules
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(80),
    points_per_euro NUMERIC(6, 2) NOT NULL DEFAULT 10.00, -- e.g. 1 EUR = 10 points
    inactivity_days_trigger INT NOT NULL DEFAULT 14,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rewards catalog per merchant so each store can offer multiple rewards
CREATE TABLE rewards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL, -- e.g. "1 Free Coffee"
    points_required INT NOT NULL CHECK (points_required > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-customer, per-merchant points wallet and inactivity tracking
CREATE TABLE customer_merchant_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    points_balance INT NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
    last_visit_at TIMESTAMPTZ,
    last_nudge_sent_at TIMESTAMPTZ, -- Tracks when the last smart win-back notification was sent
    last_nudge_template_key VARCHAR(60), -- Avoids repeating the exact same message template back-to-back
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, merchant_id)
);

-- Immutable ledger of point earnings and reward redemptions
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('EARN', 'REDEEM')),
    points_delta INT NOT NULL, -- Positive for EARN, negative for REDEEM
    purchase_amount NUMERIC(10, 2),
    reward_id UUID REFERENCES rewards(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Short-lived dynamic QR tokens and 6-digit codes (valid for 10 minutes) for reward redemption
CREATE TABLE redemption_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
    qr_token VARCHAR(120) UNIQUE NOT NULL,
    six_digit_code CHAR(6) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'USED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_redemption_qr_token ON redemption_codes(qr_token);
CREATE INDEX idx_redemption_six_digit ON redemption_codes(merchant_id, six_digit_code, status);
CREATE INDEX idx_wallets_last_visit ON customer_merchant_wallets(last_visit_at);
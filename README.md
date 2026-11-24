# B2B2C Loyalty Platform

A full-stack B2B2C digital loyalty application connecting local merchants and customers through a single mobile app with role-based routing (`CUSTOMER` and `MERCHANT`), backed by a Python FastAPI API and PostgreSQL.

## Features

- **Role-Based Mobile Experience:** Single React Native (Expo) client routing users to `CustomerHomeScreen` or `MerchantHomeScreen` based on account role.
- **Per-Merchant Point Wallets:** Customers earn and track points independently per participating merchant (`customer_merchant_wallets`), with full transaction ledger history (`EARN` and `REDEEM`).
- **Static QR Point Earning:** Customers present a static identifier (`USR-...`) at checkout while merchants award points from purchase amounts or fixed point values (`POST /merchant/points/award`).
- **Dynamic QR & 6-Digit PIN Redemptions:** Customers generate time-limited redemption credentials (`RDM-...` token + 6-digit PIN) with server-backed active state persistence (`GET /customer/{customer_id}/redeem/active`) across reloads and sessions.
- **Merchant Redemption Confirmation:** Merchants verify and confirm redemptions via 6-digit PIN or dynamic QR token (`POST /merchant/redeem/confirm`) with row-level locking to prevent double redemptions.
- **Merchant Reward Management:** Full reward lifecycle management (`POST /merchant/rewards`, `PATCH /merchant/rewards/{reward_id}`, `DELETE /merchant/rewards/{reward_id}`), including safe deactivation when a reward is referenced by historical records.

## Tech Stack

- **Mobile App:** React Native, Expo, TypeScript
- **Backend API:** Python, FastAPI, Pydantic
- **Database:** PostgreSQL

## Key API Endpoints

- `POST /auth/register` & `POST /auth/login` — User registration and authentication
- `GET /customer/{customer_id}/profile` & `GET /customer/{customer_id}/wallets` — Customer profile and per-merchant wallets/rewards
- `POST /customer/redeem/generate` & `GET /customer/{customer_id}/redeem/active` — Generate and retrieve active pending redemptions
- `GET /merchant/{merchant_id}/dashboard`, `/rewards`, `/transactions` — Merchant analytics, reward catalog, and ledger
- `POST /merchant/points/award` — Award loyalty points to a customer
- `POST /merchant/redeem/confirm` — Confirm a pending redemption and deduct wallet points
- `POST /merchant/rewards`, `PATCH /merchant/rewards/{reward_id}`, `DELETE /merchant/rewards/{reward_id}` — Create, update, and delete/deactivate rewards

## Local Development Setup

### 1. Backend (FastAPI + PostgreSQL)

1. Ensure PostgreSQL is running and create the database schema.
2. Configure database connection environment variables in your backend `.env` file.
3. Install Python dependencies and start the server:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

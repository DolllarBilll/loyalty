import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { apiRequest } from "../config/api";

interface CustomerProfileResponse {
  customer_id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  static_qr_code?: string | null;
}

interface RewardSummary {
  reward_id: string;
  title: string;
  points_required: number;
  can_redeem: boolean;
}

interface WalletItem {
  merchant_id: string;
  merchant_name: string;
  category?: string | null;
  points_per_euro?: number;
  points_balance: number;
  last_visit_at?: string | null;
  rewards?: RewardSummary[];
}

interface WalletsResponse {
  customer_id: string;
  wallets: WalletItem[];
}

interface GenerateRedemptionResponse {
  redemption_id: string;
  reward_id: string;
  reward_title: string;
  points_required: number;
  qr_token: string;
  six_digit_code: string;
  status: string;
  expires_at: string;
}

interface ActiveRedemptionResponse {
  active_redemption: GenerateRedemptionResponse | null;
}

interface CustomerHomeScreenProps {
  customerId: string;
  fullName?: string;
  email: string;
  onLogout: () => void;
}

export default function CustomerHomeScreen({
  customerId,
  fullName,
  email,
  onLogout,
}: CustomerHomeScreenProps) {
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [staticQrCode, setStaticQrCode] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | undefined>(fullName);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State for generating and persisting dynamic redemption QR token and 6-digit PIN
  const [redeemingRewardId, setRedeemingRewardId] = useState<string | null>(
    null
  );
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [activeRedemption, setActiveRedemption] =
    useState<GenerateRedemptionResponse | null>(null);

  const loadCustomerData = useCallback(async () => {
    setErrorMsg(null);
    try {
      // Fetch customer profile, merchant wallets, and any active pending redemption in parallel
      const [profileRes, walletsRes, activeRedeemRes] = await Promise.all([
        apiRequest<CustomerProfileResponse>(`/customer/${customerId}/profile`),
        apiRequest<WalletsResponse>(`/customer/${customerId}/wallets`),
        apiRequest<ActiveRedemptionResponse>(
          `/customer/${customerId}/redeem/active`
        ),
      ]);

      setStaticQrCode(profileRes.static_qr_code ?? null);
      if (profileRes.full_name) {
        setResolvedName(profileRes.full_name);
      }
      setWallets(walletsRes.wallets ?? []);
      setActiveRedemption(activeRedeemRes.active_redemption ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load customer data.";
      setErrorMsg(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadCustomerData();
  }, [loadCustomerData]);

  function handleRefresh() {
    setRefreshing(true);
    loadCustomerData();
  }

  async function handleGenerateRedemption(
    merchantId: string,
    rewardId: string
  ) {
    setRedeemError(null);
    setRedeemingRewardId(rewardId);

    try {
      // Request a time-limited dynamic QR token and 6-digit PIN from backend
      const res = await apiRequest<GenerateRedemptionResponse>(
        "/customer/redeem/generate",
        {
          method: "POST",
          body: JSON.stringify({
            customer_id: customerId,
            merchant_id: merchantId,
            reward_id: rewardId,
          }),
        }
      );

      setActiveRedemption(res);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to generate redemption code.";
      setRedeemError(message);
    } finally {
      setRedeemingRewardId(null);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextCol}>
          <Text style={styles.greeting}>
            Hello, {resolvedName?.trim() || "Customer"}
          </Text>
          <Text style={styles.subEmail}>{email}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>
      </View>

      {/* Active dynamic redemption PIN and QR token card */}
      {activeRedemption ? (
        <View style={styles.redemptionCard}>
          <View style={styles.redemptionHeader}>
            <Text style={styles.redemptionTitle}>Redemption Code Ready</Text>
            <TouchableOpacity onPress={() => setActiveRedemption(null)}>
              <Text style={styles.clearBtnText}>Hide</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.redemptionReward}>
            {activeRedemption.reward_title} ({activeRedemption.points_required}{" "}
            pts)
          </Text>

          <Text style={styles.pinLabel}>6-Digit PIN</Text>
          <Text style={styles.pinCode} selectable>
            {activeRedemption.six_digit_code}
          </Text>

          <Text style={styles.qrLabel}>Dynamic QR Token</Text>
          <View style={styles.dynamicQrBox}>
            <Text style={styles.dynamicQrText} selectable>
              {activeRedemption.qr_token}
            </Text>
          </View>

          <Text style={styles.expiryText}>
            Expires: {new Date(activeRedemption.expires_at).toLocaleTimeString()}
          </Text>
        </View>
      ) : null}

      {/* Static QR token card shown at checkout to earn points */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>My Loyalty QR Code</Text>
        <Text style={styles.helperText}>
          Show this code at the counter to collect points:
        </Text>
        <View style={styles.qrTokenBox}>
          {loading ? (
            <ActivityIndicator color="#059669" />
          ) : (
            <Text style={styles.qrTokenText} selectable>
              {staticQrCode ?? "No QR token available"}
            </Text>
          )}
        </View>
      </View>

      {/* Merchant-specific point wallets and available rewards */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>My Merchant Cards</Text>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
        {redeemError ? <Text style={styles.errorText}>{redeemError}</Text> : null}

        {loading ? (
          <ActivityIndicator color="#059669" style={{ marginVertical: 16 }} />
        ) : wallets.length === 0 ? (
          <Text style={styles.emptyText}>
            You do not have any points yet. Visit a participating store to start
            collecting!
          </Text>
        ) : (
          wallets.map((w) => (
            <View key={w.merchant_id} style={styles.walletBlock}>
              <View style={styles.walletRow}>
                <View style={styles.walletInfo}>
                  <Text style={styles.merchantName}>{w.merchant_name}</Text>
                  {w.category ? (
                    <Text style={styles.merchantCategory}>{w.category}</Text>
                  ) : null}
                </View>
                <View style={styles.pointsBadge}>
                  <Text style={styles.pointsValue}>{w.points_balance}</Text>
                  <Text style={styles.pointsLabel}>pts</Text>
                </View>
              </View>

              {w.rewards && w.rewards.length > 0 ? (
                <View style={styles.rewardsList}>
                  {w.rewards.map((r) => {
                    const isBusy = redeemingRewardId === r.reward_id;
                    return (
                      <View key={r.reward_id} style={styles.rewardRow}>
                        <Text
                          style={[
                            styles.rewardItem,
                            r.can_redeem && styles.rewardReady,
                          ]}
                        >
                          {r.can_redeem ? "✓ " : "• "}
                          {r.title} ({r.points_required} pts)
                        </Text>

                        {r.can_redeem ? (
                          <TouchableOpacity
                            style={styles.redeemBtn}
                            onPress={() =>
                              handleGenerateRedemption(w.merchant_id, r.reward_id)
                            }
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.redeemBtnText}>Redeem</Text>
                            )}
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 20,
    paddingTop: 28,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingRight: 28,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 10,
  },
  greeting: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  subEmail: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  redemptionCard: {
    backgroundColor: "#ecfdf5",
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#10b981",
  },
  redemptionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  redemptionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#065f46",
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#047857",
  },
  redemptionReward: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 12,
  },
  pinLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#047857",
    marginBottom: 4,
  },
  pinCode: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 6,
    color: "#065f46",
    marginBottom: 12,
  },
  qrLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#047857",
    marginBottom: 4,
  },
  dynamicQrBox: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#a7f3d0",
    marginBottom: 8,
  },
  dynamicQrText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  expiryText: {
    fontSize: 12,
    color: "#047857",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#059669",
    marginBottom: 8,
  },
  helperText: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
  },
  qrTokenBox: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  qrTokenText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
  },
  walletBlock: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  walletRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  walletInfo: {
    flex: 1,
    paddingRight: 12,
  },
  merchantName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  merchantCategory: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  pointsBadge: {
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: "center",
    minWidth: 64,
  },
  pointsValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#059669",
  },
  pointsLabel: {
    fontSize: 11,
    color: "#047857",
  },
  rewardsList: {
    marginTop: 10,
    paddingLeft: 4,
  },
  rewardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  rewardItem: {
    fontSize: 13,
    color: "#6b7280",
    flex: 1,
    paddingRight: 8,
  },
  rewardReady: {
    color: "#059669",
    fontWeight: "600",
  },
  redeemBtn: {
    backgroundColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 72,
    alignItems: "center",
  },
  redeemBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
});
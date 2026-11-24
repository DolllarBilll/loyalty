import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { apiRequest } from "../config/api";

interface MerchantStats {
  unique_customers: number;
  total_points_awarded: number;
  total_points_redeemed: number;
  total_transactions: number;
}

interface MerchantDashboardResponse {
  merchant_id: string;
  name: string;
  category?: string | null;
  points_per_euro: number;
  inactivity_days_trigger: number;
  is_active: boolean;
  stats: MerchantStats;
}

interface MerchantRewardItem {
  reward_id: string;
  title: string;
  points_required: number;
  is_active: boolean;
}

interface MerchantRewardsResponse {
  merchant_id: string;
  rewards: MerchantRewardItem[];
}

interface MerchantTransactionItem {
  transaction_id: string;
  customer_name: string;
  type: "EARN" | "REDEEM" | string;
  points_delta: number;
  purchase_amount?: number | null;
  created_at: string;
}

interface MerchantTransactionsResponse {
  merchant_id: string;
  transactions: MerchantTransactionItem[];
}

interface AwardPointsResponse {
  points_awarded?: number;
  new_balance?: number;
  message?: string;
}

interface ConfirmRedemptionResponse {
  status: string;
  reward_title?: string;
  points_deducted?: number;
  new_balance?: number;
}

interface DeleteRewardResponse {
  deleted: boolean;
  deactivated: boolean;
  reward_id: string;
  detail?: string;
}

interface MerchantHomeScreenProps {
  merchantId: string;
  fullName?: string;
  email: string;
  onLogout: () => void;
}

export default function MerchantHomeScreen({
  merchantId,
  fullName,
  email,
  onLogout,
}: MerchantHomeScreenProps) {
  const [dashboard, setDashboard] = useState<MerchantDashboardResponse | null>(
    null
  );
  const [rewards, setRewards] = useState<MerchantRewardItem[]>([]);
  const [transactions, setTransactions] = useState<MerchantTransactionItem[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State for awarding points via customer static QR code
  const [staticQrCode, setStaticQrCode] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [awarding, setAwarding] = useState(false);
  const [awardFeedback, setAwardFeedback] = useState<string | null>(null);
  const [awardError, setAwardError] = useState<string | null>(null);

  // State for confirming customer redemptions via 6-digit PIN or dynamic QR token
  const [redemptionCodeInput, setRedemptionCodeInput] = useState("");
  const [confirmingRedeem, setConfirmingRedeem] = useState(false);
  const [redeemConfirmFeedback, setRedeemConfirmFeedback] = useState<
    string | null
  >(null);
  const [redeemConfirmError, setRedeemConfirmError] = useState<string | null>(
    null
  );

  // State for creating a new reward
  const [newRewardTitle, setNewRewardTitle] = useState("");
  const [newRewardPoints, setNewRewardPoints] = useState("");
  const [creatingReward, setCreatingReward] = useState(false);
  const [rewardFeedback, setRewardFeedback] = useState<string | null>(null);
  const [rewardError, setRewardError] = useState<string | null>(null);

  // State for inline editing and deleting existing rewards
  const [editingRewardId, setEditingRewardId] = useState<string | null>(null);
  const [editRewardTitle, setEditRewardTitle] = useState("");
  const [editRewardPoints, setEditRewardPoints] = useState("");
  const [editRewardActive, setEditRewardActive] = useState(true);
  const [savingRewardId, setSavingRewardId] = useState<string | null>(null);
  const [deletingRewardId, setDeletingRewardId] = useState<string | null>(null);

  const loadMerchantData = useCallback(async () => {
    setErrorMsg(null);
    if (!merchantId) {
      setErrorMsg("No merchant_id linked to this user account.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // Load merchant dashboard, rewards catalog, and recent transactions in parallel
      const [dashRes, rewardsRes, txRes] = await Promise.all([
        apiRequest<MerchantDashboardResponse>(
          `/merchant/${merchantId}/dashboard`
        ),
        apiRequest<MerchantRewardsResponse>(`/merchant/${merchantId}/rewards`),
        apiRequest<MerchantTransactionsResponse>(
          `/merchant/${merchantId}/transactions?limit=10`
        ),
      ]);

      setDashboard(dashRes);
      setRewards(rewardsRes.rewards ?? []);
      setTransactions(txRes.transactions ?? []);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load merchant data.";
      setErrorMsg(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [merchantId]);

  useEffect(() => {
    loadMerchantData();
  }, [loadMerchantData]);

  function handleRefresh() {
    setRefreshing(true);
    loadMerchantData();
  }

  async function handleAwardPoints() {
    setAwardError(null);
    setAwardFeedback(null);

    const parsedAmount = Number(purchaseAmount.replace(",", "."));
    if (!staticQrCode.trim()) {
      setAwardError("Please enter the customer's static QR code (e.g. USR-...).");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setAwardError("Please enter a valid purchase amount greater than 0.");
      return;
    }

    setAwarding(true);
    try {
      // Send static_qr_code to match backend AwardPointsRequest schema
      const res = await apiRequest<AwardPointsResponse>(
        "/merchant/points/award",
        {
          method: "POST",
          body: JSON.stringify({
            merchant_id: merchantId,
            static_qr_code: staticQrCode.trim(),
            purchase_amount: parsedAmount,
          }),
        }
      );

      setPurchaseAmount("");
      setAwardFeedback(
        res.message ??
          `Points awarded! ${
            res.points_awarded !== undefined ? `+${res.points_awarded} pts` : ""
          }${res.new_balance !== undefined ? ` (New balance: ${res.new_balance})` : ""}`
      );
      await loadMerchantData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to award points.";
      setAwardError(message);
    } finally {
      setAwarding(false);
    }
  }

  async function handleConfirmRedemption() {
    setRedeemConfirmError(null);
    setRedeemConfirmFeedback(null);

    const trimmed = redemptionCodeInput.trim();
    if (!trimmed) {
      setRedeemConfirmError(
        "Please enter a 6-digit PIN or dynamic QR token (RDM-...)."
      );
      return;
    }

    // Route 6-digit numeric PINs to six_digit_code and tokens to qr_token
    const isSixDigitPin = /^\d{6}$/.test(trimmed);
    const bodyPayload: Record<string, string> = {
      merchant_id: merchantId,
    };
    if (isSixDigitPin) {
      bodyPayload.six_digit_code = trimmed;
    } else {
      bodyPayload.qr_token = trimmed;
    }

    setConfirmingRedeem(true);
    try {
      const res = await apiRequest<ConfirmRedemptionResponse>(
        "/merchant/redeem/confirm",
        {
          method: "POST",
          body: JSON.stringify(bodyPayload),
        }
      );

      setRedemptionCodeInput("");
      setRedeemConfirmFeedback(
        `Redeemed ${res.reward_title ?? "reward"} (${
          res.points_deducted !== undefined ? `-${res.points_deducted} pts` : "OK"
        })${res.new_balance !== undefined ? ` — New balance: ${res.new_balance}` : ""}`
      );
      await loadMerchantData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to confirm redemption.";
      setRedeemConfirmError(message);
    } finally {
      setConfirmingRedeem(false);
    }
  }

  async function handleCreateReward() {
    setRewardError(null);
    setRewardFeedback(null);

    const trimmedTitle = newRewardTitle.trim();
    const parsedPoints = parseInt(newRewardPoints.trim(), 10);

    if (trimmedTitle.length < 2) {
      setRewardError("Reward title must be at least 2 characters.");
      return;
    }
    if (!Number.isInteger(parsedPoints) || parsedPoints <= 0) {
      setRewardError("Points required must be a positive whole number.");
      return;
    }

    setCreatingReward(true);
    try {
      await apiRequest("/merchant/rewards", {
        method: "POST",
        body: JSON.stringify({
          merchant_id: merchantId,
          title: trimmedTitle,
          points_required: parsedPoints,
        }),
      });

      setNewRewardTitle("");
      setNewRewardPoints("");
      setRewardFeedback(`Added reward "${trimmedTitle}" (${parsedPoints} pts).`);
      await loadMerchantData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create reward.";
      setRewardError(message);
    } finally {
      setCreatingReward(false);
    }
  }

  function startEditingReward(reward: MerchantRewardItem) {
    setRewardError(null);
    setRewardFeedback(null);
    setEditingRewardId(reward.reward_id);
    setEditRewardTitle(reward.title);
    setEditRewardPoints(String(reward.points_required));
    setEditRewardActive(reward.is_active);
  }

  function cancelEditingReward() {
    setEditingRewardId(null);
    setEditRewardTitle("");
    setEditRewardPoints("");
  }

  async function handleSaveRewardEdit(rewardId: string) {
    setRewardError(null);
    setRewardFeedback(null);

    const trimmedTitle = editRewardTitle.trim();
    const parsedPoints = parseInt(editRewardPoints.trim(), 10);

    if (trimmedTitle.length < 2) {
      setRewardError("Reward title must be at least 2 characters.");
      return;
    }
    if (!Number.isInteger(parsedPoints) || parsedPoints <= 0) {
      setRewardError("Points required must be a positive whole number.");
      return;
    }

    setSavingRewardId(rewardId);
    try {
      await apiRequest(`/merchant/rewards/${rewardId}`, {
        method: "PATCH",
        body: JSON.stringify({
          merchant_id: merchantId,
          title: trimmedTitle,
          points_required: parsedPoints,
          is_active: editRewardActive,
        }),
      });

      setEditingRewardId(null);
      setRewardFeedback(`Updated reward "${trimmedTitle}".`);
      await loadMerchantData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update reward.";
      setRewardError(message);
    } finally {
      setSavingRewardId(null);
    }
  }

  function confirmDeleteReward(reward: MerchantRewardItem) {
    Alert.alert(
      "Delete Reward",
      `Are you sure you want to delete "${reward.title}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => executeDeleteReward(reward),
        },
      ]
    );
  }

  async function executeDeleteReward(reward: MerchantRewardItem) {
    setRewardError(null);
    setRewardFeedback(null);
    setDeletingRewardId(reward.reward_id);

    try {
      const res = await apiRequest<DeleteRewardResponse>(
        `/merchant/rewards/${reward.reward_id}?merchant_id=${encodeURIComponent(
          merchantId
        )}`,
        {
          method: "DELETE",
        }
      );

      if (editingRewardId === reward.reward_id) {
        cancelEditingReward();
      }

      if (res.deactivated) {
        setRewardFeedback(
          res.detail ??
            `"${reward.title}" has past redemptions and was marked Inactive.`
        );
      } else {
        setRewardFeedback(`Deleted reward "${reward.title}".`);
      }

      await loadMerchantData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete reward.";
      setRewardError(message);
    } finally {
      setDeletingRewardId(null);
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
            {dashboard?.name ?? fullName?.trim() ?? "Merchant"}
          </Text>
          <Text style={styles.subEmail}>{email}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>
      </View>

      {errorMsg ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      {/* Award points form */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Award Points</Text>
        <Text style={styles.label}>Customer Static QR Code</Text>
        <TextInput
          style={styles.input}
          placeholder="USR-..."
          placeholderTextColor="#9ca3af"
          autoCapitalize="characters"
          value={staticQrCode}
          onChangeText={setStaticQrCode}
        />

        <Text style={styles.label}>Purchase Amount (€)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 5.00"
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          value={purchaseAmount}
          onChangeText={setPurchaseAmount}
        />

        {awardError ? <Text style={styles.errorText}>{awardError}</Text> : null}
        {awardFeedback ? (
          <Text style={styles.successText}>{awardFeedback}</Text>
        ) : null}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleAwardPoints}
          disabled={awarding || !merchantId}
        >
          {awarding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Award Points</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Confirm redemption form */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Confirm Redemption</Text>
        <Text style={styles.label}>6-Digit PIN or Dynamic QR Token</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 317436 or RDM-..."
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          value={redemptionCodeInput}
          onChangeText={setRedemptionCodeInput}
        />

        {redeemConfirmError ? (
          <Text style={styles.errorText}>{redeemConfirmError}</Text>
        ) : null}
        {redeemConfirmFeedback ? (
          <Text style={styles.successText}>{redeemConfirmFeedback}</Text>
        ) : null}

        <TouchableOpacity
          style={styles.secondaryConfirmBtn}
          onPress={handleConfirmRedemption}
          disabled={confirmingRedeem || !merchantId}
        >
          {confirmingRedeem ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Confirm Redemption</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Summary metrics card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Overview</Text>
        {loading ? (
          <ActivityIndicator color="#2563eb" style={{ marginVertical: 12 }} />
        ) : dashboard ? (
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {dashboard.stats.unique_customers}
              </Text>
              <Text style={styles.statLabel}>Customers</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {dashboard.stats.total_points_awarded}
              </Text>
              <Text style={styles.statLabel}>Pts Awarded</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {dashboard.stats.total_points_redeemed}
              </Text>
              <Text style={styles.statLabel}>Pts Redeemed</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {dashboard.stats.total_transactions}
              </Text>
              <Text style={styles.statLabel}>Transactions</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Rewards management: create, edit, and delete */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Rewards</Text>

        {/* Create new reward form */}
        <View style={styles.newRewardBox}>
          <Text style={styles.subSectionLabel}>Add New Reward</Text>
          <TextInput
            style={styles.input}
            placeholder="Reward title (e.g. Free Pastry)"
            placeholderTextColor="#9ca3af"
            value={newRewardTitle}
            onChangeText={setNewRewardTitle}
          />
          <TextInput
            style={styles.input}
            placeholder="Points required (e.g. 80)"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            value={newRewardPoints}
            onChangeText={setNewRewardPoints}
          />
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleCreateReward}
            disabled={creatingReward || !merchantId}
          >
            {creatingReward ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Add Reward</Text>
            )}
          </TouchableOpacity>
        </View>

        {rewardError ? <Text style={styles.errorText}>{rewardError}</Text> : null}
        {rewardFeedback ? (
          <Text style={styles.successText}>{rewardFeedback}</Text>
        ) : null}

        {loading ? (
          <ActivityIndicator color="#2563eb" style={{ marginVertical: 12 }} />
        ) : rewards.length === 0 ? (
          <Text style={styles.emptyText}>No rewards configured yet.</Text>
        ) : (
          rewards.map((r) => {
            const isEditing = editingRewardId === r.reward_id;
            const isSaving = savingRewardId === r.reward_id;
            const isDeleting = deletingRewardId === r.reward_id;

            if (isEditing) {
              return (
                <View key={r.reward_id} style={styles.editRewardBox}>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    value={editRewardTitle}
                    onChangeText={setEditRewardTitle}
                    placeholder="Reward title"
                    placeholderTextColor="#9ca3af"
                  />

                  <Text style={styles.label}>Points Required</Text>
                  <TextInput
                    style={styles.input}
                    value={editRewardPoints}
                    onChangeText={setEditRewardPoints}
                    keyboardType="number-pad"
                    placeholder="Points"
                    placeholderTextColor="#9ca3af"
                  />

                  <View style={styles.switchRow}>
                    <Text style={styles.label}>Active</Text>
                    <Switch
                      value={editRewardActive}
                      onValueChange={setEditRewardActive}
                      trackColor={{ false: "#d1d5db", true: "#93c5fd" }}
                      thumbColor={editRewardActive ? "#2563eb" : "#f3f4f6"}
                    />
                  </View>

                  <View style={styles.editActionsRow}>
                    <TouchableOpacity
                      style={styles.cancelEditBtn}
                      onPress={cancelEditingReward}
                      disabled={isSaving}
                    >
                      <Text style={styles.cancelEditBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.saveEditBtn}
                      onPress={() => handleSaveRewardEdit(r.reward_id)}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.saveEditBtnText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            return (
              <View key={r.reward_id} style={styles.rewardManageRow}>
                <View style={styles.rewardInfoCol}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                  <Text style={styles.rowSubtitle}>
                    {r.points_required} pts •{" "}
                    <Text
                      style={
                        r.is_active ? styles.activeBadge : styles.inactiveBadge
                      }
                    >
                      {r.is_active ? "Active" : "Inactive"}
                    </Text>
                  </Text>
                </View>

                <View style={styles.rewardActionsCol}>
                  <TouchableOpacity
                    style={styles.editSmallBtn}
                    onPress={() => startEditingReward(r)}
                    disabled={isDeleting}
                  >
                    <Text style={styles.editSmallBtnText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.deleteSmallBtn}
                    onPress={() => confirmDeleteReward(r)}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color="#dc2626" />
                    ) : (
                      <Text style={styles.deleteSmallBtnText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Recent transactions */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        {loading ? (
          <ActivityIndicator color="#2563eb" style={{ marginVertical: 12 }} />
        ) : transactions.length === 0 ? (
          <Text style={styles.emptyText}>No transactions yet.</Text>
        ) : (
          transactions.map((t) => {
            const isPositive = t.points_delta > 0;
            return (
              <View key={t.transaction_id} style={styles.listRow}>
                <View>
                  <Text style={styles.rowTitle}>{t.customer_name}</Text>
                  <Text style={styles.rowSubtitle}>{t.type}</Text>
                </View>
                <Text
                  style={[
                    styles.deltaTag,
                    isPositive ? styles.deltaEarn : styles.deltaRedeem,
                  ]}
                >
                  {isPositive ? `+${t.points_delta}` : t.points_delta} pts
                </Text>
              </View>
            );
          })
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
    color: "#2563eb",
    marginBottom: 12,
  },
  subSectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: "#111827",
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  primaryBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
  },
  secondaryConfirmBtn: {
    backgroundColor: "#059669",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  successText: {
    color: "#059669",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  statBox: {
    width: "48%",
    backgroundColor: "#eff6ff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  statLabel: {
    fontSize: 12,
    color: "#4b5563",
    marginTop: 2,
  },
  newRewardBox: {
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 14,
  },
  rewardManageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  rewardInfoCol: {
    flex: 1,
    paddingRight: 10,
  },
  rewardActionsCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activeBadge: {
    color: "#059669",
    fontWeight: "600",
  },
  inactiveBadge: {
    color: "#9ca3af",
    fontWeight: "600",
  },
  editSmallBtn: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  editSmallBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  deleteSmallBtn: {
    backgroundColor: "#fef2f2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#fecaca",
    minWidth: 56,
    alignItems: "center",
  },
  deleteSmallBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#dc2626",
  },
  editRewardBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  editActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelEditBtn: {
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelEditBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  saveEditBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 68,
    alignItems: "center",
  },
  saveEditBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  rowSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  deltaTag: {
    fontSize: 14,
    fontWeight: "700",
  },
  deltaEarn: {
    color: "#059669",
  },
  deltaRedeem: {
    color: "#dc2626",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#6b7280",
  },
});
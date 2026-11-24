import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { API_BASE_URL, apiRequest } from "./src/config/api";
import CustomerHomeScreen from "./src/screens/CustomerHomeScreen";
import MerchantHomeScreen from "./src/screens/MerchantHomeScreen";

type UserRole = "CUSTOMER" | "MERCHANT";

interface MerchantInfo {
  merchant_id: string;
  name?: string;
  category?: string | null;
  points_per_euro?: number;
}

interface LoginResponse {
  user_id?: string;
  id?: string;
  email: string;
  full_name?: string;
  role: UserRole;
  merchant_id?: string | null;
  merchant?: MerchantInfo | null;
}

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loggedInUser, setLoggedInUser] = useState<LoginResponse | null>(null);

  async function handleLogin() {
    setErrorMsg(null);

    if (!email.trim() || !password) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    setLoading(true);
    try {
      // Authenticate user against FastAPI backend
      const data = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      setLoggedInUser(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to connect to backend.";
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    // Clear active session state and reset form inputs
    setLoggedInUser(null);
    setPassword("");
    setErrorMsg(null);
  }

  const resolvedUserId = loggedInUser?.user_id ?? loggedInUser?.id ?? "";

  if (loggedInUser && loggedInUser.role === "CUSTOMER") {
    return (
      <SafeAreaView style={styles.container}>
        <CustomerHomeScreen
          customerId={resolvedUserId}
          fullName={loggedInUser.full_name}
          email={loggedInUser.email}
          onLogout={handleLogout}
        />
      </SafeAreaView>
    );
  }

  if (loggedInUser && loggedInUser.role === "MERCHANT") {
    // Read merchant_id from nested merchant object returned by /auth/login
    const resolvedMerchantId =
      loggedInUser.merchant?.merchant_id ?? loggedInUser.merchant_id ?? "";

    return (
      <SafeAreaView style={styles.container}>
        <MerchantHomeScreen
          merchantId={resolvedMerchantId}
          fullName={loggedInUser.merchant?.name ?? loggedInUser.full_name}
          email={loggedInUser.email}
          onLogout={handleLogout}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.inner}
      >
        <Text style={styles.title}>Loyalty App</Text>
        <Text style={styles.subtitle}>API: {API_BASE_URL}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="name@example.com"
            placeholderTextColor="#888"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#888"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f9",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    marginBottom: 14,
    backgroundColor: "#fff",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
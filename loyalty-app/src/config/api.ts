// Use the Windows PC's local IPv4 address so Expo Go on the iPhone can reach FastAPI
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.2.8:8000";

function formatErrorDetail(detail: unknown): string {
  // Include field path from FastAPI validation errors when available
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as { loc?: unknown[]; msg?: unknown };
          const field =
            Array.isArray(obj.loc) && obj.loc.length > 0
              ? String(obj.loc[obj.loc.length - 1])
              : "";
          const msg = obj.msg !== undefined ? String(obj.msg) : JSON.stringify(item);
          return field ? `${field}: ${msg}` : msg;
        }
        return JSON.stringify(item);
      })
      .join(", ");
  }
  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }
  return "";
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // Send JSON request to FastAPI backend and surface error details cleanly
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const rawText = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const formattedDetail = data ? formatErrorDetail(data.detail) : "";
    const message =
      formattedDetail ||
      rawText ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
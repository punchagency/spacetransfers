const API_BASE_URL = import.meta.env.VITE_API_URL || "https://space-transfers-475154718031.herokuapp.com/api";

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Some error responses (auth gates) can return empty bodies; guard JSON.parse.
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error: Error & { status?: number; data?: any } = new Error(
      data?.message || `Request failed with status ${response.status}`,
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export type MockPaymentRequest = {
  cardNumber: string;
  expiry: string; // MMYY
  cvv: string;
  name: string;
  amount: number;
  billing: {
    name: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    email: string;
  };
  items: Array<{
    type: string;
    designId?: string;
    name: string;
    widthIn?: number;
    heightIn?: number;
    quantity: number;
    unitPrice: number;
  }>;
};

export type MockPaymentResult =
  | { status: "succeeded"; transactionId: string; createdAt: number }
  | { status: "failed"; transactionId: string; createdAt: number; error?: string };

export function validateCardNumber(input: string): { valid: boolean; cleaned: string } {
  const digits = input.replace(/\D/g, "").slice(0, 16);
  return { valid: digits.length === 16, cleaned: digits };
}

export function validateExpiry(input: string): { valid: boolean; cleaned: string } {
  const digits = input.replace(/\D/g, "").slice(0, 4);
  if (digits.length < 4) return { valid: false, cleaned: digits };
  const mm = parseInt(digits.slice(0, 2), 10);
  const yy = parseInt(digits.slice(2), 10);
  if (isNaN(mm) || isNaN(yy) || mm < 1 || mm > 12) return { valid: false, cleaned: digits };
  const current = new Date();
  const year = 2000 + yy;
  // set date to last day of month
  const expDate = new Date(year, mm, 0, 23, 59, 59);
  const valid = expDate >= new Date(current.getFullYear(), current.getMonth(), 1);
  return { valid, cleaned: digits };
}

export function validateCVV(input: string): { valid: boolean; cleaned: string } {
  const digits = input.replace(/\D/g, "").slice(0, 4);
  return { valid: digits.length >= 3 && digits.length <= 4, cleaned: digits };
}

function genId(prefix: string) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rnd}`;
}

export async function processFakePayment(req: MockPaymentRequest): Promise<MockPaymentResult> {
  const lastDigit = req.cardNumber.slice(-1);
  const transactionId = genId("mock_txn");
  const createdAt = Date.now();

  // Simulate processing delay
  await new Promise((res) => setTimeout(res, 1200));

  // Simulate timeout
  if (lastDigit === "9") {
    const failed: MockPaymentResult = { status: "failed", transactionId, createdAt, error: "Network timeout" };
    persistTransaction({ ...failed, request: req });
    return failed;
  }

  // Success rule: even last digit succeeds; odd fails (except 4111...1111)
  const is4111 = req.cardNumber === "4111111111111111";
  const lastDigitNum = parseInt(lastDigit, 10);
  const isEven = lastDigitNum % 2 === 0;

  const succeeds = is4111 || isEven;
  const result: MockPaymentResult = succeeds
    ? { status: "succeeded", transactionId: transactionId, createdAt: createdAt }
    : { status: "failed", transactionId: transactionId, createdAt: createdAt, error: "Card declined" };

  persistTransaction({ ...result, request: req });
  return result;
}

type StoredTxn = {
  transactionId: string;
  createdAt: number;
  status: "succeeded" | "failed";
  error?: string;
  request: MockPaymentRequest;
};

function persistTransaction(txn: StoredTxn) {
  try {
    const key = "mock_transactions";
    const existing: StoredTxn[] = JSON.parse(localStorage.getItem(key) || "[]");
    existing.unshift(txn);
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 100)));
  } catch {
    // ignore storage errors
  }
}

export function listMockTransactions(): StoredTxn[] {
  try {
    return JSON.parse(localStorage.getItem("mock_transactions") || "[]");
  } catch {
    return [];
  }
}

import { describe, it, expect, vi } from 'vitest';
import { validateCardNumber, validateExpiry, validateCVV, processFakePayment, listMockTransactions } from './fakePayments';

describe('fakePayments validations', () => {
  it('validates 16-digit card numbers', () => {
    expect(validateCardNumber('4242 4242 4242 4242').valid).toBe(true);
    expect(validateCardNumber('4242 4242 4242 424').valid).toBe(false);
    expect(validateCardNumber('abcd').valid).toBe(false);
  });

  it('validates expiry dates in the future', () => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String((now.getFullYear() + 1) % 100).padStart(2, '0');
    expect(validateExpiry(`${mm}${yy}`).valid).toBe(true);
    expect(validateExpiry('0010').valid).toBe(false);
    expect(validateExpiry('1325').valid).toBe(false);
  });

  it('validates cvv 3-4 digits', () => {
    expect(validateCVV('123').valid).toBe(true);
    expect(validateCVV('1234').valid).toBe(true);
    expect(validateCVV('12').valid).toBe(false);
  });
});

describe('processFakePayment', () => {
  it('succeeds for even last digit', async () => {
    const res = await processFakePayment({
      cardNumber: '4242424242424242',
      expiry: '1299',
      cvv: '123',
      name: 'Test User',
      amount: 100,
      billing: {
        name: 'Test User',
        street: '123 St',
        city: 'LA',
        state: 'CA',
        postalCode: '90001',
        country: 'US',
        email: 'test@example.com',
      },
      items: [{ type: 'gangsheet', name: 'Test', quantity: 1, unitPrice: 100 }],
    });
    expect(res.status).toBe('succeeded');
    expect(res.transactionId).toMatch(/^mock_txn_/);
  });

  it('succeeds for 4111...1111 (special case)', async () => {
    const res = await processFakePayment({
      cardNumber: '4111111111111111',
      expiry: '1299',
      cvv: '123',
      name: 'Test User',
      amount: 100,
      billing: {
        name: 'Test User',
        street: '123 St',
        city: 'LA',
        state: 'CA',
        postalCode: '90001',
        country: 'US',
        email: 'test@example.com',
      },
      items: [{ type: 'gangsheet', name: 'Test', quantity: 1, unitPrice: 100 }],
    });
    expect(res.status).toBe('succeeded');
  });

  it('fails for odd last digit', async () => {
    const res = await processFakePayment({
      cardNumber: '4242424242424241',
      expiry: '1299',
      cvv: '123',
      name: 'Test User',
      amount: 100,
      billing: {
        name: 'Test User',
        street: '123 St',
        city: 'LA',
        state: 'CA',
        postalCode: '90001',
        country: 'US',
        email: 'test@example.com',
      },
      items: [{ type: 'gangsheet', name: 'Test', quantity: 1, unitPrice: 100 }],
    });
    expect(res.status).toBe('failed');
  });
});

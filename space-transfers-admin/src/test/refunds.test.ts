import { describe, expect, it } from 'vitest';
import { isFullRefund, issuePreview, parseRefundAmount, unansweredOn } from '../utils/refunds';

describe('a refund amount typed by an admin', () => {
    it('accepts dollars and cents up to what is left', () => {
        expect(parseRefundAmount('5', 28.24)).toEqual({ amount: 5, error: null });
        expect(parseRefundAmount(' $12.50 ', 28.24)).toEqual({ amount: 12.5, error: null });
        expect(parseRefundAmount('28.24', 28.24)).toEqual({ amount: 28.24, error: null });
    });

    it('names what is wrong with anything else', () => {
        expect(parseRefundAmount('', 28.24).error).toMatch(/Enter an amount/);
        expect(parseRefundAmount('abc', 28.24).error).toMatch(/dollars and cents/);
        expect(parseRefundAmount('5.005', 28.24).error).toMatch(/dollars and cents/);
        expect(parseRefundAmount('-3', 28.24).error).toMatch(/dollars and cents/);
        expect(parseRefundAmount('0', 28.24).error).toMatch(/greater than zero/);
        expect(parseRefundAmount('28.25', 28.24).error).toMatch(/\$28\.24/);
    });

    it('allows zero only where a cancellation may keep the whole payment', () => {
        expect(parseRefundAmount('0', 28.24, { allowZero: true })).toEqual({ amount: 0, error: null });
    });

    it('knows a full refund from a part one', () => {
        expect(isFullRefund(28.24, 28.24)).toBe(true);
        expect(isFullRefund(20, 28.24)).toBe(false);
    });
});

describe('a report in the list', () => {
    const at = '2026-10-12T10:00:00Z';
    const m = (channel: 'CUSTOMER' | 'PARTNER', author: 'CUSTOMER' | 'ADMIN' | 'PARTNER', body: string) => ({ id: body, channel, author, authorName: '', body, at });

    it('previews the latest message, or the report itself', () => {
        expect(issuePreview({ description: 'Box  was\ncrushed', messages: [] })).toBe('Box was crushed');
        expect(issuePreview({ description: 'x', messages: [m('CUSTOMER', 'CUSTOMER', 'Any news?')] })).toBe('Any news?');
        const photoOnly = { ...m('CUSTOMER', 'CUSTOMER', ''), attachments: [{ url: 'https://f/issues/1.jpg', name: '1.jpg' }] };
        expect(issuePreview({ description: 'x', messages: [photoOnly] })).toBe('1 photo');
    });

    it('counts what is waiting on each side separately', () => {
        const issue = {
            messages: [
                m('CUSTOMER', 'CUSTOMER', 'a'),
                m('CUSTOMER', 'ADMIN', 'b'),
                m('CUSTOMER', 'CUSTOMER', 'c'),
                m('CUSTOMER', 'CUSTOMER', 'd'),
                m('PARTNER', 'ADMIN', 'e'),
            ],
        };
        expect(unansweredOn(issue, 'CUSTOMER')).toBe(2);
        expect(unansweredOn(issue, 'PARTNER')).toBe(0);
    });
});

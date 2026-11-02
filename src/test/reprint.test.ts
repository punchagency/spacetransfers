import { describe, expect, it } from 'vitest';
import { reprintSelection, type ReprintSheet } from '../utils/refunds';

const sheets: ReprintSheet[] = [
    { index: 0, name: 'Front', widthIn: 22, heightIn: 12, quantity: 3, previewImage: null },
    { index: 1, name: 'Back', widthIn: 22, heightIn: 24, quantity: 1, previewImage: null },
];

describe('choosing what to reprint', () => {
    it('sends nothing for the whole order, so the server reprints all of it', () => {
        expect(reprintSelection(sheets, true, { 0: 1 })).toEqual({ items: null, error: null });
    });

    it('sends only the ticked sheets, never more than were ordered', () => {
        expect(reprintSelection(sheets, false, { 0: 2, 1: 0 })).toEqual({ items: [{ index: 0, quantity: 2 }], error: null });
        expect(reprintSelection(sheets, false, { 0: 9, 1: 1 }).items).toEqual([
            { index: 0, quantity: 3 },
            { index: 1, quantity: 1 },
        ]);
    });

    it('asks for at least one sheet', () => {
        expect(reprintSelection(sheets, false, {}).error).toMatch(/at least one/);
    });
});

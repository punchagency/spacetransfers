import { describe, expect, it } from 'vitest';
import { hasUnsavedChanges, storeOrigin } from '../utils/legal';
import { legalMarkupError, parseLegalMarkup } from '../utils/legalMarkup';

describe('legal documents in the console', () => {
    it('finds the store beside the console when none is configured', () => {
        expect(storeOrigin(undefined, 'https://admin.stdemo.victoronojaodoh.com')).toBe('https://store.stdemo.victoronojaodoh.com');
        expect(storeOrigin('https://shop.example.com/', 'https://console.example.com')).toBe('https://shop.example.com');
    });

    it('knows when the editor holds changes not yet saved', () => {
        const saved = { title: 'Terms', body: '## 1\nText', isDraft: true };
        expect(hasUnsavedChanges(saved, { ...saved })).toBe(false);
        expect(hasUnsavedChanges(saved, { ...saved, body: '## 1\nText  \n' })).toBe(false);
        expect(hasUnsavedChanges(saved, { ...saved, body: '## 1\nNew text' })).toBe(true);
        expect(hasUnsavedChanges(saved, { ...saved, isDraft: false })).toBe(true);
    });

    it('reads the text format the same way the server does', () => {
        expect(parseLegalMarkup('## 1. One\n- a').sections).toEqual([{ heading: '1. One', blocks: [{ type: 'ul', items: ['a'] }] }]);
        expect(legalMarkupError('No heading')).toMatch(/section heading/);
    });
});

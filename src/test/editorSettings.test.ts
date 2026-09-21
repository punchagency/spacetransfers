import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHEET_SETTINGS,
  loadEditorSettings,
  saveEditorSettings,
  sheetSettingsForSave,
  sheetSettingsFromSaved,
} from "../lib/utils/editorSettings";

/**
 * View settings belong to the customer and are remembered; sheet settings
 * belong to the sheet. A new sheet used to inherit whatever spacing the last
 * one had, and a saved design reopened with the current spacing instead of its
 * own.
 */

/*
 * An in-memory Storage. Node 26 ships an experimental global `localStorage`
 * that shadows jsdom's and is undefined unless started with a storage file.
 */
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});

describe("editor settings", () => {
  it("starts every sheet from the defaults, whatever the last one used", () => {
    saveEditorSettings({
      ...loadEditorSettings(),
      spacing: 1.5,
      marginSize: 0.5,
      autoNestStickers: false,
      showRulers: false,
      canvasBg: "#111827",
    });

    const next = loadEditorSettings();

    expect(next.spacing).toBe(DEFAULT_SHEET_SETTINGS.spacing);
    expect(next.marginSize).toBe(DEFAULT_SHEET_SETTINGS.marginSize);
    expect(next.autoNestStickers).toBe(DEFAULT_SHEET_SETTINGS.autoNestStickers);
    // The customer's own view choices carry over.
    expect(next.showRulers).toBe(false);
    expect(next.canvasBg).toBe("#111827");
  });

  it("starts from the defaults whatever an earlier version stored", () => {
    // The old code saved every setting on any change, grid on included, so
    // honouring it would keep the old defaults for anyone who touched one.
    localStorage.setItem(
      "editorSettings",
      JSON.stringify({ spacing: 0.5, marginSize: 1, autoNestStickers: false, showGrid: true, showRulers: false }),
    );
    const s = loadEditorSettings();
    expect(s.spacing).toBe(0.25);
    expect(s.marginSize).toBe(DEFAULT_SHEET_SETTINGS.marginSize);
    expect(s.autoNestStickers).toBe(true);
    expect(s.showGrid).toBe(false);
    expect(s.showRulers).toBe(true);
  });

  it("has the grid off on a first visit", () => {
    expect(loadEditorSettings().showGrid).toBe(false);
  });

  it("removes the retired keys once the new settings are saved", () => {
    localStorage.setItem("editorSettings", "{}");
    localStorage.setItem("canvasBg", "#111827");
    saveEditorSettings(loadEditorSettings());
    expect(localStorage.getItem("editorSettings")).toBeNull();
    expect(localStorage.getItem("canvasBg")).toBeNull();
  });

  it("restores a saved design's own sheet settings", () => {
    const saved = sheetSettingsForSave({ ...loadEditorSettings(), spacing: 0.75, marginSize: 0.5, autoNestStickers: false });
    expect(sheetSettingsFromSaved(saved)).toEqual({ spacing: 0.75, marginSize: 0.5, autoNestStickers: false });
  });

  it("gives a design saved without them, or with values it cannot show, the defaults", () => {
    expect(sheetSettingsFromSaved(undefined)).toEqual(DEFAULT_SHEET_SETTINGS);
    expect(sheetSettingsFromSaved({})).toEqual(DEFAULT_SHEET_SETTINGS);
    expect(
      sheetSettingsFromSaved({ itemSpacingIn: -1, sheetMarginIn: 0.33, autoNest: "yes" }),
    ).toEqual(DEFAULT_SHEET_SETTINGS);
    expect(sheetSettingsFromSaved({ itemSpacingIn: null })).toEqual(DEFAULT_SHEET_SETTINGS);
  });
});

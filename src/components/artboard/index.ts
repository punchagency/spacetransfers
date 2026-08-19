// Main exports
export { default as Artboard } from '../Artboard';

// Re-export types
export type { ArtboardItem, ArtboardProps, HeaderInfo } from './types';

// Re-export hooks
export * from './lib/hooks';

// Re-export utils
export * from './lib/utils';

// Re-export the AI editing layer (provider registry lives here — register a new
// vendor with `registerProvider` and the UI picks it up with no changes).
export * from './lib/ai';

// Re-export features
export * from './features/ai';
export * from './features/canvas';
export * from './features/items';
export * from './features/rulers';
export * from './features/zoom';

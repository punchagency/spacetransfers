import '@testing-library/jest-dom';

/*
 * Same shim as the admin app's test setup — same cause, kept in step by hand.
 */
/**
 * localStorage shim for the test environment.
 *
 * Node 26 ships its own experimental `globalThis.localStorage`, which is only
 * backed by real storage when the process is started with `--localstorage-file`.
 * Without that flag it resolves to `undefined`, and because it is defined on the
 * global object it shadows the one jsdom would otherwise provide — so under
 * Vitest every `localStorage` access is `undefined`, silently, in both the tests
 * and the code under test.
 *
 * Real browsers are unaffected; this exists purely so the test environment
 * behaves like the one the app actually runs in. Installed only when the global
 * is missing, so a future Node or jsdom that provides a working implementation
 * is left alone.
 */
const installLocalStorage = () => {
  let usable = false;
  try {
    usable = typeof globalThis.localStorage?.getItem === 'function';
  } catch {
    usable = false;
  }
  if (usable) return;

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => (store.has(String(key)) ? store.get(String(key))! : null),
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    writable: true,
    configurable: true,
  });
};

installLocalStorage();

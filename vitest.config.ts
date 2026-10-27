import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // Integration cases start native workers and may extract several files.
    // Shared Windows runners can exceed Vitest's five-second default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxWorkers: 4
  }
});

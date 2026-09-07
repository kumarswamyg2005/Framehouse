import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  preview: {
    buckets: {
      // Private. Every photograph is delivered by a presigned GET minted after
      // an authorization check — see the invariants in lib/auth/policy.ts.
      framehouse: {},
    },
  },
});

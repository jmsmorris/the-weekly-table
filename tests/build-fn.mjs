// Compiles the Deno edge function to plain JS so Node can run its tests.
import { build } from "esbuild";
await build({
  entryPoints: ["supabase/functions/import-recipe/index.ts"],
  outfile: "tests/.tmp/fn.mjs",
  format: "esm",
  target: "node22",
  logLevel: "error",
});

import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    outDir: "dist",
    external: ["fast-xml-parser"],
});

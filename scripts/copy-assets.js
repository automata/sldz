import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/public", { recursive: true });
await cp("src/public", "dist/public", { recursive: true, force: true });

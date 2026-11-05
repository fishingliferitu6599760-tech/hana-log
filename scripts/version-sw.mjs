import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync("public/sw.js", "utf8");
const hash = createHash("sha256")
  .update(readFileSync("dist/index.html"))
  .update(source)
  .digest("hex")
  .slice(0, 12);
writeFileSync("dist/sw.js", source.replace("hana-log-v1", `hana-log-${hash}`));

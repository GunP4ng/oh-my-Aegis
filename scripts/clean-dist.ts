import { rmSync } from "node:fs";

const targets = ["dist/src", "dist/test", "dist/scripts"];

for (const path of targets) {
  rmSync(path, { recursive: true, force: true });
}

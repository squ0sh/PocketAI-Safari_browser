import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function offlineBundle() {
  return {
    name: "pocket-ai-offline-bundle",
    apply: "build",
    writeBundle(options) {
      const dir = resolve(options.dir || "dist");
      const walk = (base, prefix = "") => readdirSync(base, { withFileTypes: true }).flatMap((item) => {
        const name = prefix + item.name;
        return item.isDirectory() ? walk(join(base, item.name), name + "/") : [name];
      });
      const assets = walk(dir).filter((name) => name !== "sw.js" && !name.endsWith(".map")).sort();
      const hash = createHash("sha256");
      for (const name of assets) hash.update(name).update(readFileSync(join(dir, name)));
      const template = readFileSync("public/sw.js", "utf8");
      hash.update(template);
      writeFileSync(join(dir, "sw.js"), template
        .replace("const BUILD_ASSETS = []; // @build-assets", `const BUILD_ASSETS = ${JSON.stringify(assets.map((name) => "/" + name))};`)
        .replace("__BUILD_ID__", hash.digest("hex").slice(0, 16)));
    },
  };
}
export default defineConfig({
  plugins:[offlineBundle(), {...basicSsl({name:"pocket-ai-local",domains:["10.0.0.103","localhost","127.0.0.1"],ttlDays:30}),apply:"serve"}],
  server:{host:"0.0.0.0",port:5173,strictPort:true},
  preview:{host:"0.0.0.0",port:5173,strictPort:true}
});

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist-tauri");
const pdfjs = resolve(root, "node_modules/pdfjs-dist");

async function removeSourceMaps(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await removeSourceMaps(path);
    } else if (entry.name.endsWith(".map")) {
      await rm(path, { force: true });
    }
  }));
}

await mkdir(output, { recursive: true });
await removeSourceMaps(output);
await cp(resolve(root, "html/index.html"), resolve(output, "index.html"));
await cp(resolve(root, "src-tauri/icons/icon.png"), resolve(output, "icon.png"));

const pdfOutput = resolve(output, "pdfjs");
await rm(pdfOutput, { recursive: true, force: true });
await mkdir(resolve(pdfOutput, "licenses"), { recursive: true });

await cp(
  resolve(pdfjs, "legacy/build/pdf.worker.min.mjs"),
  resolve(pdfOutput, "pdf.worker.min.mjs")
);

for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(resolve(pdfjs, directory), resolve(pdfOutput, directory), { recursive: true });
}

await cp(resolve(pdfjs, "LICENSE"), resolve(pdfOutput, "licenses/PDFJS-LICENSE"));
await cp(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(output, "THIRD_PARTY_NOTICES.md")
);

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("app dropdowns do not fall back to native OS select menus", () => {
  const componentsDir = path.join(__dirname, "..", "src", "components");
  const componentFiles = fs.readdirSync(componentsDir).filter((file) => file.endsWith(".tsx"));
  const nativeSelects = componentFiles.filter((file) => {
    const source = fs.readFileSync(path.join(componentsDir, file), "utf8");
    return /<select\b|<HTMLSelect\b/.test(source);
  });

  assert.deepEqual(nativeSelects, []);
});

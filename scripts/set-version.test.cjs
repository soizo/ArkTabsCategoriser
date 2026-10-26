const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setVersion } = require("./set-version.cjs");

test("version updater synchronizes root package versions without changing dependencies", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bird-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ["package.json", "package-lock.json"];
  for (const file of files) fs.copyFileSync(path.resolve(__dirname, "..", file), path.join(root, file));
  const before = files.map(file => fs.readFileSync(path.join(root, file), "utf8"));
  for (const invalid of ["", "1.2", "v1.2.3", "01.2.3", "1.2.3-beta", "65536.0.1", "0.0.0", "1.2.3\n", "$(echo fail)"]) {
    assert.throws(() => setVersion(root, invalid));
    assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), "utf8")), before);
  }
  setVersion(root, "0.2.10");
  files.forEach((file, index) => {
    const expected = JSON.parse(before[index]);
    expected.version = "0.2.10";
    if (index === 1) expected.packages[""].version = "0.2.10";
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, file), "utf8")), expected);
  });
  const updated = files.map(file => fs.readFileSync(path.join(root, file), "utf8"));
  setVersion(root, "0.2.10");
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), "utf8")), updated);
});

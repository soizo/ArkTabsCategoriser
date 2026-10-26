const fs = require("node:fs");
const path = require("node:path");

function setVersion(root, version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      version.split(".").some(part => Number(part) > 65535) || version === "0.0.0") {
    throw new Error("Use a version such as 0.1.9: three integers from 0 to 65535, without leading zeros; 0.0.0 is not allowed.");
  }
  const files = ["package.json", "package-lock.json"];
  files.forEach((file, index) => {
    const target = path.join(root, file);
    // Preserve formatting everywhere except the version fields.
    const original = fs.readFileSync(target, "utf8");
    const updated = original.replace(/("version"\s*:\s*")[^"]+(")/, (_, prefix, suffix) => `${prefix}${version}${suffix}`);
    if (index === 1) {
      const parsed = JSON.parse(updated);
      parsed.packages[""].version = version;
      fs.writeFileSync(target, JSON.stringify(parsed, null, 2) + "\n");
    } else {
      fs.writeFileSync(target, updated);
    }
  });
}

if (require.main === module) {
  try { setVersion(path.resolve(__dirname, ".."), process.argv[2] || ""); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { setVersion };

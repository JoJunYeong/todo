import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve("dist");
const files = [];
async function visit(directory) {
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) await visit(file);
    else if (stat.isFile()) {
      const bytes = await fs.readFile(file);
      files.push({
        path: path.relative(root, file).split(path.sep).join("/"),
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
    } else throw Error("Release must contain ordinary files only");
  }
}
await visit(root);
if (!files.some((file) => file.path === "index.html"))
  throw Error("Build dist/index.html before preparing a release");
const bundle_sha256 = crypto
  .createHash("sha256")
  .update(JSON.stringify(files))
  .digest("hex");
const expected = process.env.EXPECTED_BUNDLE_SHA256;
if (
  expected !== undefined &&
  (!/^[a-f0-9]{64}$/.test(expected) || expected !== bundle_sha256)
)
  throw Error("Build differs from the approved release bundle");
const result = { bundle_sha256, files };
if (process.argv[2])
  await fs.writeFile(process.argv[2], JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
console.log(
  JSON.stringify({
    bundle_sha256,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  }),
);

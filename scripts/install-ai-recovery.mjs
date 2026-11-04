// Explicit installation only; invoking the API client never installs an OS service.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin" || Number(process.versions.node.split(".")[0]) < 22)
  throw Error("이 설치 도구는 macOS의 Node.js 22 이상에서 실행해 주세요.");
const mode = process.argv[2];
if (!["--plan", "--install"].includes(mode)) throw Error("--plan 또는 --install을 지정해 주세요.");
const label = "com.zadu.daynote-ai-recovery";
const directory = path.join(os.homedir(), "Library", "Application Support", "DaynoteAI");
const clientFile = path.join(directory, "daynote-ai.mjs");
const manifestFile = path.join(directory, "manifest.json");
const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", label + ".plist");
const configFile = process.env.DAYNOTE_AI_CONFIG || path.join(os.homedir(), ".config", "daynote", "credentials.json");
const source = await fs.readFile(new URL("../public/daynote-ai.mjs", import.meta.url));
const sha256 = createHash("sha256").update(source).digest("hex");
const plan = { label, clientFile, plistFile, sha256, intervalSeconds: 900, action: "retry-pending", configFile };
if (mode === "--plan") console.log(JSON.stringify(plan));
else {
  // Existing installations have a separate owner/update decision; never replace them.
  for (const item of [directory, plistFile]) {
    try { await fs.lstat(item); throw Error("기존 설치를 덮어쓸 수 없어요: " + item); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await fs.access(configFile);
  const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(clientFile)}</string><string>retry-pending</string></array>
<key>EnvironmentVariables</key><dict><key>DAYNOTE_AI_CONFIG</key><string>${xml(configFile)}</string></dict>
<key>StartInterval</key><integer>900</integer><key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(clientFile, source, { mode: 0o600, flag: "wx" });
  await fs.writeFile(manifestFile, JSON.stringify({ ...plan, installedAt: new Date().toISOString() }) + "\n", { mode: 0o600, flag: "wx" });
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  await fs.writeFile(plistFile, plist, { mode: 0o600, flag: "wx" });
  execFileSync("/usr/bin/plutil", ["-lint", plistFile], { stdio: "pipe" });
  execFileSync("/bin/launchctl", ["bootstrap", "gui/" + process.getuid(), plistFile], { stdio: "pipe" });
  const readback = await fs.readFile(clientFile);
  if (createHash("sha256").update(readback).digest("hex") !== sha256) throw Error("설치된 파일의 SHA가 다릅니다.");
  console.log(JSON.stringify({ ...plan, installed: true }));
}

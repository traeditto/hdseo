import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_FILE_BYTES = 2_000_000;
const patterns = [
  ["Stripe live secret", /sk_live_[A-Za-z0-9]{16,}/g],
  ["OpenAI project secret", /sk-proj-[A-Za-z0-9_-]{16,}/g],
  ["GitHub access token", /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["private key PEM", /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g],
];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of files) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
  const source = readFileSync(file, "utf8");
  if (source.includes("\0")) continue;
  for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) findings.push(`${file}: possible ${name}`);
  }
}

if (findings.length) {
  console.error("Tracked secret scan failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Tracked secret scan passed across ${files.length} files.`);
}

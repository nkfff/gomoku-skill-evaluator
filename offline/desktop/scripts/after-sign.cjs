const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

module.exports = async function afterSign(context) {
  if (process.platform !== "darwin") return;
  const filename = context.packager.appInfo.productFilename + ".app";
  const app = path.join(context.appOutDir, filename);
  const signature = path.join(app, "Contents", "_CodeSignature", "CodeResources");
  if (!fs.existsSync(app)) throw new Error("Missing macOS bundle: " + app);

  // For local/unsigned test packages, Electron's implicit signature sometimes
  // lacks CodeResources and Gatekeeper reports the app as "damaged".
  // Seal the complete bundle so malformed packages fail at build time.
  // When Developer ID signing is enabled, do NOT overwrite that identity.
  const hasDeveloperId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
  const codesign = (args) => execFileSync("/usr/bin/codesign", args, { stdio: "inherit" });
  if (!hasDeveloperId) {
    codesign(["--force", "--deep", "--sign", "-", "--timestamp=none", app]);
  }
  if (!fs.existsSync(signature)) {
    throw new Error("macOS CodeResources seal missing from " + app);
  }
  codesign(["--verify", "--deep", "--strict", "--verbose=2", app]);
  console.log("Verified sealed macOS bundle: " + app + (hasDeveloperId ? " (Developer ID)" : " (ad-hoc; not notarized)"));
};

const fs = require("node:fs");
const path = require("path");

if (process.env.BUILD_FLAVOR.length === 0) {
  throw new Error("BUILD_FLAVOR is required");
}

console.debug("injecting env", process.env.BUILD_FLAVOR);
const envPath = path.join(__dirname, "..", "app", "env", "environment.ts");

let envData = fs.readFileSync(envPath, "utf8");

envData = envData.replace(/buildFlavor: ".*"/, `buildFlavor: "${process.env.BUILD_FLAVOR}"`);

// Which renderer a packaged build loads. main.ts also honours --renderer= and WOWUP_RENDERER,
// but neither survives an AppImage double-click or a desktop entry that a launcher has
// rewritten, so the choice has to be baked in.
const buildRenderer = process.env.BUILD_RENDERER === "svelte" ? "svelte" : "angular";
envData = envData.replace(/renderer: ".*"/, `renderer: "${buildRenderer}"`);

console.debug(envData);

fs.writeFileSync(envPath, envData);

const packagePath = path.join(__dirname, "..", "package.json");
let packageData = fs.readFileSync(packagePath, "utf8");
let packageJson = JSON.parse(packageData);

packageJson.name = process.env.BUILD_FLAVOR === "ow" ? "wowup-cf" : "wowup";
packageJson.productName = process.env.BUILD_FLAVOR === "ow" ? "WowUpCf" : "WowUp";

// A Svelte build is a different application as far as the OS is concerned: its own userData
// directory, its own single-instance lock, its own tray entry. Without this it would share
// ~/.config/WowUpCf with the installed release and the two could write over each other.
if (buildRenderer === "svelte") {
  packageJson.name += "-svelte";
  packageJson.productName += "Svelte";
}
packageJson.repository.url =
  process.env.BUILD_FLAVOR === "ow" ? "https://github.com/WowUp/WowUp.CF.git" : "https://github.com/WowUp/WowUp.git";

fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

// scripts/package.js
const path = require("path");
const fs = require("fs-extra");
const archiver = require("archiver");

async function run() {
  const root = process.cwd();
  const outZip = path.join(root, "tamagotchi-plugin.zip");
  const tmpDir = path.join(root, "build", "tamagotchi-plugin");

  // Clean + create
  await fs.remove(tmpDir);
  await fs.ensureDir(tmpDir);

  // Files to include at plugin root inside zip
  const files = [
    "manifest.json",
    "main.js",
    "styles.css",
    "README.md"
  ];

  // Copy files if present
  for (const f of files) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) {
      console.warn(`Warning: ${f} missing. Make sure you've run npm run build and have main.js and styles.css available.`);
    } else {
      await fs.copy(src, path.join(tmpDir, f));
    }
  }

  // Create zip
  const output = fs.createWriteStream(outZip);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", function() {
    console.log(archive.pointer() + " total bytes");
    console.log("tamagotchi-plugin.zip has been created at", outZip);
  });

  archive.on("error", function(err) {
    throw err;
  });

  archive.pipe(output);
  archive.directory(tmpDir, false);
  await archive.finalize();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
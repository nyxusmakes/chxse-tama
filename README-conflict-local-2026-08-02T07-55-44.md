# Tamagotchi Obsidian Plugin

Build & Package
1. Install deps:
   npm install

2. Build:
   npm run build
   (This compiles src/main.ts to main.js using Rollup.)

3. Package (creates tamagotchi-plugin.zip):
   npm run package

The ZIP will contain:
- manifest.json
- main.js (the compiled plugin bundle)
- styles.css
- README.md

Install
- Desktop: unzip `tamagotchi-plugin.zip` into `.obsidian/plugins/tamagotchi-plugin/` (or copy the extracted folder). Reload Obsidian and enable plugin.
- iOS (Obsidian Mobile):
  - You need the plugin folder inside your vault (Obsidian mobile accesses your vault files). Use iCloud Drive or Files to place the extracted plugin folder at `YourVault/.obsidian/plugins/tamagotchi-plugin/`.
  - Restart Obsidian mobile and enable the plugin in Settings → Community plugins.
  - Audio on iOS: tap the "Enable audio" button in the Tamagotchi sidebar (this is required to resume AudioContext on iOS).
  - Animations may use more battery on mobile; disable animations in the plugin settings if needed.

Notes
- This plugin avoids Node APIs at runtime; it uses only Obsidian plugin APIs (saveData/loadData, ItemView), DOM, Canvas, and WebAudio.
- If you want me to deliver the ZIP directly here in-chat (base64) say so and I will paste it.
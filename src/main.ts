// src/main.ts
import {
  App,
  ItemView,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  Notice,
} from "obsidian";

const VIEW_TYPE = "tamagotchi-sidebar-view";

interface TamagotchiState {
  name: string;
  hunger: number;
  energy: number;
  happiness: number;
  cleanliness: number;
  ageMinutes: number;
  alive: boolean;
  sleeping: boolean;
  lastTick: number;
  animationFrame: number;
}

interface TamagotchiPluginSettings {
  tickIntervalSeconds: number;
  autoOpenOnStart: boolean;
  enableAnimations: boolean;
  enableAudio: boolean;
  petName: string;
  state?: TamagotchiState;
}

const DEFAULT_SETTINGS: TamagotchiPluginSettings = {
  tickIntervalSeconds: 60,
  autoOpenOnStart: true,
  enableAnimations: true,
  enableAudio: false,
  petName: "Neko",
  state: undefined,
};

export default class TamagotchiPlugin extends Plugin {
  settings: TamagotchiPluginSettings;
  audioCtx: AudioContext | null = null;
  audioUnlocked = false;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new TamagotchiView(this.app, leaf, this)
    );

    this.addCommand({
      id: "open-tamagotchi-sidebar",
      name: "Toggle Tamagotchi sidebar",
      callback: () => this.toggleView(),
    });

    this.addRibbonIcon("smiley", "Tamagotchi", () => {
      this.toggleView();
    });

    this.addSettingTab(new TamagotchiSettingTab(this.app, this));

    if (this.settings.autoOpenOnStart) {
      this.app.workspace.onLayoutReady(() => {
        this.openView();
      });
    }
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.state) {
      this.settings.state = createNewPetState(this.settings.petName);
    } else {
      // Sync name in settings
      this.settings.petName = this.settings.state.name;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) {
      this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    } else {
      this.openView();
    }
  }

  openView(side: "right" | "left" = "right") {
    this.app.workspace.getRightLeaf(false).setViewState({
      type: VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]);
  }

  ensureAudioContext() {
    if (this.audioCtx) return;
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn("AudioContext not available", e);
      this.audioCtx = null;
    }
  }

  async unlockAudio() {
    this.ensureAudioContext();
    if (!this.audioCtx) return false;
    if (this.audioCtx.state === "suspended") {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn("Could not resume audio context", e);
      }
    }
    if (this.audioCtx.state === "running") {
      this.audioUnlocked = true;
      this.settings.enableAudio = true;
      await this.saveSettings();
      return true;
    }
    return false;
  }

  beep(frequency = 600, durationMs = 120, volume = 0.05) {
    if (!this.settings.enableAudio) return;
    this.ensureAudioContext();
    if (!this.audioCtx) return;
    if (!this.audioUnlocked) return; // require unlock
    try {
      const o = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = frequency;
      gain.gain.value = volume;
      o.connect(gain);
      gain.connect(this.audioCtx.destination);
      o.start();
      o.stop(this.audioCtx.currentTime + durationMs / 1000);
    } catch (e) {
      console.warn("beep failed", e);
    }
  }
}

function createNewPetState(name = "Neko"): TamagotchiState {
  return {
    name,
    hunger: 80,
    energy: 90,
    happiness: 85,
    cleanliness: 95,
    ageMinutes: 0,
    alive: true,
    sleeping: false,
    lastTick: Date.now(),
    animationFrame: 0,
  };
}

/* View & UI */
class TamagotchiView extends ItemView {
  plugin: TamagotchiPlugin;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  barContainer: HTMLElement;
  tickTimer: number | null = null;
  animTimer: number | null = null;

  constructor(app: App, leaf: WorkspaceLeaf, plugin: TamagotchiPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Tamagotchi"; }
  getIcon() { return "dice"; }

  async onOpen() {
    this.contentEl.empty();

    const header = this.contentEl.createEl("div", { cls: "tama-header" });
    header.createEl("h3", { text: "Tamagotchi" });
    header.createEl("div", { cls: "tama-name", text: this.plugin.settings.petName });

    this.canvas = this.contentEl.createEl("canvas", { cls: "tama-canvas" });
    this.canvas.width = 128;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext("2d")!;

    this.barContainer = this.contentEl.createEl("div", { cls: "tama-bars" });
    this.renderBars();

    const actions = this.contentEl.createEl("div", { cls: "tama-actions" });
    this.createActionButton(actions, "Feed", () => this.doFeed());
    this.createActionButton(actions, "Play", () => this.doPlay());
    this.createActionButton(actions, "Sleep/Wake", () => this.doToggleSleep());
    this.createActionButton(actions, "Clean", () => this.doClean());
    this.createActionButton(actions, "Stats", () => this.showStats());
    this.createActionButton(actions, "Reset", () => this.resetPet());

    // Audio enable button (user gesture needed for iOS)
    const audioRow = this.contentEl.createEl("div", { cls: "tama-settings" });
    const enableAudioBtn = audioRow.createEl("button", { text: this.plugin.settings.enableAudio ? "Audio: Enabled" : "Enable audio", cls: "tama-btn" });
    enableAudioBtn.addEventListener("click", async () => {
      const ok = await this.plugin.unlockAudio();
      if (ok) {
        enableAudioBtn.textContent = "Audio: Enabled";
        new Notice("Audio enabled for Tamagotchi");
      } else {
        enableAudioBtn.textContent = "Audio: Unavailable";
        new Notice("Could not enable audio on this device.");
      }
    });

    this.contentEl.createEl("div", { cls: "tama-footer" });

    this.startTicker();
    this.startAnimationLoop();
    this.render();
  }

  async onClose() {
    this.stopTicker();
    this.stopAnimationLoop();
  }

  createActionButton(container: HTMLElement, label: string, onClick: () => void) {
    const btn = container.createEl("button", { text: label, cls: "tama-btn" });
    btn.addEventListener("click", async () => {
      // user gesture -> safe to unlock audio if requested
      if (!this.plugin.audioUnlocked && this.plugin.settings.enableAudio) {
        await this.plugin.unlockAudio();
      }
      onClick();
    });
    return btn;
  }

  startTicker() {
    this.stopTicker();
    const intervalMs = Math.max(1000, this.plugin.settings.tickIntervalSeconds * 1000);
    this.tickTimer = window.setInterval(() => this.tick(), intervalMs);
  }

  stopTicker() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  startAnimationLoop() {
    this.stopAnimationLoop();
    if (!this.plugin.settings.enableAnimations) return;
    this.animTimer = window.setInterval(() => {
      const s = this.plugin.settings.state!;
      s.animationFrame = (s.animationFrame + 1) % 4;
      this.render();
    }, 400);
  }

  stopAnimationLoop() {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
  }

  async tick() {
    const s = this.plugin.settings.state!;
    if (!s.alive) {
      this.render();
      await this.plugin.saveSettings();
      return;
    }
    const now = Date.now();
    const elapsedMinutes = Math.max(1, Math.round((now - s.lastTick) / 60000));
    s.lastTick = now;
    s.ageMinutes += elapsedMinutes;

    const hungerDecay = 1 * elapsedMinutes;
    const energyDecay = s.sleeping ? 0.5 * elapsedMinutes : 1.5 * elapsedMinutes;
    const happinessDecay = 0.5 * elapsedMinutes;
    const cleanlinessDecay = 0.3 * elapsedMinutes;

    s.hunger = clamp(s.hunger - hungerDecay, 0, 100);
    s.energy = clamp(s.energy - energyDecay, 0, 100);
    s.happiness = clamp(s.happiness - happinessDecay, 0, 100);
    s.cleanliness = clamp(s.cleanliness - cleanlinessDecay, 0, 100);

    if (s.hunger < 20 || s.energy < 15) {
      s.happiness = clamp(s.happiness - 1 * elapsedMinutes, 0, 100);
    }

    if (s.hunger <= 0 && s.energy <= 0) {
      s.alive = false;
    }

    await this.plugin.saveSettings();
    this.render();
  }

  renderBars() {
    this.barContainer.empty();
    const s = this.plugin.settings.state!;
    this.barContainer.createEl("div", { cls: "tama-bar-row" }).appendChild(makeStatBar("Hunger", s.hunger, "hunger"));
    this.barContainer.createEl("div", { cls: "tama-bar-row" }).appendChild(makeStatBar("Energy", s.energy, "energy"));
    this.barContainer.createEl("div", { cls: "tama-bar-row" }).appendChild(makeStatBar("Happiness", s.happiness, "happiness"));
    this.barContainer.createEl("div", { cls: "tama-bar-row" }).appendChild(makeStatBar("Clean", s.cleanliness, "cleanliness"));
  }

  render() {
    this.drawPet();
    const s = this.plugin.settings.state!;
    const nameEl = this.contentEl.querySelector(".tama-name");
    if (nameEl) nameEl.textContent = `${s.name}${s.alive ? "" : " (💀)"}${s.sleeping ? " (zzz)" : ""}`;
    this.renderBars();
    const footer = this.contentEl.querySelector(".tama-footer");
    if (footer) {
      footer.textContent = `Age: ${Math.floor(s.ageMinutes / 60)}h ${s.ageMinutes % 60}m — ${s.alive ? "Alive" : "Gone"}`;
    }
  }

  drawPet() {
    const s = this.plugin.settings.state!;
    const ctx = this.ctx;
    // Clear
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // screen background
    const size = 16;
    const pixel = 7;
    const w = size, h = size;
    ctx.fillStyle = "#dfe6f2";
    ctx.fillRect(8, 8, w * pixel - 16, h * pixel - 16);

    // sprite selection: uses animation frame for small motions
    const sprite = getSpriteForStateAnimated(s, this.plugin.settings.enableAnimations ? s.animationFrame : 0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const value = sprite[y] ? sprite[y][x] : 0;
        if (!value) continue;
        ctx.fillStyle = value === 1 ? "#111" : value === 2 ? "#000" : "#444";
        ctx.fillRect(x * pixel + 8, y * pixel + 8, pixel - 1, pixel - 1);
      }
    }
  }

  async doFeed() {
    const s = this.plugin.settings.state!;
    if (!s.alive) return;
    s.hunger = clamp(s.hunger + 25, 0, 100);
    s.happiness = clamp(s.happiness + 5, 0, 100);
    await this.plugin.saveSettings();
    this.plugin.beep(700, 100, 0.06);
    this.render();
  }

  async doPlay() {
    const s = this.plugin.settings.state!;
    if (!s.alive) return;
    if (s.energy < 10) {
      s.happiness = clamp(s.happiness - 5, 0, 100);
      this.plugin.beep(250, 120, 0.05);
    } else {
      s.happiness = clamp(s.happiness + 15, 0, 100);
      s.energy = clamp(s.energy - 10, 0, 100);
      s.hunger = clamp(s.hunger - 5, 0, 100);
      this.plugin.beep(900, 120, 0.06);
    }
    await this.plugin.saveSettings();
    this.render();
  }

  async doToggleSleep() {
    const s = this.plugin.settings.state!;
    if (!s.alive) return;
    s.sleeping = !s.sleeping;
    if (s.sleeping) {
      // sleeping restores energy slowly outside main tick
      const interval = setInterval(async () => {
        if (!s.sleeping || !s.alive) {
          clearInterval(interval);
          return;
        }
        s.energy = clamp(s.energy + 5, 0, 100);
        s.hunger = clamp(s.hunger - 2, 0, 100);
        await this.plugin.saveSettings();
        this.render();
      }, 5000);
    }
    await this.plugin.saveSettings();
    this.plugin.beep(440, 120, 0.04);
    this.render();
  }

  async doClean() {
    const s = this.plugin.settings.state!;
    if (!s.alive) return;
    s.cleanliness = 100;
    s.happiness = clamp(s.happiness + 7, 0, 100);
    await this.plugin.saveSettings();
    this.plugin.beep(720, 80, 0.04);
    this.render();
  }

  showStats() {
    const s = this.plugin.settings.state!;
    new Notice(`H:${Math.round(s.hunger)} E:${Math.round(s.energy)} ☺:${Math.round(s.happiness)} C:${Math.round(s.cleanliness)} Age:${s.ageMinutes}m`);
  }

  async resetPet() {
    // confirm
    const confirmed = confirm("Reset your Tamagotchi to a new baby?");
    if (!confirmed) return;
    this.plugin.settings.state = createNewPetState(this.plugin.settings.petName);
    await this.plugin.saveSettings();
    this.render();
  }
}

/* Settings tab */
class TamagotchiSettingTab extends PluginSettingTab {
  plugin: TamagotchiPlugin;
  constructor(app: App, plugin: TamagotchiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h3", { text: "Tamagotchi settings" });

    new Setting(containerEl)
      .setName("Pet name")
      .setDesc("Name shown for your Tamagotchi")
      .addText(text =>
        text
          .setValue(this.plugin.settings.petName)
          .onChange(async (value) => {
            this.plugin.settings.petName = value;
            if (this.plugin.settings.state) this.plugin.settings.state.name = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tick interval (seconds)")
      .setDesc("How often the background tick runs to age/decay stats.")
      .addText(text =>
        text
          .setValue(String(this.plugin.settings.tickIntervalSeconds))
          .onChange(async (v) => {
            const n = Math.max(5, Number(v) || 60);
            this.plugin.settings.tickIntervalSeconds = n;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable animations")
      .setDesc("Enable small sprite animations (disable to save battery).")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enableAnimations)
          .onChange(async (v) => {
            this.plugin.settings.enableAnimations = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable audio (mobile requires tap)")
      .setDesc("Enable small sound effects. On iOS you must tap the Enable Audio button in the plugin UI after installing.")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enableAudio)
          .onChange(async (v) => {
            this.plugin.settings.enableAudio = v;
            if (!v) this.plugin.audioUnlocked = false;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-open on app start")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoOpenOnStart)
          .onChange(async (v) => {
            this.plugin.settings.autoOpenOnStart = v;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("hr");
    containerEl.createEl("div", { text: "Tip: On iOS, use Files or Shortcuts to place the plugin folder in your vault at /<Vault>/.obsidian/plugins/ and then enable the plugin in Obsidian mobile.", cls: "setting-item-description" });
  }
}

/* Helpers and sprites/animation */
function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

// sprite frames: small variations for breathing or blinking
type Sprite = number[][];
function blankSprite(): Sprite {
  const arr: number[][] = [];
  for (let y = 0; y < 16; y++) {
    arr.push(new Array(16).fill(0));
  }
  return arr;
}

function baseFace(): Sprite {
  const p = blankSprite();
  const draw = (x: number, y: number) => (p[y][x] = 1);
  draw(4,2); draw(5,1); draw(6,0); draw(9,0); draw(10,1); draw(11,2);
  for (let x=3;x<=12;x++){draw(x,3); draw(x,4);}
  for (let x=4;x<=11;x++){draw(x,5);}
  draw(6,6); draw(9,6);
  draw(7,8); draw(8,9);
  return p;
}

function getSpriteForStateAnimated(s: TamagotchiState, frame: number): Sprite {
  if (!s.alive) return deadSprite();
  if (s.sleeping) return sleepingSprite();
  if (s.hunger < 20) return hungrySprite();
  if (s.happiness > 80) return happyAnimated(frame);
  return neutralAnimated(frame);
}

function neutralAnimated(frame = 0): Sprite {
  const p = baseFace();
  // small blink on frame 2
  if ((frame % 4) === 2) {
    p[6][6] = 0; p[9][6] = 0; // blink eyes
    p[6][7] = 1; p[9][7] = 1;
  }
  return p;
}

function happyAnimated(frame = 0): Sprite {
  const p = baseFace();
  // bigger smile and small bounce by using a second pixel when frame 1/3
  if ((frame % 4) === 1 || (frame % 4) === 3) {
    p[7][7] = 1; p[8][7] = 1;
  }
  return p;
}

function hungrySprite(): Sprite {
  const p = baseFace();
  p[8][7] = 1; p[7][8] = 1; p[7][6] = 1;
  p[6][11] = 1; p[7][11] = 1;
  return p;
}

function sleepingSprite(): Sprite {
  const p = blankSprite();
  p[4][4]=1; p[5][5]=1; p[6][6]=1;
  p[4][6]=1; p[5][7]=1; p[6][8]=1;
  p[8][5]=1; p[9][6]=1;
  return p;
}

function deadSprite(): Sprite {
  const p = blankSprite();
  p[6][6]=1; p[7][7]=1; p[6][7]=1; p[7][6]=1;
  p[6][9]=1; p[7][8]=1; p[7][9]=1; p[6][8]=1;
  p[9][7]=1; p[9][8]=1; p[10][7]=1; p[10][8]=1;
  return p;
}

/* small UI helpers reused from earlier demo */
function makeStatBar(label: string, value: number, clsSuffix: string) {
  const wrapper = document.createElement("div");
  wrapper.className = "tama-stat";
  const labelEl = document.createElement("div");
  labelEl.className = "tama-stat-label";
  labelEl.textContent = `${label}: ${Math.round(value)}%`;
  wrapper.appendChild(labelEl);
  const barOut = document.createElement("div");
  barOut.className = "tama-stat-bar";
  const barIn = document.createElement("div");
  barIn.className = `tama-stat-fill ${clsSuffix}`;
  barIn.style.width = `${value}%`;
  barOut.appendChild(barIn);
  wrapper.appendChild(barOut);
  return wrapper;
}
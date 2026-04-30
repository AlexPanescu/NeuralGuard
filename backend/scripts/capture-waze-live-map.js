/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright-core");

const DEFAULT_BBOX = {
  bottom: 44.25,
  left: 25.8,
  top: 44.62,
  right: 26.35,
};

function parseArgs(argv) {
  const parsed = {
    out: path.join(process.cwd(), "tmp", "waze-georss-snapshot.json"),
    bbox: { ...DEFAULT_BBOX },
    grid: Math.max(1, Number.parseInt(process.env.INCIDENTS_WAZE_GRID_SIZE || "2", 10) || 2),
    waitSeconds: Math.max(0, Number.parseInt(process.env.WAZE_CAPTURE_WAIT_SECONDS || "0", 10) || 0),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      parsed.out = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--bbox" && argv[i + 1]) {
      const raw = String(argv[i + 1]);
      const parts = raw.split(",").map((chunk) => Number.parseFloat(chunk.trim()));
      if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
        parsed.bbox = {
          bottom: Math.min(parts[0], parts[2]),
          left: Math.min(parts[1], parts[3]),
          top: Math.max(parts[0], parts[2]),
          right: Math.max(parts[1], parts[3]),
        };
      }
      i += 1;
      continue;
    }
    if (arg === "--grid" && argv[i + 1]) {
      const grid = Number.parseInt(String(argv[i + 1]), 10);
      if (Number.isFinite(grid) && grid > 0) {
        parsed.grid = Math.max(1, Math.min(6, grid));
      }
      i += 1;
      continue;
    }
    if (arg === "--wait-seconds" && argv[i + 1]) {
      const waitSeconds = Number.parseInt(String(argv[i + 1]), 10);
      if (Number.isFinite(waitSeconds) && waitSeconds >= 0) {
        parsed.waitSeconds = Math.max(0, Math.min(600, waitSeconds));
      }
      i += 1;
    }
  }
  return parsed;
}

function findBrowserExecutable() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    console.error("Could not find Edge/Chrome executable.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
    executablePath,
  });

  const context = await browser.newContext({
    locale: "ro-RO",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    console.log("Opening Waze Live Map...");
    await page.goto("https://www.waze.com/ro/live-map/", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForTimeout(2500);

    console.log("Resolve CAPTCHA manually in browser.");
    if (args.waitSeconds > 0) {
      console.log(`Capturing Waze data automatically in ${args.waitSeconds} seconds...`);
      await sleep(args.waitSeconds * 1000);
    } else {
      console.log("Press ENTER when ready to capture Waze data.");
      await ask("> ");
    }

    const payload = await page.evaluate(async (input) => {
      const bbox = input?.bbox || {};
      const gridSize = Math.max(1, Number.parseInt(String(input?.grid || 1), 10) || 1);
      const readCookie = (name) => {
        const parts = document.cookie.split(";").map((item) => item.trim());
        for (const part of parts) {
          if (part.startsWith(`${name}=`)) {
            return decodeURIComponent(part.slice(name.length + 1));
          }
        }
        return "";
      };

      const scriptSrc = Array.from(document.querySelectorAll("script[src]"))
        .map((node) => node.src || "")
        .find((src) => src.includes("recaptcha/enterprise.js"));
      const keyMatch = scriptSrc ? scriptSrc.match(/[?&]render=([^&]+)/) : null;
      const recaptchaSiteKey = keyMatch ? decodeURIComponent(keyMatch[1]) : "";

      let recaptchaActionToken = "";
      try {
        if (
          recaptchaSiteKey
          && window.grecaptcha
          && window.grecaptcha.enterprise
          && window.grecaptcha.enterprise.execute
        ) {
          recaptchaActionToken = await window.grecaptcha.enterprise.execute(recaptchaSiteKey, { action: "api" });
        }
      } catch (_err) {
        recaptchaActionToken = "";
      }

      const headers = {};
      const csrfToken = readCookie("_csrf_token");
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      if (recaptchaActionToken) headers["X-Recaptcha-Token"] = recaptchaActionToken;

      const buildBoxes = () => {
        if (gridSize <= 1) return [bbox];
        const boxes = [];
        const latStep = (bbox.top - bbox.bottom) / gridSize;
        const lonStep = (bbox.right - bbox.left) / gridSize;
        for (let row = 0; row < gridSize; row += 1) {
          for (let col = 0; col < gridSize; col += 1) {
            boxes.push({
              bottom: bbox.bottom + row * latStep,
              top: row === gridSize - 1 ? bbox.top : bbox.bottom + (row + 1) * latStep,
              left: bbox.left + col * lonStep,
              right: col === gridSize - 1 ? bbox.right : bbox.left + (col + 1) * lonStep,
            });
          }
        }
        return boxes;
      };

      const itemKey = (item) => {
        if (!item || typeof item !== "object") return "";
        return String(item.uuid || item.id || item.wazeData || item.reportBy || "")
          || JSON.stringify(item);
      };

      const mergeList = (target, incoming) => {
        const seen = new Set(target.map((item) => itemKey(item)));
        for (const item of incoming) {
          const key = itemKey(item);
          if (seen.has(key)) continue;
          seen.add(key);
          target.push(item);
        }
      };

      let merged = { alerts: [], jams: [], users: [] };
      let successCount = 0;
      let lastStatus = 0;
      let sample = "";
      for (const box of buildBoxes()) {
        const params = new URLSearchParams({
          top: String(box.top),
          bottom: String(box.bottom),
          left: String(box.left),
          right: String(box.right),
          env: "row",
          types: "alerts,traffic,users",
        });
        const response = await fetch(`/live-map/api/georss?${params.toString()}`, { headers });
        lastStatus = response.status;
        const text = await response.text();
        if (!sample) sample = text.slice(0, 220);
        if (response.status !== 200) continue;
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (_err) {
          json = null;
        }
        if (!json || typeof json !== "object") continue;
        successCount += 1;
        const alerts = Array.isArray(json.alerts) ? json.alerts : [];
        const jams = Array.isArray(json.jams) ? json.jams : [];
        const users = Array.isArray(json.users) ? json.users : [];
        mergeList(merged.alerts, alerts);
        mergeList(merged.jams, jams);
        mergeList(merged.users, users);
      }

      return {
        status: successCount > 0 ? 200 : lastStatus,
        hasCsrf: Boolean(csrfToken),
        hasRecaptchaCookie: Boolean(readCookie("recaptcha-ca-t")),
        hasRecaptchaActionToken: Boolean(recaptchaActionToken),
        sample,
        payload: successCount > 0 ? merged : null,
        grid: gridSize,
        successfulRequests: successCount,
      };
    }, { bbox: args.bbox, grid: args.grid });

    if (payload.status !== 200 || !payload.payload || typeof payload.payload !== "object") {
      console.error("Failed to capture Waze GeoRSS data.");
      console.error(`Status: ${payload.status}`);
      console.error(`Sample: ${payload.sample}`);
      process.exit(2);
    }

    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      args.out,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          bbox: args.bbox,
          source: "waze_live_map_browser_capture",
          status: payload.status,
          payload: payload.payload,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`Waze snapshot saved to: ${args.out}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

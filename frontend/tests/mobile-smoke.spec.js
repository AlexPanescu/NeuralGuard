import { expect, test } from "@playwright/test";

const dashboardRiskResponse = {
  locationReady: true,
  riskStatus: {
    level: "Elevated",
    score: 58,
    trend: "Escalating",
    confidence: "High",
    lastUpdated: "2026-04-14T08:45:00.000Z",
    locationLabel: "Bucharest, Sector 1",
    summary: "Traffic pressure and local alerts are elevated. Keep your essentials close and monitor route changes.",
  },
  riskDrivers: [
    { id: "traffic", label: "Traffic", explanation: "Major pressure on arterial routes.", score: 66, direction: "up" },
    { id: "weather", label: "Weather", explanation: "Conditions remain changeable nearby.", score: 44, direction: "steady" },
  ],
  scoringMeta: {
    incidentsUsed: 2,
    newsUsed: 2,
    lastComputedAt: "2026-04-14T08:45:00.000Z",
  },
};

const dashboardNews = [
  {
    id: "news-1",
    title: "Transit reroutes announced",
    summary: "Authorities introduced temporary reroutes near the center.",
    source: "City Desk",
    articleUrl: "https://example.com/news-1",
    imageUrl: "",
    content: "Transit reroutes were announced for multiple central corridors to reduce congestion.",
    tags: ["Transit", "Traffic"],
    publishedAt: "2026-04-14T08:30:00.000Z",
  },
  {
    id: "news-2",
    title: "Emergency teams on standby",
    summary: "Emergency teams remain on standby as risk signals stay elevated.",
    source: "Rapid Wire",
    articleUrl: "https://example.com/news-2",
    imageUrl: "",
    content: "Emergency response teams remain prepared for quick interventions across the city.",
    tags: ["Emergency"],
    publishedAt: "2026-04-14T07:50:00.000Z",
  },
];

const mapIncidents = [
  {
    id: "incident-1",
    title: "Blocked road near Piata Victoriei",
    severity: "high",
    status: "open",
    type: "blocked_road",
    source: "manual",
    dangerScore: 74,
    location: { lat: 44.4525, lon: 26.0871, address: "Piata Victoriei" },
    createdAt: "2026-04-14T08:00:00.000Z",
    updatedAt: "2026-04-14T08:10:00.000Z",
  },
];

const notifications = [
  {
    id: "notification-1",
    title: "New safety update available",
    message: "Route conditions changed near the center.",
    type: "warning",
    link: "/notifications",
    createdAt: "2026-04-14T08:40:00.000Z",
  },
];

async function mockApiRoutes(page) {
  await page.route("**/api/me/location", async (route) => {
    await route.fulfill({ json: { location: null } });
  });

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: "user-1",
          name: "Mobile Tester",
          profilePicture: "",
        },
      },
    });
  });

  await page.route("**/api/dashboard/personal-risk", async (route) => {
    await route.fulfill({ json: dashboardRiskResponse });
  });

  await page.route("**/api/dashboard/news/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const itemId = requestUrl.pathname.split("/").pop();
    const item = dashboardNews.find((entry) => entry.id === itemId) || dashboardNews[0];
    await route.fulfill({ json: item });
  });

  await page.route("**/api/dashboard/news", async (route) => {
    await route.fulfill({ json: dashboardNews });
  });

  await page.route("**/api/dashboard/intelligence**", async (route) => {
    await route.fulfill({ json: { news: dashboardNews } });
  });

  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ json: notifications });
  });

  await page.route("**/api/incidents", async (route) => {
    await route.fulfill({ json: mapIncidents });
  });

  await page.route("**/api/sos/alert", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        alert: {
          _id: "alert-1",
          id: "alert-1",
          type: "SOS",
          message: "AM NEVOIE DE AJUTOR! SOS!",
          status: "active",
          priority: "critical",
          incidentId: "incident-sos-1",
          lastKnownLocation: { lat: 44.42, lng: 26.1, timestamp: "2026-04-14T08:50:00.000Z" },
          contacts: [
            {
              name: "Family",
              notifiedStatus: "not_available",
              error: "No SMS/email delivery provider is configured in this phase.",
            },
          ],
          createdAt: "2026-04-14T08:50:00.000Z",
        },
        incident: {
          id: "incident-sos-1",
          _id: "incident-sos-1",
          title: "SOS Mobile Tester",
          status: "active",
          severity: "critical",
        },
        copilotSessionId: "copilot-1",
        recommendedGuides: [],
        initialActionChecklist: [],
        initialRecommendation: "Ramai in siguranta si suna 112 daca pericolul este imediat.",
        escalateNow: true,
      },
    });
  });

  await page.route("**/api/sos/alert/*/location", async (route) => {
    await route.fulfill({ json: { success: true, alert: { id: "alert-1", status: "active" } } });
  });

  await page.route("**/api/sos/alert/*/resolve", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        alert: { id: "alert-1", _id: "alert-1", status: "resolved", resolvedAt: "2026-04-14T08:55:00.000Z" },
      },
    });
  });

  await page.route("**/api/chat/messages**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const channel = requestUrl.searchParams.get("channel");
    await route.fulfill({
      json: channel === "global"
        ? [
            {
              id: "message-1",
              author: "Dispatch",
              authorId: "dispatch-1",
              text: "Stay ready for route changes.",
              timestamp: "2026-04-14T08:42:00.000Z",
              reactedBy: [],
              replyTo: null,
            },
          ]
        : [],
    });
  });
}

async function longPressMapCenter(page) {
  const canvas = page.locator(".map-canvas");
  const box = await canvas.boundingBox();
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };

  await page.evaluate(({ x, y }) => {
    const target = document.querySelector(".maplibregl-canvas-container") || document.querySelector(".map-canvas");
    if (window.PointerEvent) {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
    }
    target.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, point);

  await page.waitForTimeout(2150);

  await page.evaluate(({ x, y }) => {
    const target = document.querySelector(".maplibregl-canvas-container") || document.querySelector(".map-canvas");
    if (window.PointerEvent) {
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
    }
    target.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, point);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "currentUser",
      JSON.stringify({
        id: "user-1",
        name: "Mobile Tester",
      }),
    );
  });
  await mockApiRoutes(page);
});

test("dashboard mobile shell supports drawer and sheet overlays", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.locator(".crisis-mode-strip")).toBeVisible();
  await expect(page.locator(".dashboard-hero")).toBeVisible();
  await expect(page.locator(".offline-essentials-card")).toContainText(/offline essentials/i);
  await page.getByRole("button", { name: /open navigation menu/i }).click();
  await expect(page.locator(".mobile-sidebar-layer.is-open")).toBeVisible();
  await expect(page.locator(".mobile-sidebar-drawer")).toBeVisible();
  await expect(page.locator(".mobile-nav-card.is-active")).toContainText(/dashboard/i);

  await page.locator(".mobile-sidebar-profile").click();
  await expect(page.locator(".mobile-sidebar-sheet.is-visible").filter({ hasText: /account/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /account settings/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  await page.getByRole("button", { name: /close account actions/i }).click();

  await page.locator(".mobile-sidebar-notify").click();
  await expect(page.locator(".mobile-sidebar-sheet.is-visible").filter({ hasText: /notifications/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /new safety update available/i })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.dispatchEvent(new Event("openLoginModal")));
  await expect(page.locator(".login-modal-content")).toBeVisible();
  await page.getByRole("button", { name: /close sign in/i }).click();

  const firstNewsCard = page.locator(".editorial-news-button").first();
  await expect(firstNewsCard).toBeVisible();
  await firstNewsCard.click();
  await expect(page.locator(".news-details-modal")).toBeVisible();
  await page.locator(".news-details-close").click();
});

test("map page switches between incidents and resources in mobile sheet", async ({ page }) => {
  await page.goto("/map");

  await expect(page.locator(".map-canvas")).toBeVisible();

  await expect(page.locator(".map-mobile-sheet")).toBeVisible();

  await page.getByRole("button", { name: /arata legenda/i }).click();
  await expect(page.locator(".map-legend")).toBeVisible();

  await page.getByRole("tab", { name: "Resources" }).click();
  await expect(page.locator(".map-mobile-panel")).toContainText(/resurse|adapost/i);
  await page.getByRole("tab", { name: "Incidents" }).click();
  await expect(page.locator(".map-mobile-panel")).toContainText(/blocked road|incidente|piata victoriei/i);
});

test("map current location action saves local fallback when account api fails", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 44.43047, longitude: 26.10117 });
  await page.route("**/api/me/location", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 503, json: { error: "offline" } });
      return;
    }
    await route.fulfill({ json: { location: null } });
  });

  await page.goto("/map");
  await page.getByRole("button", { name: /foloseste locatia mea curenta/i }).click();
  await expect(page.locator(".save-message")).toContainText(/saved locally/i);
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("mapSavedLocation")));
  expect(stored.coordinates.lat).toBeCloseTo(44.43047, 4);
  expect(stored.coordinates.lon).toBeCloseTo(26.10117, 4);
});

test("map current location button explains insecure context", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  });
  await page.goto("/map");
  await page.getByRole("button", { name: /foloseste locatia mea curenta/i }).click();
  await expect(page.locator(".save-message")).toContainText(/https sau localhost/i);
});

test("map long press can save or cancel custom location", async ({ page }) => {
  await page.route("**/api/me/location", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 503, json: { error: "offline" } });
      return;
    }
    await route.fulfill({ json: { location: null } });
  });

  await page.goto("/map");
  await expect(page.locator(".map-canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__mapLongPressReady))).toBe(true);
  await page.evaluate(() => {
    window.__confirmResponses = [false, true];
    window.__confirmMessages = [];
    window.confirm = (message) => {
      window.__confirmMessages.push(message);
      return window.__confirmResponses.shift() ?? false;
    };
  });

  await longPressMapCenter(page);
  await expect.poll(() => page.evaluate(() => window.__confirmMessages.length)).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__confirmMessages[0]))
    .toContain("Vrei să setezi");
  expect(await page.evaluate(() => window.localStorage.getItem("mapSavedLocation"))).toBeNull();

  await longPressMapCenter(page);
  await expect.poll(() => page.evaluate(() => window.__confirmMessages.length)).toBe(2);
  await expect(page.locator(".save-message")).toContainText(/saved locally|locatie salvata/i);
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("mapSavedLocation")));
  expect(stored.name).toBe("Custom location");
  expect(stored.source).toBe("manual_map");
  await expect(page.locator(".user-location-marker")).toBeVisible();
  const markerRadius = await page.locator(".user-location-marker").evaluate((node) => getComputedStyle(node).borderRadius);
  expect(markerRadius).toBe("50%");
});

test("communication mobile tabs keep chat composer visible", async ({ page }) => {
  await page.goto("/communication");
  const chatComposer = page.locator(".chat-card .chat-input");

  await expect(page.locator(".comm-mobile-tabs")).toBeVisible();
  await expect(chatComposer).toBeVisible();

  await page.getByRole("tab", { name: "Channels" }).click();
  await expect(page.locator(".devices-card")).toBeVisible();

  await page.getByRole("tab", { name: "Quick" }).click();
  await expect(page.locator(".quick-card")).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.locator(".crisis-strip-status")).toContainText(/offline/i);
  await page.locator(".quick-card .quick-list button").first().click();
  await expect(page.locator(".comm-queue-status")).toContainText(/message queued locally/i);
  await expect(page.locator(".queued-messages-panel")).toContainText(/queued local messages/i);
  await expect(page.locator(".queued-message-item")).toHaveCount(1);
  await expect(page.locator(".crisis-queued-link")).toContainText(/queued 1/i);
  await expect(page.locator(".queued-send-btn")).toBeDisabled();
  await expect(page.locator(".queued-send-btn")).toContainText(/needs connection to send/i);
  await page.context().setOffline(false);
  await expect(page.locator(".crisis-strip-status")).toContainText(/online/i);
  await expect(page.locator(".queued-send-btn")).toBeEnabled();
  await page.locator(".queued-send-btn").click();
  await expect(page.locator(".queued-status-badge.sent")).toContainText(/sent/i);
  await expect(page.locator(".queued-message-note")).toContainText(/sent locally via socket/i);
  await page.getByRole("button", { name: /clear sent/i }).click();
  await expect(page.locator(".queued-message-item")).toHaveCount(0);

  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(chatComposer).toBeVisible();
  await expect(page.getByPlaceholder(/mesaj in canalul global/i)).toBeVisible();
});

test("sos page shows honest active lifecycle and offline copy", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 44.4268, longitude: 26.1025 });
  await page.goto("/sos");
  await expect(page.locator(".sos-local-status")).toContainText(/live sos available/i);
  await page.getByRole("button", { name: /^SOS/i }).click();
  await page.getByRole("button", { name: /trimite sos/i }).click();
  await expect(page.locator(".sos-lifecycle-panel")).toContainText(/SOS active/i, { timeout: 6000 });
  await expect(page.locator(".sos-lifecycle-panel")).toContainText(/not available/i);
  await page.getByRole("button", { name: /opreste sos/i }).click();
  await expect(page.locator(".sos-status")).toContainText(/standby/i);

  await page.evaluate(() => window.localStorage.setItem("crisisModePreference", "offline-ready"));
  await page.reload();
  await expect(page.locator(".sos-local-status")).toContainText(
    "SOS live requires connection. Call emergency services if in immediate danger.",
  );
  await page.evaluate(() => window.localStorage.setItem("crisisModePreference", "auto"));
});

test("sos falls back to saved map location when gps is denied", async ({ page }) => {
  let sosPayload = null;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success, error) => error({ code: 1, message: "denied" }),
        watchPosition: () => 1,
        clearWatch: () => {},
      },
    });
    window.localStorage.setItem(
      "mapSavedLocation",
      JSON.stringify({
        name: "Test",
        raw: '44°25\'49.7"N 26°06\'04.2"E',
        coordinates: { lat: 44.43047, lon: 26.10117 },
      }),
    );
  });
  await page.route("**/api/me/location", async (route) => {
    await route.fulfill({ status: 503, json: { error: "offline" } });
  });
  await page.route("**/api/sos/alert", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sosPayload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        success: true,
        alert: {
          id: "alert-map-fallback",
          _id: "alert-map-fallback",
          status: "active",
          contacts: [],
          lastKnownLocation: sosPayload.location,
          createdAt: "2026-04-14T08:50:00.000Z",
        },
        incident: { id: "incident-map-fallback", _id: "incident-map-fallback", title: "SOS fallback" },
        copilotSessionId: "",
        recommendedGuides: [],
        initialActionChecklist: [],
        initialRecommendation: "",
        escalateNow: false,
      },
    });
  });

  await page.goto("/sos");
  await page.getByRole("button", { name: /^SOS/i }).click();
  await page.getByRole("button", { name: /trimite sos/i }).click();
  await expect(page.locator(".sos-location-status")).toContainText(/last saved map location/i, { timeout: 7000 });
  expect(sosPayload.location.lat).toBeCloseTo(44.43047, 4);
  expect(sosPayload.location.lon).toBeCloseTo(26.10117, 4);
  expect(sosPayload.location.lng).toBeCloseTo(26.10117, 4);
  expect(sosPayload.location.resolvedFrom).toBe("mapSavedLocation");
});

test("sos skips gps immediately in insecure context and uses saved map fallback", async ({ page }) => {
  let geolocationCalled = false;
  let sosPayload = null;
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: () => {
          window.__geoCalled = true;
        },
        watchPosition: () => 1,
        clearWatch: () => {},
      },
    });
    window.__geoCalled = false;
    window.localStorage.setItem(
      "mapSavedLocation",
      JSON.stringify({
        name: "HTTP fallback",
        raw: "44.430470, 26.101170",
        coordinates: { lat: 44.43047, lon: 26.10117 },
      }),
    );
  });
  await page.route("**/api/me/location", async (route) => {
    await route.fulfill({ status: 503, json: { error: "offline" } });
  });
  await page.route("**/api/sos/alert", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sosPayload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        success: true,
        alert: {
          id: "alert-insecure",
          _id: "alert-insecure",
          status: "active",
          contacts: [],
          lastKnownLocation: sosPayload.location,
          createdAt: "2026-04-14T08:50:00.000Z",
        },
        incident: { id: "incident-insecure", _id: "incident-insecure", title: "SOS insecure" },
        copilotSessionId: "",
        recommendedGuides: [],
        initialActionChecklist: [],
        initialRecommendation: "",
        escalateNow: false,
      },
    });
  });

  await page.goto("/sos");
  await page.getByRole("button", { name: /^SOS/i }).click();
  await page.getByRole("button", { name: /trimite sos/i }).click();
  await expect(page.locator(".sos-location-status")).toContainText(/https sau localhost/i, { timeout: 7000 });
  geolocationCalled = await page.evaluate(() => window.__geoCalled);
  expect(geolocationCalled).toBe(false);
  expect(sosPayload.location.resolvedFrom).toBe("mapSavedLocation");
});

test("sos insecure context without saved location sends without location warning", async ({ page }) => {
  let sosPayload = null;
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    window.localStorage.removeItem("mapSavedLocation");
  });
  await page.route("**/api/me/location", async (route) => {
    await route.fulfill({ json: { location: null } });
  });
  await page.route("**/api/sos/alert", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sosPayload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        success: true,
        alert: { id: "alert-no-location", _id: "alert-no-location", status: "active", contacts: [] },
        incident: { id: "incident-no-location", _id: "incident-no-location", title: "SOS no location" },
        copilotSessionId: "",
        recommendedGuides: [],
        initialActionChecklist: [],
        initialRecommendation: "",
        escalateNow: false,
      },
    });
  });

  await page.goto("/sos");
  await page.getByRole("button", { name: /^SOS/i }).click();
  await page.getByRole("button", { name: /trimite sos/i }).click();
  await expect(page.locator(".sos-location-status")).toContainText(/nicio locație salvată/i, { timeout: 7000 });
  expect(sosPayload.location).toBeNull();
});

test("guide uses local fallback when guides api fails", async ({ page }) => {
  await page.route("**/api/guides", async (route) => {
    await route.fulfill({ status: 503, json: { error: "offline" } });
  });

  await page.goto("/guide");

  await expect(page.locator(".crisis-mode-strip")).toBeVisible();
  await expect(page.locator(".guide-source-strip")).toContainText(/fallback local/i);
  await expect(page.getByRole("button", { name: /earthquake/i })).toBeVisible();
});

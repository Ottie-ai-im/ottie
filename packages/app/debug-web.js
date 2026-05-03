const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on("console", (msg) => {
    console.log(`PAGE LOG: [${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", (err) => {
    console.log(`PAGE ERROR: ${err.message}`);
  });

  console.log("Navigating to http://localhost:8081/welcome...");
  try {
    await page.goto("http://localhost:8081/welcome");
    // Clear localStorage and IndexedDB to simulate fresh start
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.databases().then((dbs) => {
        dbs.forEach((db) => indexedDB.deleteDatabase(db.name));
      });
    });
    await page.reload({ waitUntil: "networkidle" });
    console.log(`Page reloaded at: ${page.url()}`);

    // Wait a bit for any late errors
    await page.waitForTimeout(5000);

    const title = await page.title();
    console.log(`Page title: ${title}`);

    const content = await page.content();
    console.log(`Content length: ${content.length}`);

    // Take a screenshot to verify rendering
    await page.screenshot({ path: "welcome-screen.png" });
    console.log("Screenshot saved to welcome-screen.png");

    // Try to click "Add Host" if it exists
    const addHostButton = page.locator('[data-testid="welcome-direct-connection"]');
    if ((await addHostButton.count()) > 0) {
      console.log("Found Add Host button, clicking...");
      await addHostButton.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "add-host-modal.png" });
      console.log("Screenshot of modal saved to add-host-modal.png");
    } else {
      console.log("Add Host button not found via testid.");
    }
  } catch (error) {
    console.error("Navigation failed:", error);
  }

  await browser.close();
})();

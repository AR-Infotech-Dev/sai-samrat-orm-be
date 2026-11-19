import puppeteer from "puppeteer";

export const renderProformaPdf = async (html) => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.emulateMediaType("print");
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
  } finally {
    await browser.close();
  }
};

// ============================================================
// JobAgent AI — PDF Resume Generator
// Converts markdown resume → styled HTML → PDF via Playwright
// ============================================================
const fs   = require("fs");
const path = require("path");

// Convert markdown to HTML with proper resume styling
function markdownToHTML(markdown, profile) {
  // Simple markdown parser (no external deps needed for basic resume format)
  let html = markdown
    // Headers
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold & italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Bullet lists
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    // Line breaks → paragraphs
    .replace(/\n\n/g, "</p><p>")
    // Horizontal rules
    .replace(/^---+$/gm, "<hr/>");

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, match => `<ul>${match}</ul>`);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: "Calibri", "Segoe UI", Arial, sans-serif;
    font-size: 10.5pt;
    color: #1a1a1a;
    background: white;
    padding: 32px 40px;
    max-width: 820px;
    margin: 0 auto;
    line-height: 1.5;
  }
  h1 {
    font-size: 22pt;
    font-weight: 700;
    color: #111;
    border-bottom: 2px solid #5b21b6;
    padding-bottom: 6px;
    margin-bottom: 4px;
  }
  h2 {
    font-size: 12pt;
    font-weight: 700;
    color: #5b21b6;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 3px;
    margin: 18px 0 10px;
  }
  h3 {
    font-size: 11pt;
    font-weight: 700;
    color: #111;
    margin-bottom: 2px;
    display: flex;
    justify-content: space-between;
  }
  h4 {
    font-size: 10.5pt;
    font-weight: 600;
    color: #4b5563;
    margin-bottom: 4px;
  }
  p { margin-bottom: 8px; color: #374151; }
  ul { padding-left: 18px; margin-bottom: 10px; }
  li { margin-bottom: 3px; color: #374151; font-size: 10pt; }
  strong { color: #111; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  .contact-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 9.5pt;
    color: #6b7280;
    margin-bottom: 4px;
  }
  @media print {
    body { padding: 16px 24px; }
    h2 { page-break-after: avoid; }
    li, p { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="contact-bar">
    ${profile?.email    ? `<span>✉ ${profile.email}</span>`    : ""}
    ${profile?.phone    ? `<span>📱 ${profile.phone}</span>`   : ""}
    ${profile?.location ? `<span>📍 ${profile.location}</span>`: ""}
    ${profile?.linkedinUrl ? `<span>🔗 ${profile.linkedinUrl}</span>` : ""}
  </div>
  <p>${html}</p>
</body>
</html>`;
}

// Generate PDF using Playwright (chromium headless)
async function generatePDF(markdownContent, profile, outputPath) {
  let browser = null;
  try {
    const { chromium } = require("playwright");
    const htmlContent  = markdownToHTML(markdownContent, profile);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle" });

    await page.pdf({
      path: outputPath,
      format: "A4",
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
      printBackground: true
    });

    console.log("[PDF] Generated:", outputPath);
    return outputPath;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generatePDF, markdownToHTML };

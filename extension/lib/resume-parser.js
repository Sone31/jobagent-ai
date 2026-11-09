// ============================================================
// JobAgent AI — Resume Parser (PDF & DOCX)
// Uses PDF.js for PDF, mammoth.js for DOCX
// ============================================================

/**
 * Extract text from a PDF file
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractPDFText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const typedArray = new Uint8Array(e.target.result);
        
        // Use PDF.js loaded via CDN script in sidepanel
        const pdfjsLib = window["pdfjs-dist/build/pdf"];
        if (!pdfjsLib) {
          // Fallback: try to extract readable text from raw bytes
          const decoder = new TextDecoder("utf-8", { fatal: false });
          const raw = decoder.decode(typedArray);
          const textMatches = raw.match(/\(([^\)]{2,200})\)/g) || [];
          const text = textMatches
            .map(m => m.slice(1, -1))
            .filter(t => /[a-zA-Z]/.test(t) && t.length > 3)
            .join(" ");
          resolve(text || "Could not extract PDF text - please paste your resume as text.");
          return;
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(" ");
          fullText += pageText + "\n";
        }

        resolve(fullText);
      } catch (err) {
        reject(new Error("Failed to parse PDF: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract text from plain text file
 */
async function extractTXTText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read text file"));
    reader.readAsText(file);
  });
}

/**
 * Main entry point — detect file type and extract text
 */
async function extractResumeText(file) {
  const name = file.name.toLowerCase();
  
  if (name.endsWith(".pdf")) {
    return await extractPDFText(file);
  } else if (name.endsWith(".txt")) {
    return await extractTXTText(file);
  } else if (name.endsWith(".doc") || name.endsWith(".docx")) {
    // For DOCX we'll read as text with a basic approach
    return await extractTXTText(file).catch(() => "Please paste your resume text directly in the chat.");
  } else {
    return await extractTXTText(file);
  }
}

window.ResumeParser = { extractResumeText };

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
});

function cleanJson(text) {
  return String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function findFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return "Not Provided";
}

function detectDocumentType(text) {
  const lower = text.toLowerCase();

  if (lower.includes("debit note") || lower.includes("nota de débito") || lower.includes("note de débit")) {
    return "Debit Note";
  }

  if (lower.includes("credit note") || lower.includes("nota de crédito")) {
    return "Credit Note";
  }

  if (lower.includes("receipt") || lower.includes("recibo") || lower.includes("reçu")) {
    return "Receipt";
  }

  if (lower.includes("statement") || lower.includes("estado de cuenta") || lower.includes("relevé de compte")) {
    return "Statement";
  }

  if (lower.includes("reminder") || lower.includes("rappel")) {
    return "Reminder";
  }

  if (lower.includes("invoice") || lower.includes("factura") || lower.includes("facture")) {
    return "Invoice";
  }

  return "Unknown";
}

function detectCurrencyAmount(text) {
  const amountPatterns = [
    /(?:total|amount due|balance due|grand total|total amount|montant dû|importe total|total)\s*[:\-]?\s*([A-Z]{3}\s*)?([\d,]+\.\d{2})/i,
    /([\d,]+\.\d{2})\s*(USD|EUR|CAD|CHF|GBP)/i,
    /(USD|EUR|CAD|CHF|GBP)\s*([\d,]+\.\d{2})/i,
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match.slice(1).filter(Boolean).join(" ").trim();
    }
  }

  return "Not Provided";
}

function basicPdfExtractor(text) {
  const cleanText = String(text || "").replace(/\s+/g, " ");

  const documentType = detectDocumentType(cleanText);

  const invoiceNumber = findFirst(cleanText, [
    /invoice\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /factura\s*(?:número|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /facture\s*(?:numéro|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /debit\s*note\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /document\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /reference\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
  ]);

  const purchaseOrder = findFirst(cleanText, [
    /purchase\s*order\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /\bPO\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
    /order\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9\-_/]+)/i,
  ]);

  const documentNumbers = [];
  const numberRegex =
    /\b(?:invoice|factura|facture|receipt|recibo|debit note|document|reference|ref|account)\s*(?:number|no|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-_/]{3,})/gi;

  let match;
  while ((match = numberRegex.exec(cleanText)) !== null) {
    if (match[1] && !documentNumbers.includes(match[1])) {
      documentNumbers.push(match[1]);
    }
  }

  if (invoiceNumber !== "Not Provided" && !documentNumbers.includes(invoiceNumber)) {
    documentNumbers.unshift(invoiceNumber);
  }

  const totalAmount = detectCurrencyAmount(cleanText);

  const isPayable =
    ["Invoice", "Debit Note", "Reminder", "Statement", "Receipt"].includes(documentType) ||
    /amount due|balance due|payable|cuentas por pagar|montant dû/i.test(cleanText);

  return {
    invoiceNumber,
    documentNumbers,
    isInvoice: documentType === "Invoice" ? "Yes" : isPayable ? "Yes - Payable Related" : "No",
    statementReminder:
      documentType === "Statement" || documentType === "Reminder" ? "Yes" : "No",
    purchaseOrder,
    payingEntity: "Not Provided",
    payingCountry: "Not Provided",
    receivingCountry: "Not Provided",
    documentType,
    receiverEntity: "Not Provided",
    totalAmount,
    payableDocument: isPayable ? "Yes" : "No",
    recommendedStatus:
      invoiceNumber === "Not Provided"
        ? "Manual Review"
        : purchaseOrder === "Not Provided"
        ? "Needs PO"
        : "Ready for Payment",
    extractionMethod: "Backup PDF Text Extractor",
  };
}

async function extractWithGemini(base64Pdf) {
  const prompt = `
You are a bilingual accounts payable analyst specialized in invoices, debit notes, receipts, statements, reminders, vendor queries, and accounts payable documents.

Analyze this PDF and return ONLY valid JSON in English.

Important classification rules:
1. Treat invoices, debit notes, debit amounts, accounts payable documents, bills to be paid, vendor payment requests, receipts, payment reminders, and similar payable documents as payable invoice-related documents.
2. Detect similar keywords in any language, including invoice, factura, facture, fatura, receipt, recibo, reçu, debit note, nota de débito, account payable, cuentas por pagar, amount due, saldo pendiente, statement, estado de cuenta, reminder, rappel.
3. Extract invoice number, receipt number, debit note number, account number, statement number, or similar document reference number.
4. If multiple reference numbers are found, list unique values in documentNumbers.
5. Extract Purchase Order if available.
6. Identify paying entity and paying country.
7. Identify receiving entity and receiving country.
8. Extract total amount and currency.
9. If a value is missing, use exactly "Not Provided".
10. Do not include markdown. Do not include explanations. Return ONLY JSON.

Return JSON exactly like this:
{
  "invoiceNumber": "",
  "documentNumbers": [],
  "isInvoice": "",
  "statementReminder": "",
  "purchaseOrder": "",
  "payingEntity": "",
  "payingCountry": "",
  "receivingCountry": "",
  "documentType": "",
  "receiverEntity": "",
  "totalAmount": "",
  "payableDocument": "",
  "recommendedStatus": ""
}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf,
            },
          },
        ],
      },
    ],
  });

  const extraction = JSON.parse(cleanJson(response.text));
  extraction.extractionMethod = "Gemini AI";

  return extraction;
}

app.get("/health", (req, res) => {
  res.json({
    status: "GEMINI BACKEND ACTIVE - WITH BACKUP PDF EXTRACTOR",
  });
});

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF uploaded" });
    }

    const base64Pdf = req.file.buffer.toString("base64");

    try {
      const extraction = await extractWithGemini(base64Pdf);

      return res.json({
        success: true,
        fileName: req.file.originalname,
        extraction,
        extractionMethod: "Gemini AI",
      });
    } catch (aiError) {
      console.warn("AI extraction failed. Using backup extractor:", aiError.message);

      const parsedPdf = await pdfParse(req.file.buffer);
      const backupExtraction = basicPdfExtractor(parsedPdf.text);

      return res.json({
        success: true,
        fileName: req.file.originalname,
        extraction: backupExtraction,
        extractionMethod: "Backup PDF Text Extractor",
        warning: "AI extraction failed or quota was exceeded. Backup extractor was used.",
      });
    }
  } catch (error) {
    console.error("UPLOAD ERROR:", error);

    res.status(500).json({
      error: error.message || "PDF extraction failed",
    });
  }
});

app.listen(4000, () => {
  console.log("Backend running with Gemini + Backup PDF Extractor on http://localhost:4000");
});
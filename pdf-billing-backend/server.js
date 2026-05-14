const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

function cleanJson(text) {
  return String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

app.get("/health", (req, res) => {
  res.json({ status: "GEMINI BACKEND ACTIVE - AP DASHBOARD ENABLED" });
});

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF uploaded" });
    }

    const base64Pdf = req.file.buffer.toString("base64");

    const prompt = `
You are a bilingual accounts payable analyst specialized in invoices, debit notes, receipts, statements, reminders, vendor queries, and accounts payable documents.

Analyze this PDF and return ONLY valid JSON in English.

Important classification rules:
1. Treat invoices, debit notes, debit amounts, accounts payable documents, bills to be paid, vendor payment requests, receipts, payment reminders, and similar payable documents as payable invoice-related documents.
2. Detect similar keywords in any language, including but not limited to:
   - invoice, factura, facture, fatura
   - receipt, recibo, reçu, comprovante
   - debit note, nota de débito, note de débit
   - account payable, cuentas por pagar, comptes fournisseurs
   - amount due, saldo pendiente, montant dû
   - statement, estado de cuenta, relevé de compte
3. Extract invoice number, receipt number, debit note number, account number, statement number, or any similar document reference number.
4. If multiple reference numbers are found, list all of them in documentNumbers.
5. If it is a Statement of Account or Reminder, list all invoice numbers found.
6. Extract Purchase Order if available.
7. Identify paying entity and paying country.
8. Identify receiving entity and receiving country.
9. Extract total amount and currency.
10. If a value is missing, use exactly "Not Provided".
11. Do not include markdown. Do not include explanations. Return ONLY JSON.

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
      model: "gemini-1.5-flash-latest",
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

    const rawText = response.text;
    const extraction = JSON.parse(cleanJson(rawText));

    res.json({
      success: true,
      fileName: req.file.originalname,
      extraction,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    res.status(500).json({
      error: error.message || "Gemini extraction failed",
    });
  }
});

app.listen(4000, () => {
  console.log("Backend running with Gemini AP Dashboard on http://localhost:4000");
});
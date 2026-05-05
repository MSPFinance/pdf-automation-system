const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");

require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "Backend running with AI extraction" });
});

function formatOutput(data) {
  return `
Is it an invoice?: **${data.isInvoice || "Not Provided"}**
Statement of Account / Reminder: **${data.statementReminder || "Not Provided"}**
Purchase Order: **${data.purchaseOrder || "Not Provided"}**
Paying Entity: **${data.payingEntity || "Not Provided"}**
Paying Country: **${data.payingCountry || "Not Provided"}**
Receiving Country: **${data.receivingCountry || "Not Provided"}**
Document Type: **${data.documentType || "Not Provided"}**
Entity (Receiver): **${data.receiverEntity || "Not Provided"}**
Total Amount: **${data.totalAmount || "Not Provided"}**
`;
}

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const base64Pdf = file.buffer.toString("base64");

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are a bilingual accounting analyst expert in invoice, receipt, statement, and vendor document processing. Return only valid JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Analyze this PDF and extract the following information.

Rules:
1. Confirm if the document is an invoice.
2. If it is a statement or reminder, list all invoice numbers.
3. Extract purchase order if available.
4. Identify paying entity and receiving entity.
5. Identify paying country and receiving country.
6. Extract total amount and currency.
7. If missing, use "Not Provided".
8. Response must be in English.

Return JSON exactly with these keys:
{
  "isInvoice": "",
  "statementReminder": "",
  "purchaseOrder": "",
  "payingEntity": "",
  "payingCountry": "",
  "receivingCountry": "",
  "documentType": "",
  "receiverEntity": "",
  "totalAmount": ""
}
`,
            },
            {
              type: "input_file",
              filename: file.originalname,
              file_data: `data:application/pdf;base64,${base64Pdf}`,
            },
          ],
        },
      ],
    });

    const text = response.output_text;
    const extraction = JSON.parse(text);

    res.json({
      message: "PDF processed with AI",
      fileName: file.originalname,
      extraction,
      formattedOutput: formatOutput(extraction),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "AI extraction failed",
    });
  }
});

app.listen(4000, () => {
  console.log("Backend running on http://localhost:4000");
});
import React, { useState } from "react";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const response = await fetch("http://localhost:4000/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      setDocuments([
        {
          fileName: data.fileName,
          extraction: data.extraction,
        },
        ...documents,
      ]);
    } catch (error) {
      alert("Error uploading file");
      console.error(error);
    }

    setLoading(false);
  }

  function buildOutput(e) {
    return `
Is it an invoice?: **${e.isInvoice}**
Statement of Account / Reminder: **${e.statementReminder}**
Purchase Order: **${e.purchaseOrder}**
Paying Entity: **${e.payingEntity}**
Paying Country: **${e.payingCountry}**
Receiving Country: **${e.receivingCountry}**
Document Type: **${e.documentType}**
Entity (Receiver): **${e.receiverEntity}**
Total Amount: **${e.totalAmount}**
`;
  }

  return (
    <div style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>PDF Accounting Extraction System</h1>

      <input type="file" accept="application/pdf" onChange={handleUpload} />

      {loading && <p>Processing PDF...</p>}

      {documents.map((doc, i) => (
        <div
          key={i}
          style={{
            border: "1px solid #ccc",
            padding: 20,
            marginTop: 20,
            borderRadius: 10,
          }}
        >
          <h3>{doc.fileName}</h3>

          <pre style={{ whiteSpace: "pre-wrap" }}>
            {buildOutput(doc.extraction)}
          </pre>
        </div>
      ))}
    </div>
  );
}
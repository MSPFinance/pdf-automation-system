import React, { useMemo, useState } from "react";

const fields = [
  ["invoiceNumber", "Invoice / Main Document Number"],
  ["isInvoice", "Is it an invoice?"],
  ["statementReminder", "Statement / Reminder"],
  ["purchaseOrder", "Purchase Order"],
  ["payingEntity", "Paying Entity"],
  ["payingCountry", "Paying Country"],
  ["receivingCountry", "Receiving Country"],
  ["documentType", "Document Type"],
  ["receiverEntity", "Entity Receiver"],
  ["totalAmount", "Total Amount"],
  ["payableDocument", "Payable Document"],
];

const defaultRules = [
  {
    id: 1,
    receiverEntity: "ABC Lending Services LLC",
    receivingCountry: "United States",
    sendTo: "ap-us@company.com",
    subject: "Invoice Review - {invoiceNumber}",
    body:
      "Hello,\n\nPlease find attached the reviewed document for {receiverEntity}.\n\nInvoice/Document Number: {invoiceNumber}\nAmount: {totalAmount}\nStatus: {status}\n\nRegards,\nMaggie",
  },
];

function getStatus(e = {}) {
  const type = String(e.documentType || "").toLowerCase();
  const po = String(e.purchaseOrder || "").toLowerCase();
  const invoice = String(e.invoiceNumber || "").toLowerCase();
  const payable = String(e.payableDocument || "").toLowerCase();

  if (!invoice || invoice.includes("not provided")) return "Manual Review";
  if (po.includes("not provided") && payable.includes("yes")) return "Needs PO";
  if (type.includes("statement")) return "Reconciliation Required";
  if (type.includes("debit")) return "Finance Review";
  if (type.includes("receipt")) return "Archive as Paid";
  if (type.includes("query")) return "Vendor Query Review";

  return "Ready for Payment";
}

function fillTemplate(template, doc) {
  const e = doc.extraction || {};

  return String(template || "")
    .replaceAll("{invoiceNumber}", e.invoiceNumber || "Not Provided")
    .replaceAll("{documentType}", e.documentType || "Not Provided")
    .replaceAll("{receiverEntity}", e.receiverEntity || "Not Provided")
    .replaceAll("{receivingCountry}", e.receivingCountry || "Not Provided")
    .replaceAll("{totalAmount}", e.totalAmount || "Not Provided")
    .replaceAll("{status}", doc.status || "Not Provided")
    .replaceAll("{fileName}", doc.fileName || "Not Provided");
}

function copyText(text) {
  navigator.clipboard.writeText(text || "");
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [rules, setRules] = useState(defaultRules);

  const [ruleForm, setRuleForm] = useState({
    receiverEntity: "",
    receivingCountry: "",
    sendTo: "",
    subject: "Invoice Review - {invoiceNumber}",
    body:
      "Hello,\n\nPlease find attached the reviewed document for {receiverEntity}.\n\nInvoice/Document Number: {invoiceNumber}\nAmount: {totalAmount}\nStatus: {status}\n\nRegards,\nMaggie",
  });

  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");

  const stats = useMemo(
    () => ({
      total: documents.length,
      ready: documents.filter((d) => d.status === "Ready for Payment").length,
      review: documents.filter((d) => d.status.includes("Review")).length,
      processed: documents.filter((d) => d.processed).length,
      duplicates: documents.filter((d) => d.status === "Possible Duplicate").length,
    }),
    [documents]
  );

  async function uploadPdf(file) {
    setError("");

    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please upload a PDF file only.");
      return;
    }

    const alreadyUploaded = documents.find(
      (doc) => doc.fileName.toLowerCase() === file.name.toLowerCase()
    );

    if (alreadyUploaded) {
      const confirmContinue = window.confirm(
        `This file appears to have already been uploaded/read:\n\n${file.name}\n\nDo you still want to process it again?`
      );

      if (!confirmContinue) return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const response = await fetch("http://localhost:4000/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      const extraction = data.extraction || {};

      const duplicateByData = documents.find((doc) => {
        const current = doc.extraction || {};

        const sameInvoice =
          extraction.invoiceNumber &&
          extraction.invoiceNumber !== "Not Provided" &&
          current.invoiceNumber === extraction.invoiceNumber;

        const sameReceiverAmount =
          current.receiverEntity === extraction.receiverEntity &&
          current.totalAmount === extraction.totalAmount &&
          current.totalAmount !== "Not Provided";

        return sameInvoice || sameReceiverAmount;
      });

      if (duplicateByData) {
        window.alert(
          `Possible duplicate or previous inquiry found.\n\nNew file: ${file.name}\nMatched file: ${duplicateByData.fileName}\n\nInvoice/Document Number: ${
            extraction.invoiceNumber || "Not Provided"
          }\nReceiver: ${extraction.receiverEntity || "Not Provided"}\nAmount: ${
            extraction.totalAmount || "Not Provided"
          }`
        );
      }

      setDocuments((prev) => [
        {
          id: Date.now(),
          fileName: data.fileName || file.name,
          createdAt: new Date().toISOString().slice(0, 10),
          extraction,
          status: duplicateByData
            ? "Possible Duplicate"
            : extraction.recommendedStatus || getStatus(extraction),
          notes: duplicateByData
            ? `Possible duplicate of ${duplicateByData.fileName}`
            : "",
          processed: false,
          emailed: false,
          emailDraft: null,
          duplicateMatch: duplicateByData?.fileName || "",
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err.message || "Error uploading PDF.");
    } finally {
      setLoading(false);
    }
  }

  function findRule(doc) {
    const entity = String(doc.extraction.receiverEntity || "")
      .toLowerCase()
      .trim();

    const country = String(doc.extraction.receivingCountry || "")
      .toLowerCase()
      .trim();

    return rules.find(
      (r) =>
        String(r.receiverEntity || "").toLowerCase().trim() === entity &&
        String(r.receivingCountry || "").toLowerCase().trim() === country
    );
  }

  function generateEmailDraft(doc) {
    const rule = findRule(doc);

    if (!rule) {
      updateDoc(doc.id, {
        emailDraft: {
          matched: false,
          to: "",
          subject: "",
          body:
            "No email rule matched this document. Please add a rule for this receiver entity and country.",
        },
      });
      return;
    }

    updateDoc(doc.id, {
      emailDraft: {
        matched: true,
        to: rule.sendTo,
        subject: fillTemplate(rule.subject, doc),
        body: fillTemplate(rule.body, doc),
      },
    });
  }

  function updateField(id, key, value) {
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id !== id) return doc;

        const updatedExtraction = {
          ...doc.extraction,
          [key]: value,
        };

        return {
          ...doc,
          extraction: updatedExtraction,
          status: getStatus(updatedExtraction),
        };
      })
    );
  }

  function updateDoc(id, updates) {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, ...updates } : doc))
    );
  }

  function addRule() {
    if (!ruleForm.receiverEntity || !ruleForm.receivingCountry || !ruleForm.sendTo) {
      setError(
        "Please complete Receiver Entity, Receiving Country, and Send To before adding a rule."
      );
      return;
    }

    setRules((prev) => [{ id: Date.now(), ...ruleForm }, ...prev]);

    setRuleForm({
      receiverEntity: "",
      receivingCountry: "",
      sendTo: "",
      subject: "Invoice Review - {invoiceNumber}",
      body:
        "Hello,\n\nPlease find attached the reviewed document for {receiverEntity}.\n\nInvoice/Document Number: {invoiceNumber}\nAmount: {totalAmount}\nStatus: {status}\n\nRegards,\nMaggie",
    });
  }

  function deleteRule(id) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  function handleFileSelect(event) {
    uploadPdf(event.target.files[0]);
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    uploadPdf(event.dataTransfer.files[0]);
  }

  function preventDefault(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      onDragOver={preventDefault}
      onDrop={preventDefault}
      style={{
        padding: 30,
        fontFamily: "Arial, sans-serif",
        maxWidth: 1300,
        margin: "0 auto",
      }}
    >
      <h1 style={{ textAlign: "center", fontSize: 38 }}>
        Accounts Payable PDF Dashboard
      </h1>

      <div style={dashboard}>
        <Stat title="Total Files" value={stats.total} />
        <Stat title="Ready for Payment" value={stats.ready} />
        <Stat title="Needs Review" value={stats.review} />
        <Stat title="Processed" value={stats.processed} />
        <Stat title="Possible Duplicates" value={stats.duplicates} />
      </div>

      <label
        onDragOver={(e) => {
          preventDefault(e);
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          preventDefault(e);
          setDragActive(false);
        }}
        onDrop={handleDrop}
        style={{
          display: "block",
          padding: 35,
          border: dragActive ? "3px dashed #2563eb" : "3px dashed #ccc",
          borderRadius: 15,
          textAlign: "center",
          background: dragActive ? "#eff6ff" : "#fafafa",
          cursor: "pointer",
          marginBottom: 20,
        }}
      >
        <h2>Drag & Drop PDF Here</h2>
        <p>or click to select a PDF file</p>

        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
      </label>

      {loading && <p style={{ textAlign: "center" }}>Processing PDF...</p>}

      {error && (
        <div style={errorBox}>
          {error}
          <br />
          <button onClick={() => setError("")} style={buttonLight}>
            Clear Error
          </button>
        </div>
      )}

      {documents.map((doc) => {
        const numbers = Array.isArray(doc.extraction.documentNumbers)
          ? doc.extraction.documentNumbers
          : [];

        const matchedRule = findRule(doc);

        return (
          <div key={doc.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
              <div>
                <h2>{doc.fileName}</h2>
                <p style={{ color: "#64748b" }}>Upload Date: {doc.createdAt}</p>
                <span style={statusBadge(doc.status)}>{doc.status}</span>

                {doc.processed && (
                  <span style={processedBadge}>Processed / Worked On</span>
                )}

                {doc.emailed && (
                  <span style={emailBadge}>Email Prepared/Sent</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
                <button onClick={() => updateDoc(doc.id, { status: "Approved" })} style={buttonGreen}>
                  Approve
                </button>

                <button onClick={() => updateDoc(doc.id, { status: "Needs Review" })} style={buttonYellow}>
                  Needs Review
                </button>

                <button onClick={() => updateDoc(doc.id, { status: "Rejected" })} style={buttonRed}>
                  Reject
                </button>

                <button
                  onClick={() =>
                    updateDoc(doc.id, {
                      processed: true,
                      status: "Processed",
                    })
                  }
                  style={buttonBlue}
                >
                  Mark Processed
                </button>

                <button onClick={() => generateEmailDraft(doc)} style={buttonPurple}>
                  Generate Email
                </button>
              </div>
            </div>

            {doc.duplicateMatch && (
              <div style={duplicateBox}>
                Possible duplicate match: <b>{doc.duplicateMatch}</b>
              </div>
            )}

            <div style={copyPanel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <b>Copy-ready Document Numbers:</b>

                <button
                  onClick={() => {
                    const allNumbers = [
                      doc.extraction.invoiceNumber,
                      ...numbers,
                    ]
                      .filter(Boolean)
                      .filter((value) => value !== "Not Provided")
                      .join("\n");

                    copyText(allNumbers);
                  }}
                  style={buttonLight}
                >
                  Copy All for Excel
                </button>
              </div>

              <table style={miniTable}>
                <thead>
                  <tr>
                    <th style={miniTh}>Document Numbers</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td style={miniTd}>
                      {doc.extraction.invoiceNumber || "Not Provided"}
                    </td>
                  </tr>

                  {numbers.map((num, idx) => (
                    <tr key={idx}>
                      <td style={miniTd}>{num}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={grid}>
              {fields.map(([key, title]) => (
                <label key={key} style={label}>
                  {title}

                  <input
                    value={doc.extraction[key] || ""}
                    onChange={(e) => updateField(doc.id, key, e.target.value)}
                    style={input}
                  />
                </label>
              ))}
            </div>

            <label style={{ ...label, display: "block", marginTop: 15 }}>
              Status

              <select
                value={doc.status}
                onChange={(e) => updateDoc(doc.id, { status: e.target.value })}
                style={input}
              >
                <option>Ready for Payment</option>
                <option>Needs PO</option>
                <option>Manual Review</option>
                <option>Finance Review</option>
                <option>Reconciliation Required</option>
                <option>Vendor Query Review</option>
                <option>Archive as Paid</option>
                <option>Possible Duplicate</option>
                <option>Approved</option>
                <option>Rejected</option>
                <option>Processed</option>
              </select>
            </label>

            <label style={{ ...label, display: "block", marginTop: 15 }}>
              Finance Notes / Processing Notes

              <textarea
                value={doc.notes}
                onChange={(e) => updateDoc(doc.id, { notes: e.target.value })}
                placeholder="Add review notes, payment comments, duplicate notes, or processing comments."
                style={textarea}
              />
            </label>

            <div style={emailPanel}>
              <h3>Email Rule Match & Template Preview</h3>

              {matchedRule ? (
                <p>
                  Matched rule: <b>{matchedRule.receiverEntity}</b> /{" "}
                  <b>{matchedRule.receivingCountry}</b>
                </p>
              ) : (
                <p style={{ color: "#991b1b" }}>
                  No rule matched this document yet.
                </p>
              )}

              {doc.emailDraft && (
                <div>
                  <h3>Generated Email Preview</h3>

                  <p>
                    <b>To:</b> {doc.emailDraft.to || "Not Provided"}
                  </p>

                  <p>
                    <b>Subject:</b> {doc.emailDraft.subject || "Not Provided"}
                  </p>

                  <pre style={emailBody}>{doc.emailDraft.body}</pre>

                  <button onClick={() => copyText(doc.emailDraft.to)} style={buttonLight}>
                    Copy To
                  </button>

                  <button
                    onClick={() => copyText(doc.emailDraft.subject)}
                    style={{ ...buttonLight, marginLeft: 8 }}
                  >
                    Copy Subject
                  </button>

                  <button
                    onClick={() => copyText(doc.emailDraft.body)}
                    style={{ ...buttonLight, marginLeft: 8 }}
                  >
                    Copy Body
                  </button>

                  <button
                    onClick={() => updateDoc(doc.id, { emailed: true })}
                    style={{ ...buttonGreen, marginLeft: 8 }}
                  >
                    Mark Email Done
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div style={section}>
        <h2>Email Rules Dashboard</h2>

        <p style={{ color: "#64748b" }}>
          Rules match by Entity Receiver + Receiving Country and generate
          prepared email templates.
        </p>

        <div style={grid}>
          <label style={label}>
            Entity Receiver

            <input
              value={ruleForm.receiverEntity}
              onChange={(e) =>
                setRuleForm({
                  ...ruleForm,
                  receiverEntity: e.target.value,
                })
              }
              style={input}
            />
          </label>

          <label style={label}>
            Receiving Country

            <input
              value={ruleForm.receivingCountry}
              onChange={(e) =>
                setRuleForm({
                  ...ruleForm,
                  receivingCountry: e.target.value,
                })
              }
              style={input}
            />
          </label>

          <label style={label}>
            Send To

            <input
              value={ruleForm.sendTo}
              onChange={(e) =>
                setRuleForm({
                  ...ruleForm,
                  sendTo: e.target.value,
                })
              }
              style={input}
            />
          </label>

          <label style={label}>
            Subject Template

            <input
              value={ruleForm.subject}
              onChange={(e) =>
                setRuleForm({
                  ...ruleForm,
                  subject: e.target.value,
                })
              }
              style={input}
            />
          </label>
        </div>

        <label style={{ ...label, display: "block", marginTop: 12 }}>
          Body Template

          <textarea
            value={ruleForm.body}
            onChange={(e) =>
              setRuleForm({
                ...ruleForm,
                body: e.target.value,
              })
            }
            style={textarea}
          />
        </label>

        <button onClick={addRule} style={buttonBlue}>
          Add Email Rule
        </button>

        {rules.map((rule) => (
          <div key={rule.id} style={ruleCard}>
            <b>{rule.receiverEntity}</b> — {rule.receivingCountry}

            <br />

            Send To: <b>{rule.sendTo}</b>

            <br />

            Subject: {rule.subject}

            <br />

            <button
              onClick={() => deleteRule(rule.id)}
              style={{ ...buttonRed, marginTop: 8 }}
            >
              Delete Rule
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ title, value }) {
  return (
    <div style={statCard}>
      <div style={{ color: "#64748b", fontSize: 13 }}>{title}</div>

      <div style={{ fontSize: 28, fontWeight: "bold" }}>{value}</div>
    </div>
  );
}

const dashboard = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: 12,
  marginBottom: 20,
};

const statCard = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 16,
  background: "white",
};

const section = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 22,
  background: "white",
  marginTop: 25,
  marginBottom: 20,
};

const card = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 22,
  marginTop: 20,
  background: "white",
};

const ruleCard = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 14,
  marginTop: 12,
};

const copyPanel = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 14,
  marginTop: 15,
};

const duplicateBox = {
  background: "#ffedd5",
  border: "1px solid #fdba74",
  color: "#9a3412",
  borderRadius: 12,
  padding: 14,
  marginTop: 15,
  fontWeight: "bold",
};

const emailPanel = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 14,
  marginTop: 18,
};

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 14,
  marginTop: 20,
};

const label = {
  fontWeight: "bold",
};

const input = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ccc",
  boxSizing: "border-box",
};

const textarea = {
  display: "block",
  width: "100%",
  minHeight: 80,
  marginTop: 6,
  padding: 10,
  borderRadius: 8,
  border: "1px solid #ccc",
  boxSizing: "border-box",
};

const miniTable = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 12,
  fontSize: 14,
};

const miniTh = {
  textAlign: "left",
  borderBottom: "1px solid #cbd5e1",
  padding: 8,
  background: "#f1f5f9",
};

const miniTd = {
  borderBottom: "1px solid #e2e8f0",
  padding: 8,
};

const emailBody = {
  whiteSpace: "pre-wrap",
  background: "white",
  padding: 12,
  borderRadius: 8,
  border: "1px solid #ddd",
};

const errorBox = {
  background: "#fee2e2",
  color: "#991b1b",
  padding: 15,
  borderRadius: 10,
  marginBottom: 20,
  textAlign: "center",
};

const buttonLight = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  background: "white",
  color: "#111827",
  cursor: "pointer",
};

const buttonGreen = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#16a34a",
  color: "white",
  cursor: "pointer",
};

const buttonYellow = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#f59e0b",
  color: "white",
  cursor: "pointer",
};

const buttonRed = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#dc2626",
  color: "white",
  cursor: "pointer",
};

const buttonBlue = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
};

const buttonPurple = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#7c3aed",
  color: "white",
  cursor: "pointer",
};

const processedBadge = {
  display: "inline-block",
  marginLeft: 8,
  padding: "6px 12px",
  borderRadius: 999,
  background: "#e0f2fe",
  color: "#075985",
  fontWeight: "bold",
};

const emailBadge = {
  display: "inline-block",
  marginLeft: 8,
  padding: "6px 12px",
  borderRadius: 999,
  background: "#ede9fe",
  color: "#5b21b6",
  fontWeight: "bold",
};

function statusBadge(status) {
  const colors = {
    Approved: ["#dcfce7", "#166534"],
    Processed: ["#e0f2fe", "#075985"],
    "Ready for Payment": ["#dcfce7", "#166534"],
    "Needs PO": ["#fef3c7", "#92400e"],
    "Manual Review": ["#fee2e2", "#991b1b"],
    "Finance Review": ["#dbeafe", "#1e40af"],
    "Vendor Query Review": ["#fef3c7", "#92400e"],
    "Archive as Paid": ["#ede9fe", "#5b21b6"],
    "Reconciliation Required": ["#ede9fe", "#5b21b6"],
    "Possible Duplicate": ["#ffedd5", "#9a3412"],
    Rejected: ["#fee2e2", "#991b1b"],
  };

  const [bg, color] = colors[status] || ["#f1f5f9", "#334155"];

  return {
    display: "inline-block",
    marginTop: 5,
    padding: "6px 12px",
    borderRadius: 999,
    background: bg,
    color,
    fontWeight: "bold",
  };
}
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Transaction from "./models/Transaction.js";
import https from "https";

dotenv.config();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const TOKEN_TTL_SECONDS = parseInt(process.env.TOKEN_TTL_SECONDS || "300", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"; // comma-separated list allowed

const app = express();
// Restrict CORS to known origins
app.use(cors({
  origin: CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
}));
app.use(express.json());

// connect mongo
if (!process.env.MONGO_URI) {
  console.warn("⚠️ MONGO_URI is not set. Server will start but DB operations will fail.");
}
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.warn("⚠️ MongoDB connect failed:", err.message));

// Helpers
function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function isPositiveNumber(v) { return typeof v === "number" && Number.isFinite(v) && v > 0; }
function dbReady() { return mongoose.connection.readyState === 1; }

function handleRouteError(err, res) {
  // Distinguish JWT errors vs others
  if (err?.name === "TokenExpiredError") {
    return res.status(401).json({ error: "Token expired" });
  }
  if (err?.name === "JsonWebTokenError") {
    return res.status(401).json({ error: "Invalid token" });
  }
  console.error(err);
  return res.status(500).json({ error: "Server error" });
}

// Health
app.get("/", (req, res) => res.send("✅ Polling Task Backend Up"));

// API index (self-documenting list of endpoints)
app.get("/api", (req, res) => {
  res.json({
    name: "Polling Task Backend API",
    baseUrl: `/api`,
    notes: "Use POST for token and transaction creation. Status and lists are GET.",
    endpoints: [
      { method: "POST", path: "/api/token", desc: "Issue a short-lived JWT for a given userId" },
      { method: "POST", path: "/api/transactions", desc: "Create a transaction (requires token in body)" },
      { method: "GET", path: "/api/transactions/:id/status", desc: "Get transaction status (Bearer txToken or POS token)" },
      { method: "GET", path: "/api/transactions/pending", desc: "List WAITING transactions (POS token required)" },
      { method: "GET", path: "/api/transactions/ready", desc: "List READY_FOR_AUTH transactions (POS token required)" },
      { method: "POST", path: "/api/transactions/:id/pos-confirm", desc: "Confirm a WAITING tx → READY_FOR_AUTH (POS token)" },
      { method: "POST", path: "/api/transactions/:id/authorize", desc: "Authorize and settle a READY_FOR_AUTH tx (POS token)" },
      { method: "POST", path: "/api/transactions/:id/clear", desc: "Delete a transaction (demo helper)" },
      { method: "GET", path: "/api/preview-image", desc: "Preview image proxy (for demo PiP)" },
      { method: "GET", path: "/api/whoami", desc: "Decode Authorization token and return its claims" },
    ],
  });
});

// Whoami: decode Authorization header to inspect user/role
app.get("/api/whoami", (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Authorization required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ ok: true, claims: decoded });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// Serve a same-origin preview image (proxied) to avoid cross-origin canvas taint
app.get("/api/preview-image", (req, res) => {
  const remoteUrl = "https://placehold.co/320x180/png?text=Payment+Preview";
  https.get(remoteUrl, (r) => {
    if (r.statusCode && r.statusCode >= 400) {
      res.status(r.statusCode).end();
      return;
    }
    res.setHeader("Content-Type", "image/png");
    r.pipe(res);
  }).on("error", (e) => {
    console.error("Preview image proxy error:", e.message);
    res.status(500).end();
  });
});

// 1) Issue server-to-server token (simulate Auth server issuing token to mobile or POS)
app.post("/api/token", async (req, res) => {
  let { userId, role } = req.body; // role: 'client' | 'pos'
  if (!userId) return res.status(400).json({ error: "userId required" });
  // Backward compatibility: if role omitted, infer from userId
  if (!role) {
    role = /pos/i.test(String(userId)) ? "pos" : "client";
  }
  if (!["client","pos"].includes(role)) return res.status(400).json({ error: "invalid role" });

  const payload = { userId, role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${TOKEN_TTL_SECONDS}s` });
  res.json({ token, ttlSeconds: TOKEN_TTL_SECONDS });
});

// 2) Mobile creates a transaction (enter wait state). Server validates token, fetches SoJOR/image (simulated), issues tx
app.post("/api/transactions", async (req, res) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const { token, source, destination, amount, buyerFloatPercent = 0 } = req.body;
    if (!token) return res.status(401).json({ error: "token required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== "client") return res.status(403).json({ error: "forbidden: client role required" });

    // Basic payload validation
    if (!isNonEmptyString(source)) return res.status(400).json({ error: "source required" });
    if (!isNonEmptyString(destination)) return res.status(400).json({ error: "destination required" });
    const amt = typeof amount === "string" ? Number(amount) : amount;
    const bfp = typeof buyerFloatPercent === "string" ? Number(buyerFloatPercent) : buyerFloatPercent;
    if (!isPositiveNumber(amt)) return res.status(400).json({ error: "amount must be a positive number" });
    if (!Number.isFinite(bfp) || bfp < 0) return res.status(400).json({ error: "buyerFloatPercent must be >= 0" });

    // simulate fetching SoJOR% and image from Authorization Server via GraphQL
    // In production: call GraphQL with server token and fetch real values.
    const sojorPercent = 1.5; // example from AS
    // Embed a self-contained SVG as a data URL to guarantee preview works and avoid any CORS/network issues
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'>
      <rect width='100%' height='100%' fill='#1e293b'/>
      <text x='50%' y='40%' dominant-baseline='middle' text-anchor='middle' fill='#e2e8f0' font-size='18'>Payment Preview</text>
      <text x='50%' y='60%' dominant-baseline='middle' text-anchor='middle' fill='#94a3b8' font-size='12'>${source} → ${destination}</text>
    </svg>`;
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const floatCharge = +(amt * (bfp / 100));
    const sojorCharge = +(amt * (sojorPercent / 100));
    const grandTotal = +(amt + floatCharge + sojorCharge).toFixed(2);

    const ttlExpiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

    const tx = new Transaction({
      source, destination, amount: amt,
      buyerFloatPercent: bfp, sojorPercent,
      floatCharge, sojorCharge, grandTotal,
      imageUrl, status: "WAITING",
      ttlExpiresAt, userId: decoded.userId
    });

    await tx.save();

    // create a short-lived tx token which mobile/POS can use to poll (optionally)
    const txToken = jwt.sign({ txId: tx._id.toString() }, JWT_SECRET, { expiresIn: `${TOKEN_TTL_SECONDS}s` });

    return res.json({
      success: true,
      txId: tx._id,
      txToken,
      grandTotal,
      imageUrl,
      sojorPercent,
      buyerFloatPercent,
      status: tx.status,
      ttlSeconds: TOKEN_TTL_SECONDS
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// 3) Poll status for a tx (mobile or POS polls)
app.get("/api/transactions/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    // optional server-to-server auth header (Bearer token), or txToken
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "") || req.query.txToken;

    if (!token) return res.status(401).json({ error: "Authorization token required" });
    jwt.verify(token, JWT_SECRET); // will throw if invalid

    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const tx = await Transaction.findById(id).lean();
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    // Recompute grandTotal in case floats change
    tx.floatCharge = +(tx.amount * (tx.buyerFloatPercent / 100) || 0);
    tx.sojorCharge = +(tx.amount * (tx.sojorPercent / 100) || 0);
    tx.grandTotal = +(tx.amount + tx.floatCharge + tx.sojorCharge).toFixed(2);

    res.json({ tx });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// 4) POS: get pending transactions (inverse polling)
app.get("/api/transactions/pending", async (req, res) => {
  try {
    // server-to-server token required
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Authorization required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== "pos") return res.status(403).json({ error: "forbidden: pos role required" });

    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const pending = await Transaction.find({ status: "WAITING" }).sort({ createdAt: -1 }).lean();
    res.json({ transactions: pending });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// 4b) POS: get READY_FOR_AUTH transactions
app.get("/api/transactions/ready", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Authorization required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== "pos") return res.status(403).json({ error: "forbidden: pos role required" });

    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const ready = await Transaction.find({ status: "READY_FOR_AUTH" }).sort({ createdAt: -1 }).lean();
    res.json({ transactions: ready });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// 5) POS confirms tx (moves it to READY_FOR_AUTH)
app.post("/api/transactions/:id/pos-confirm", async (req, res) => {
  try {
    const { id } = req.params;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Authorization required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== "pos") return res.status(403).json({ error: "forbidden: pos role required" });

    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const tx = await Transaction.findById(id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    if (tx.status !== "WAITING") {
      return res.status(400).json({ error: `Invalid status transition: ${tx.status} -> READY_FOR_AUTH` });
    }

    tx.status = "READY_FOR_AUTH";
    await tx.save();

    res.json({ ok: true, status: tx.status });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// 6) For demo: authorize transaction (simulate card auth, settlement)
app.post("/api/transactions/:id/authorize", async (req, res) => {
  try {
    const { id } = req.params;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Authorization required" });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== "pos") return res.status(403).json({ error: "forbidden: pos role required" });

    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const tx = await Transaction.findById(id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    if (tx.status !== "READY_FOR_AUTH") {
      return res.status(400).json({ error: `Invalid status transition: ${tx.status} -> AUTHORIZED/SETTLED` });
    }

    tx.status = "AUTHORIZED";
    await tx.save();

    // Simulate settlement / split (Finix integration would go here)
    tx.status = "SETTLED";
    await tx.save();

    res.json({ ok: true, status: tx.status });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// 7) Clear a tx (CLS)
app.post("/api/transactions/:id/clear", async (req, res) => {
  try {
    const { id } = req.params;
    // optional auth
    if (!dbReady()) return res.status(503).json({ error: "Database unavailable" });
    const tx = await Transaction.findByIdAndDelete(id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    res.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// Basic error handler (fallback)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => console.log(`🚀 Backend listening on http://localhost:${PORT}`));

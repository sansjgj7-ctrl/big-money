from pathlib import Path

server = r'''const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID = "https://api.trongrid.io";

// Temporary storage.
// Later we can replace this with a real database.
const deposits = [];
const withdrawals = [];

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    network: "TRON",
    token: "USDT",
    standard: "TRC20",
    depositAddress: DEPOSIT_ADDRESS
  });
});

// Scan incoming USDT transactions to the public deposit address.
app.get("/api/deposits/scan", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 200);

    const url =
      `${TRONGRID}/v1/accounts/${DEPOSIT_ADDRESS}/transactions/trc20` +
      `?limit=${limit}&contract_address=${USDT_CONTRACT}`;

    const headers = {};

    if (process.env.TRONGRID_API_KEY) {
      headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "TRON API request failed"
      });
    }

    const data = await response.json();

    const incoming = (data.data || [])
      .filter(
        (tx) =>
          String(tx.to || "").toLowerCase() ===
          DEPOSIT_ADDRESS.toLowerCase()
      )
      .map((tx) => ({
        transactionId: tx.transaction_id,
        from: tx.from,
        to: tx.to,
        token: tx.token_info?.symbol || "USDT",
        amount: Number(tx.value || 0) / 1e6,
        blockTimestamp: tx.block_timestamp,
        type: tx.type
      }));

    res.json({
      ok: true,
      depositAddress: DEPOSIT_ADDRESS,
      deposits: incoming
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Scan failed"
    });
  }
});

// User submits a deposit request.
// This does NOT yet mean the deposit is verified.
app.post("/api/deposits/request", (req, res) => {
  const { telegramUserId, amount, txid } = req.body || {};

  if (!telegramUserId || !amount) {
    return res.status(400).json({
      ok: false,
      error: "telegramUserId and amount are required"
    });
  }

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "Invalid amount"
    });
  }

  const deposit = {
    id: `dep_${Date.now()}`,
    telegramUserId: String(telegramUserId),
    amount: numericAmount,
    txid: txid || null,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  deposits.push(deposit);

  res.json({
    ok: true,
    deposit
  });
});

app.get("/api/deposits", (req, res) => {
  res.json({
    ok: true,
    deposits
  });
});

// Creates a withdrawal request only.
// It does NOT send USDT yet.
app.post("/api/withdrawals/request", (req, res) => {
  const { telegramUserId, address, amount } = req.body || {};

  if (!telegramUserId || !address || !amount) {
    return res.status(400).json({
      ok: false,
      error: "telegramUserId, address and amount are required"
    });
  }

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "Invalid amount"
    });
  }

  const tronAddress = String(address).trim();

  if (!tronAddress.startsWith("T") || tronAddress.length < 30) {
    return res.status(400).json({
      ok: false,
      error: "Invalid TRON address"
    });
  }

  const withdrawal = {
    id: `wd_${Date.now()}`,
    telegramUserId: String(telegramUserId),
    address: tronAddress,
    amount: numericAmount,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  withdrawals.push(withdrawal);

  res.json({
    ok: true,
    withdrawal
  });
});

app.get("/api/withdrawals", (req, res) => {
  res.json({
    ok: true,
    withdrawals
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Big Money Backend running on port ${PORT}`);
});
'''

path = Path("/mnt/data/Big_Money_server_v2.js")
path.write_text(server, encoding="utf-8")
print

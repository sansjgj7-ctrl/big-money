const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const DEPOSIT_ADDRESS = "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

app.get("/", function (req, res) {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20"
  });
});

app.get("/api/config", function (req, res) {
  res.json({
    network: "TRON",
    token: "USDT",
    standard: "TRC20",
    depositAddress: DEPOSIT_ADDRESS
  });
});

app.post("/api/deposits/request", function (req, res) {
  const body = req.body || {};
  const telegramUserId = body.telegramUserId;
  const amount = Number(body.amount);
  const txid = body.txid || null;

  if (!telegramUserId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "telegramUserId and a valid amount are required"
    });
  }

  res.json({
    ok: true,
    deposit: {
      id: "dep_" + Date.now(),
      telegramUserId: String(telegramUserId),
      amount: amount,
      txid: txid,
      status: "pending"
    }
  });
});

app.post("/api/withdrawals/request", function (req, res) {
  const body = req.body || {};
  const telegramUserId = body.telegramUserId;
  const address = String(body.address || "").trim();
  const amount = Number(body.amount);

  if (
    !telegramUserId ||
    !address ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return res.status(400).json({
      ok: false,
      error: "telegramUserId, address and a valid amount are required"
    });
  }

  if (!address.startsWith("T")) {
    return res.status(400).json({
      ok: false,
      error: "Invalid TRON address"
    });
  }

  res.json({
    ok: true,
    withdrawal: {
      id: "wd_" + Date.now(),
      telegramUserId: String(telegramUserId),
      address: address,
      amount: amount,
      status: "pending"
    }
  });
});

app.listen(PORT, "0.0.0.0", function () {
  console.log("Big Money Backend running on port " + PORT);
});

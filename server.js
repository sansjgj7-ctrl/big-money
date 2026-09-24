const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const DEPOSIT_ADDRESS = "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TRONGRID_URL = "https://api.trongrid.io";async function getUsdtTransfers() {
  const url =
    TRONGRID_URL +
    "/v1/accounts/" +
    DEPOSIT_ADDRESS +
    "/transactions/trc20" +
    "?limit=20&contract_address=" +
    USDT_CONTRACT;

  const response = await fetch(url, {
    headers: {
      "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error("TronGrid request failed");
  }

  return await response.json();
}
app.get("/api/deposits/check", async function (req, res) {
  try {
    const data = await getUsdtTransfers();

    res.json({
      ok: true,
      depositAddress: DEPOSIT_ADDRESS,
      transfers: data.data || []
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Could not check TRON transfers"
    });
  }
});
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

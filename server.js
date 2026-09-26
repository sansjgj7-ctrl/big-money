const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 10000);

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL = (
  process.env.TRONGRID_URL || "https://api.trongrid.io"
).replace(/\/$/, "");

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const USDT_DECIMALS = 6;
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 1);
const MIN_WITHDRAWAL = Number(process.env.MIN_WITHDRAWAL || 1);

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "big-money-data.json");

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data"
  ]
}));

app.use(express.json({ limit: "1mb" }));

/* =========================================================
   DATABASE
========================================================= */

function defaultStore() {
  return {
    users: {},
    deposits: [],
    withdrawals: [],
    referrals: []
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(defaultStore(), null, 2)
    );
  }
}

function loadStore() {
  ensureStore();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);

    return {
      users: data.users || {},
      deposits: data.deposits || [],
      withdrawals: data.withdrawals || [],
      referrals: data.referrals || []
    };
  } catch (error) {
    console.error("Database read error:", error);
    return defaultStore();
  }
}

function saveStore(store) {
  ensureStore();

  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(store, null, 2)
  );

  fs.renameSync(tempFile, DATA_FILE);
}

let store = loadStore();

function roundUSDT(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function getUser(telegramUserId) {
  const id = String(telegramUserId);

  if (!store.users[id]) {
    store.users[id] = {
      telegramUserId: id,
      balance: 0,
      points: 0,
      referralCode: "ref_" + id,
      referredBy: null,
      referralCount: 0,
      createdAt: new Date().toISOString()
    };
  }

  return store.users[id];
}

/* =========================================================
   TRONGRID
========================================================= */

function tronHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };

  if (TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
  }

  return headers;
}

async function tronGet(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: tronHeaders()
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data?.Error ||
      data?.error ||
      `TronGrid HTTP ${response.status}`
    );
  }

  return data;
}

async function tronPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: tronHeaders(),
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data?.Error ||
      data?.error ||
      `TronGrid HTTP ${response.status}`
    );
  }

  return data;
}

/* =========================================================
   BASIC ROUTES
========================================================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20",
    version: "deposit-balance-v1"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    network: "TRON",
    token: "USDT",
    standard: "TRC20",
    depositAddress: DEPOSIT_ADDRESS,
    usdtContract: USDT_CONTRACT,
    minDeposit: MIN_DEPOSIT,
    minWithdrawal: MIN_WITHDRAWAL
  });
});

/* =========================================================
   USER BALANCE
========================================================= */

app.get("/api/user/:telegramUserId", (req, res) => {
  const telegramUserId = String(
    req.params.telegramUserId || ""
  ).trim();

  if (!telegramUserId) {
    return res.status(400).json({
      ok: false,
      error: "telegramUserId is required"
    });
  }

  const user = getUser(telegramUserId);

  saveStore(store);

  res.json({
    ok: true,
    user: {
      telegramUserId: user.telegramUserId,
      balance: roundUSDT(user.balance),
      points: user.points,
      referralCode: user.referralCode,
      referralCount: user.referralCount
    }
  });
});

/* =========================================================
   SCAN DEPOSITS
========================================================= */

app.get("/api/deposits/scan", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit || 20), 1),
      200
    );

    const url =
      `${TRONGRID_URL}/v1/accounts/${DEPOSIT_ADDRESS}` +
      `/transactions/trc20` +
      `?limit=${limit}` +
      `&only_confirmed=true` +
      `&contract_address=${encodeURIComponent(USDT_CONTRACT)}` +
      `&only_to=true`;

    const data = await tronGet(url);

    const incoming = (data.data || [])
      .filter(tx =>
        String(tx.to || "").toLowerCase() ===
        DEPOSIT_ADDRESS.toLowerCase()
      )
      .filter(tx =>
        String(tx.token_info?.address || USDT_CONTRACT)
          .toLowerCase() === USDT_CONTRACT.toLowerCase()
      )
      .map(tx => ({
        transactionId: tx.transaction_id,
        from: tx.from,
        to: tx.to,
        token: tx.token_info?.symbol || "USDT",
        amount:
          Number(tx.value || 0) /
          Math.pow(10, USDT_DECIMALS),
        blockTimestamp: tx.block_timestamp,
        type: tx.type,
        success: tx.success !== false
      }));

    res.json({
      ok: true,
      depositAddress: DEPOSIT_ADDRESS,
      deposits: incoming
    });

  } catch (error) {
    console.error("Deposit scan error:", error);

    res.status(500).json({
      ok: false,
      error: error.message || "Scan failed"
    });
  }
});

/* =========================================================
   VERIFY TXID
========================================================= */

async function verifyUSDTTransaction(txid, expectedAmount) {
  const cleanTxid = String(txid || "").trim();

  if (!/^[a-fA-F0-9]{64}$/.test(cleanTxid)) {
    return {
      verified: false,
      status: "invalid",
      message: "Invalid TRON TXID."
    };
  }

  /*
    First check solidified transaction body.
    TRON documentation recommends using the solidity
    endpoint to confirm a transaction is solidified.
  */

  let txInfo;

  try {
    txInfo = await tronPost(
      `${TRONGRID_URL}/walletsolidity/gettransactionbyid`,
      {
        value: cleanTxid
      }
    );
  } catch (error) {
    return {
      verified: false,
      status: "not_found",
      message: "Transaction was not found on the confirmed TRON chain yet."
    };
  }

  if (!txInfo || !txInfo.txID) {
    return {
      verified: false,
      status: "not_confirmed",
      message: "Transaction is not confirmed yet."
    };
  }

  const contractRet =
    txInfo?.ret?.[0]?.contractRet;

  if (
    contractRet &&
    String(contractRet).toUpperCase() !== "SUCCESS"
  ) {
    return {
      verified: false,
      status: "failed",
      message: "TRON transaction failed."
    };
  }

  /*
    Check execution receipt.
  */

  let receipt;

  try {
    receipt = await tronPost(
      `${TRONGRID_URL}/walletsolidity/gettransactioninfobyid`,
      {
        value: cleanTxid
      }
    );
  } catch (error) {
    return {
      verified: false,
      status: "not_confirmed",
      message: "Transaction confirmation is not available yet."
    };
  }

  if (
    receipt?.receipt?.result &&
    String(receipt.receipt.result).toUpperCase() !== "SUCCESS"
  ) {
    return {
      verified: false,
      status: "failed",
      message: "USDT transaction execution failed."
    };
  }

  /*
    Use TronGrid's decoded TRC20 history.
    This gives us:
      transaction_id
      from
      to
      value
      token_info
      success
  */

  const url =
    `${TRONGRID_URL}/v1/accounts/${DEPOSIT_ADDRESS}` +
    `/transactions/trc20` +
    `?limit=200` +
    `&only_confirmed=true` +
    `&contract_address=${encodeURIComponent(USDT_CONTRACT)}` +
    `&only_to=true`;

  const data = await tronGet(url);

  const tx = (data.data || []).find(item =>
    String(item.transaction_id || "").toLowerCase() ===
    cleanTxid.toLowerCase()
  );

  if (!tx) {
    return {
      verified: false,
      status: "not_found",
      message:
        "No confirmed USDT transfer to the deposit address was found."
    };
  }

  if (
    String(tx.to || "").toLowerCase() !==
    DEPOSIT_ADDRESS.toLowerCase()
  ) {
    return {
      verified: false,
      status: "wrong_address",
      message: "This transaction was not sent to the Big Money deposit address."
    };
  }

  if (
    String(tx.token_info?.address || USDT_CONTRACT).toLowerCase() !==
    USDT_CONTRACT.toLowerCase()
  ) {
    return {
      verified: false,
      status: "wrong_token",
      message: "This transaction is not the official USDT TRC20 token."
    };
  }

  if (tx.success === false) {
    return {
      verified: false,
      status: "failed",
      message: "The USDT transfer was not successful."
    };
  }

  const actualAmount =
    Number(tx.value || 0) /
    Math.pow(10, USDT_DECIMALS);

  /*
    Expected amount is optional.
    If supplied, allow tiny floating point tolerance.
  */

  if (
    expectedAmount !== null &&
    expectedAmount !== undefined
  ) {
    const expected = Number(expectedAmount);

    if (
      !Number.isFinite(expected) ||
      expected <= 0
    ) {
      return {
        verified: false,
        status: "invalid_amount",
        message: "Invalid expected amount."
      };
    }

    if (
      Math.abs(actualAmount - expected) > 0.000001
    ) {
      return {
        verified: false,
        status: "wrong_amount",
        actualAmount,
        expectedAmount: expected,
        message:
          `Amount mismatch. Blockchain shows ${actualAmount} USDT.`
      };
    }
  }

  return {
    verified: true,
    status: "confirmed",
    transactionId: cleanTxid,
    from: tx.from,
    to: tx.to,
    amount: actualAmount,
    token: tx.token_info?.symbol || "USDT",
    blockTimestamp: tx.block_timestamp
  };
}

/* =========================================================
   VERIFY DEPOSIT + CREDIT BALANCE
========================================================= */

app.post("/api/deposits/verify", async (req, res) => {
  try {
    const {
      telegramUserId,
      txid,
      amount
    } = req.body || {};

    const userId = String(
      telegramUserId || ""
    ).trim();

    const cleanTxid = String(
      txid || ""
    ).trim();

    const expectedAmount =
      amount === undefined ||
      amount === null ||
      amount === ""
        ? null
        : Number(amount);

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "telegramUserId is required"
      });
    }

    if (!cleanTxid) {
      return res.status(400).json({
        ok: false,
        error: "TXID is required"
      });
    }

    /*
      IMPORTANT:
      Never credit the same TXID twice.
    */

    const existing = store.deposits.find(
      d =>
        String(d.txid || "").toLowerCase() ===
        cleanTxid.toLowerCase()
    );

    if (existing) {
      return res.json({
        ok: true,
        alreadyProcessed: true,
        deposit: existing,
        message:
          "This TXID has already been processed."
      });
    }

    const result = await verifyUSDTTransaction(
      cleanTxid,
      expectedAmount
    );

    if (!result.verified) {
      return res.status(400).json({
        ok: false,
        verified: false,
        status: result.status,
        message: result.message,
        actualAmount: result.actualAmount || null
      });
    }

    if (result.amount < MIN_DEPOSIT) {
      return res.status(400).json({
        ok: false,
        verified: false,
        status: "below_minimum",
        message:
          `Minimum deposit is ${MIN_DEPOSIT} USDT.`,
        actualAmount: result.amount
      });
    }

    const user = getUser(userId);

    const creditedAmount =
      roundUSDT(result.amount);

    user.balance =
      roundUSDT(
        Number(user.balance || 0) +
        creditedAmount
      );

    const deposit = {
      id: `dep_${Date.now()}`,
      telegramUserId: userId,
      txid: cleanTxid,
      amount: creditedAmount,
      from: result.from,
      to: result.to,
      token: result.token,
      status: "confirmed",
      blockTimestamp: result.blockTimestamp,
      createdAt: new Date().toISOString()
    };

    store.deposits.push(deposit);

    saveStore(store);

    console.log(
      `DEPOSIT VERIFIED: ${creditedAmount} USDT -> user ${userId}`
    );

    res.json({
      ok: true,
      verified: true,
      alreadyProcessed: false,
      deposit,
      balance: roundUSDT(user.balance),
      message:
        `${creditedAmount} USDT was added to your balance.`
    });

  } catch (error) {
    console.error("Verify deposit error:", error);

    res.status(500).json({
      ok: false,
      verified: false,
      error:
        error.message ||
        "Deposit verification failed."
    });
  }
});

/* =========================================================
   GET DEPOSITS
========================================================= */

app.get("/api/deposits", (req, res) => {
  res.json({
    ok: true,
    deposits: store.deposits
  });
});

/* =========================================================
   WITHDRAWAL REQUEST
   NOTE:
   This version records the withdrawal request.
   It does NOT automatically broadcast a real USDT
   transaction. We will connect real signing separately.
========================================================= */

app.post("/api/withdrawals/request", (req, res) => {
  try {
    const {
      telegramUserId,
      address,
      amount
    } = req.body || {};

    const userId = String(
      telegramUserId || ""
    ).trim();

    const walletAddress = String(
      address || ""
    ).trim();

    const numericAmount = Number(amount);

    if (
      !userId ||
      !walletAddress ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId, address and valid amount are required"
      });
    }

    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid TRON TRC20 address"
      });
    }

    if (numericAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        ok: false,
        error:
          `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT.`
      });
    }

    const user = getUser(userId);

    if (
      Number(user.balance || 0) <
      numericAmount
    ) {
      return res.status(400).json({
        ok: false,
        error: "Insufficient available balance."
      });
    }

    /*
      Reserve the amount.
      It will remain pending until actual blockchain
      withdrawal processing is connected.
    */

    user.balance = roundUSDT(
      Number(user.balance) -
      numericAmount
    );

    const withdrawal = {
      id: `wd_${Date.now()}`,
      telegramUserId: userId,
      address: walletAddress,
      amount: roundUSDT(numericAmount),
      status: "pending",
      createdAt: new Date().toISOString()
    };

    store.withdrawals.push(withdrawal);

    saveStore(store);

    res.json({
      ok: true,
      withdrawal,
      balance: roundUSDT(user.balance),
      message:
        "Withdrawal request created and is pending processing."
    });

  } catch (error) {
    console.error("Withdrawal error:", error);

    res.status(500).json({
      ok: false,
      error: "Withdrawal request failed."
    });
  }
});

/* =========================================================
   GET WITHDRAWALS
========================================================= */

app.get("/api/withdrawals", (req, res) => {
  res.json({
    ok: true,
    withdrawals: store.withdrawals
  });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    ok: false,
    error: "Internal server error"
  });
});

/* =========================================================
   START
========================================================= */

ensureStore();

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("====================================");
    console.log("Big Money Backend");
    console.log("Port:", PORT);
    console.log("Network: TRON TRC20");
    console.log("Deposit address:", DEPOSIT_ADDRESS);
    console.log("USDT contract:", USDT_CONTRACT);
    console.log(
      "TronGrid API key:",
      TRONGRID_API_KEY
        ? "configured"
        : "not configured"
    );
    console.log("====================================");
  }
);

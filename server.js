// Big Money - server.js

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL =
  process.env.TRONGRID_URL ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const ADMIN_TEST_KEY =
  process.env.ADMIN_TEST_KEY || "";

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "8381232361")
    .split(",")
    .map((x) => String(x).trim())
    .filter(Boolean);

// --------------------------------------------------
// Rewards
// --------------------------------------------------

const REFERRAL_REWARD_POINTS = 3;
const REFERRAL_MIN_DEPOSIT = 10;

const DAILY_REWARD_POINTS = 0.5;
const DAILY_REWARD_MIN_DEPOSIT = 10;

const KABUL_TIMEZONE = "Asia/Kabul";

// --------------------------------------------------
// App
// --------------------------------------------------

app.use(express.json({ limit: "100kb" }));

// --------------------------------------------------
// CORS
// --------------------------------------------------

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (
        origin === ALLOWED_ORIGIN ||
        origin === "https://web.telegram.org" ||
        origin === "https://web.telegram.org/"
      ) {
        return callback(null, true);
      }

      // Allow Telegram / browser requests.
      return callback(null, true);
    },

    methods: ["GET", "POST", "OPTIONS"],

    // IMPORTANT:
    // X-Telegram-Init-Data must be here.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Admin-Test-Key",
      "X-Telegram-Init-Data"
    ]
  })
);

// --------------------------------------------------
// Database
// --------------------------------------------------

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "big-money-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const EMPTY_DB = {
  users: {},
  deposits: {},
  withdrawals: {},
  usedTransactions: {},
  testCredits: {}
};

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(EMPTY_DB, null, 2)
      );

      return JSON.parse(JSON.stringify(EMPTY_DB));
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");

    if (!raw.trim()) {
      return JSON.parse(JSON.stringify(EMPTY_DB));
    }

    const parsed = JSON.parse(raw);

    return {
      ...EMPTY_DB,
      ...parsed,
      users: parsed.users || {},
      deposits: parsed.deposits || {},
      withdrawals: parsed.withdrawals || {},
      usedTransactions: parsed.usedTransactions || {},
      testCredits: parsed.testCredits || {}
    };
  } catch (error) {
    console.error("Database load error:", error);

    return JSON.parse(JSON.stringify(EMPTY_DB));
  }
}

let db = loadDB();

function saveDB() {
  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(db, null, 2)
  );

  fs.renameSync(tempFile, DATA_FILE);
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function roundNumber(value, decimals = 6) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  const factor = Math.pow(10, decimals);

  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function normalizeAmount(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }

  return roundNumber(n, 6);
}

function cleanTxid(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

function isValidTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "")
  );
}

function getTodayKabul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KABUL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getUser(telegramUserId) {
  return db.users[String(telegramUserId)] || null;
}

function ensureUser(telegramUser) {
  const id = String(telegramUser.id);

  let user = db.users[id];

  if (!user) {
    user = {
      id,
      telegramId: id,
      username: telegramUser.username || "",
      firstName: telegramUser.first_name || "",
      lastName: telegramUser.last_name || "",
      balance: 0,
      points: 0,
      referrals: 0,
      referralEarnings: 0,
      referredBy: null,
      referralRewardPaid: false,
      referralRewardPaidAt: null,
      dailyRewards: {},
      deposits: [],
      withdrawals: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    db.users[id] = user;
    saveDB();

    return user;
  }

  let changed = false;

  if (telegramUser.username !== undefined) {
    const username = telegramUser.username || "";

    if (user.username !== username) {
      user.username = username;
      changed = true;
    }
  }

  if (telegramUser.first_name !== undefined) {
    const firstName = telegramUser.first_name || "";

    if (user.firstName !== firstName) {
      user.firstName = firstName;
      changed = true;
    }
  }

  if (telegramUser.last_name !== undefined) {
    const lastName = telegramUser.last_name || "";

    if (user.lastName !== lastName) {
      user.lastName = lastName;
      changed = true;
    }
  }

  if (changed) {
    user.updatedAt = nowIso();
    saveDB();
  }

  return user;
}

// --------------------------------------------------
// Telegram WebApp authentication
// --------------------------------------------------

function validateTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  if (!initData || typeof initData !== "string") {
    throw new Error("Telegram authentication data is missing.");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram authentication hash is missing.");
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const calculatedBuffer = Buffer.from(calculatedHash, "hex");

  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error("Invalid Telegram authentication.");
  }

  const authDate = Number(params.get("auth_date"));

  if (!Number.isFinite(authDate)) {
    throw new Error("Invalid Telegram auth_date.");
  }

  const maxAge = 24 * 60 * 60;

  if (
    Math.floor(Date.now() / 1000) - authDate >
    maxAge
  ) {
    throw new Error("Telegram authentication expired.");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("Telegram user data is missing.");
  }

  let telegramUser;

  try {
    telegramUser = JSON.parse(userRaw);
  } catch {
    throw new Error("Invalid Telegram user data.");
  }

  if (!telegramUser || !telegramUser.id) {
    throw new Error("Invalid Telegram user.");
  }

  return {
    telegramUser,
    params
  };
}

function getInitDataFromRequest(req) {
  return (
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    req.query?.initData ||
    ""
  );
}

function requireTelegram(req, res) {
  try {
    const initData = getInitDataFromRequest(req);

    const auth = validateTelegramInitData(initData);

    const telegramUser = auth.telegramUser;

    const user = ensureUser(telegramUser);

    return {
      telegramUser,
      user,
      params: auth.params
    };
  } catch (error) {
    res.status(401).json({
      ok: false,
      message: error.message || "Telegram authentication failed."
    });

    return null;
  }
}

function requireAdmin(req, res) {
  const adminId =
    req.headers["x-admin-telegram-id"] ||
    req.body?.adminTelegramId ||
    req.query?.adminTelegramId;

  if (!adminId) {
    res.status(401).json({
      ok: false,
      message: "Admin Telegram ID is required."
    });

    return null;
  }

  if (!ADMIN_TELEGRAM_IDS.includes(String(adminId))) {
    res.status(403).json({
      ok: false,
      message: "Admin access denied."
    });

    return null;
  }

  return String(adminId);
}

// --------------------------------------------------
// Referral
// --------------------------------------------------

function extractReferral(params) {
  const startParam =
    params.get("start_param") ||
    params.get("startapp") ||
    "";

  if (!startParam) {
    return null;
  }

  if (!startParam.startsWith("ref_")) {
    return null;
  }

  const referrerId = startParam.substring(4).trim();

  if (!/^\d+$/.test(referrerId)) {
    return null;
  }

  return referrerId;
}

function registerReferral(user, params) {
  if (!user) {
    return;
  }

  if (user.referredBy) {
    return;
  }

  const referrerId = extractReferral(params);

  if (!referrerId) {
    return;
  }

  if (String(referrerId) === String(user.id)) {
    return;
  }

  const referrer = getUser(referrerId);

  if (!referrer) {
    return;
  }

  user.referredBy = String(referrerId);
  user.updatedAt = nowIso();

  saveDB();
}

// --------------------------------------------------
// Rewards
// --------------------------------------------------

function processRewardsForDeposit(user, amount, depositId) {
  if (!user) {
    return {
      referralReward: 0,
      dailyReward: 0
    };
  }

  let referralReward = 0;
  let dailyReward = 0;

  // -----------------------------------------------
  // Referral reward
  // -----------------------------------------------

  if (
    amount >= REFERRAL_MIN_DEPOSIT &&
    user.referredBy &&
    !user.referralRewardPaid
  ) {
    const referrer = getUser(user.referredBy);

    if (referrer && referrer.id !== user.id) {
      referrer.points = roundNumber(
        Number(referrer.points || 0) +
          REFERRAL_REWARD_POINTS,
        2
      );

      referrer.referrals =
        Number(referrer.referrals || 0) + 1;

      referrer.referralEarnings =
        roundNumber(
          Number(referrer.referralEarnings || 0) +
            REFERRAL_REWARD_POINTS,
          2
        );

      user.referralRewardPaid = true;
      user.referralRewardPaidAt = nowIso();

      referralReward = REFERRAL_REWARD_POINTS;
    }
  }

  // -----------------------------------------------
  // Daily reward
  // -----------------------------------------------

  if (amount >= DAILY_REWARD_MIN_DEPOSIT) {
    const today = getTodayKabul();

    if (!user.dailyRewards) {
      user.dailyRewards = {};
    }

    if (!user.dailyRewards[today]) {
      user.points = roundNumber(
        Number(user.points || 0) +
          DAILY_REWARD_POINTS,
        2
      );

      user.dailyRewards[today] = {
        points: DAILY_REWARD_POINTS,
        depositId,
        createdAt: nowIso()
      };

      dailyReward = DAILY_REWARD_POINTS;
    }
  }

  user.updatedAt = nowIso();

  saveDB();

  return {
    referralReward,
    dailyReward
  };
}

// --------------------------------------------------
// TronGrid
// --------------------------------------------------

async function tronFetch(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      `TronGrid error: ${response.status}`
    );
  }

  return data;
}

function normalizeTransfer(item) {
  if (!item) {
    return null;
  }

  const value = Number(item.value);

  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    txid:
      item.transaction_id ||
      item.transactionId ||
      item.txID ||
      "",

    from:
      item.from ||
      item.from_address ||
      "",

    to:
      item.to ||
      item.to_address ||
      "",

    amount: value / 1e6,

    confirmed:
      item.is_confirmed === true ||
      item.confirmed === true ||
      false,

    blockTimestamp:
      item.block_timestamp ||
      item.blockTimestamp ||
      null
  };
}

async function getUsdtTransfers(address) {
  const url =
    `${TRONGRID_URL}/v1/accounts/` +
    `${encodeURIComponent(address)}/transactions/trc20` +
    `?limit=50&contract_address=${encodeURIComponent(
      USDT_CONTRACT
    )}`;

  const data = await tronFetch(url);

  const list = Array.isArray(data?.data)
    ? data.data
    : [];

  return list
    .map(normalizeTransfer)
    .filter(Boolean);
}

async function getTransactionById(txid) {
  return tronFetch(
    `${TRONGRID_URL}/walletsolidity/gettransactionbyid`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        value: txid
      })
    }
  );
}

async function getTransactionInfoById(txid) {
  return tronFetch(
    `${TRONGRID_URL}/walletsolidity/gettransactioninfobyid`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        value: txid
      })
    }
  );
}

async function getConfirmedTransferEvents(txid) {
  const url =
    `${TRONGRID_URL}/v1/transactions/` +
    `${encodeURIComponent(txid)}/events` +
    `?only_confirmed=true&event_name=Transfer`;

  const data = await tronFetch(url);

  return Array.isArray(data?.data)
    ? data.data
    : [];
}

// --------------------------------------------------
// Telegram messages
// --------------------------------------------------

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    return;
  }

  try {
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,
          parse_mode: "HTML"
        })
      }
    );
  } catch (error) {
    console.error(
      "Telegram message error:",
      error.message
    );
  }
}

async function notifyAdmins(text) {
  for (const adminId of ADMIN_TELEGRAM_IDS) {
    await sendTelegramMessage(adminId, text);
  }
}

// --------------------------------------------------
// Routes
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money",
    network: "TRON TRC20",
    token: "USDT",
    status: "online"
  });
});

// --------------------------------------------------
// Config
// --------------------------------------------------

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    network: "TRON",
    standard: "TRC20",
    token: "USDT",
    depositAddress: DEPOSIT_ADDRESS,
    botUsername: TELEGRAM_BOT_USERNAME,
    referralRewardPoints: REFERRAL_REWARD_POINTS,
    referralMinDeposit: REFERRAL_MIN_DEPOSIT,
    dailyRewardPoints: DAILY_REWARD_POINTS,
    dailyRewardMinDeposit: DAILY_REWARD_MIN_DEPOSIT
  });
});

// --------------------------------------------------
// Account
// --------------------------------------------------

app.get(
  "/api/account/:telegramUserId",
  (req, res) => {
    const auth = requireTelegram(req, res);

    if (!auth) {
      return;
    }

    const requestedId =
      String(req.params.telegramUserId);

    const authenticatedId =
      String(auth.telegramUser.id);

    if (requestedId !== authenticatedId) {
      return res.status(403).json({
        ok: false,
        message: "Telegram account mismatch."
      });
    }

    const user = auth.user;

    registerReferral(user, auth.params);

    res.json({
      ok: true,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username || "",
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        balance: roundNumber(user.balance || 0, 6),
        points: roundNumber(user.points || 0, 2),
        referrals: Number(user.referrals || 0),
        referralEarnings: roundNumber(
          user.referralEarnings || 0,
          2
        ),
        referredBy: user.referredBy || null
      }
    });
  }
);

// --------------------------------------------------
// Referral
// --------------------------------------------------

app.get(
  "/api/referral/:telegramUserId",
  (req, res) => {
    const auth = requireTelegram(req, res);

    if (!auth) {
      return;
    }

    const requestedId =
      String(req.params.telegramUserId);

    const authenticatedId =
      String(auth.telegramUser.id);

    if (requestedId !== authenticatedId) {
      return res.status(403).json({
        ok: false,
        message: "Telegram account mismatch."
      });
    }

    const user = auth.user;

    registerReferral(user, auth.params);

    const referralLink =
      `https://t.me/${TELEGRAM_BOT_USERNAME}` +
      `?startapp=ref_${user.id}`;

    res.json({
      ok: true,
      referralLink,
      referrals: Number(user.referrals || 0),
      points: roundNumber(user.points || 0, 2),
      referralEarnings: roundNumber(
        user.referralEarnings || 0,
        2
      ),
      referredBy: user.referredBy || null
    });
  }
);

// --------------------------------------------------
// Deposit check
// --------------------------------------------------

app.get("/api/deposits/check", async (req, res) => {
  try {
    const auth = requireTelegram(req, res);

    if (!auth) {
      return;
    }

    const transfers =
      await getUsdtTransfers(DEPOSIT_ADDRESS);

    const confirmed = transfers
      .filter((x) => x.confirmed)
      .map((x) => ({
        txid: x.txid,
        from: x.from,
        to: x.to,
        amount: x.amount,
        confirmed: x.confirmed,
        blockTimestamp: x.blockTimestamp
      }));

    res.json({
      ok: true,
      address: DEPOSIT_ADDRESS,
      transfers: confirmed
    });
  } catch (error) {
    console.error(
      "Deposit check error:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        error.message ||
        "Unable to check blockchain."
    });
  }
});

// --------------------------------------------------
// Deposit request
// --------------------------------------------------

app.post(
  "/api/deposits/request",
  async (req, res) => {
    const auth = requireTelegram(req, res);

    if (!auth) {
      return;
    }

    const amount = normalizeAmount(
      req.body?.amount
    );

    if (amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid deposit amount."
      });
    }

    const id =
      "dep_" +
      Date.now() +
      "_" +
      crypto.randomBytes(4).toString("hex");

    const deposit = {
      id,
      telegramUserId: auth.user.id,
      amount,
      status: "waiting",
      createdAt: nowIso()
    };

    db.deposits[id] = deposit;

    auth.user.deposits.push(id);
    auth.user.updatedAt = nowIso();

    saveDB();

    res.json({
      ok: true,
      deposit
    });
  }
);

// --------------------------------------------------
// Deposit verify
// --------------------------------------------------

app.post(
  "/api/deposits/verify",
  async (req, res) => {
    try {
      const auth = requireTelegram(req, res);

      if (!auth) {
        return;
      }

      const txid = cleanTxid(
        req.body?.txid
      );

      const requestedAmount =
        normalizeAmount(
          req.body?.amount
        );

      if (!isValidTxid(txid)) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TRON TXID. TXID must be 64 hexadecimal characters."
        });
      }

      if (requestedAmount <= 0) {
        return res.status(400).json({
          ok: false,
          message: "Invalid deposit amount."
        });
      }

      // Prevent TX reuse
      if (db.usedTransactions[txid]) {
        return res.status(400).json({
          ok: false,
          message:
            "This TXID has already been used."
        });
      }

      // Check solidified transaction
      const transaction =
        await getTransactionById(txid);

      if (
        !transaction ||
        !transaction.txID
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Transaction was not found on the TRON network."
        });
      }

      // Check solidified receipt
      const info =
        await getTransactionInfoById(txid);

      if (!info || !info.id) {
        return res.status(400).json({
          ok: false,
          message:
            "Transaction confirmation information was not found."
        });
      }

      if (
        info.receipt &&
        info.receipt.result &&
        String(info.receipt.result).toUpperCase() !==
          "SUCCESS"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "The TRON transaction was not successful."
        });
      }

      // Confirmed Transfer events
      const events =
        await getConfirmedTransferEvents(txid);

      const matchingTransfers = [];

      for (const event of events) {
        const contract =
          event?.contract_address ||
          event?.contractAddress ||
          "";

        if (
          String(contract).toLowerCase() !==
          String(USDT_CONTRACT).toLowerCase()
        ) {
          continue;
        }

        const result = event?.result || {};

        const to =
          result.to ||
          event.to ||
          "";

        const from =
          result.from ||
          event.from ||
          "";

        const valueRaw =
          result.value ??
          event.value ??
          0;

        const value =
          Number(valueRaw) / 1e6;

        if (
          String(to).toLowerCase() ===
            String(DEPOSIT_ADDRESS).toLowerCase() &&
          Number.isFinite(value) &&
          value > 0
        ) {
          matchingTransfers.push({
            from,
            to,
            amount: value,
            contract
          });
        }
      }

      if (matchingTransfers.length === 0) {
        return res.status(400).json({
          ok: false,
          message:
            "No confirmed USDT TRC20 transfer to the Big Money deposit address was found for this TXID."
        });
      }

      if (matchingTransfers.length > 1) {
        return res.status(400).json({
          ok: false,
          message:
            "This TXID contains multiple matching USDT transfers and cannot be verified automatically."
        });
      }

      const transfer =
        matchingTransfers[0];

      const actualAmount =
        roundNumber(transfer.amount, 6);

      // Exact amount
      if (
        Math.abs(
          actualAmount - requestedAmount
        ) > 0.000001
      ) {
        return res.status(400).json({
          ok: false,
          message:
            `Amount mismatch. Blockchain amount: ${actualAmount} USDT. Requested amount: ${requestedAmount} USDT.`
        });
      }

      // Find existing deposit request
      let deposit = Object.values(
        db.deposits
      ).find(
        (item) =>
          item.telegramUserId ===
            auth.user.id &&
          item.txid === txid
      );

      if (!deposit) {
        const id =
          "dep_" +
          Date.now() +
          "_" +
          crypto.randomBytes(4).toString("hex");

        deposit = {
          id,
          telegramUserId: auth.user.id,
          amount: actualAmount,
          txid,
          from: transfer.from || "",
          to: transfer.to,
          status: "confirmed",
          createdAt: nowIso(),
          confirmedAt: nowIso()
        };

        db.deposits[id] = deposit;

        auth.user.deposits.push(id);
      } else {
        if (deposit.status === "confirmed") {
          return res.status(400).json({
            ok: false,
            message:
              "This deposit is already confirmed."
          });
        }

        deposit.amount = actualAmount;
        deposit.txid = txid;
        deposit.from = transfer.from || "";
        deposit.to = transfer.to;
        deposit.status = "confirmed";
        deposit.confirmedAt = nowIso();
      }

      // Credit balance
      auth.user.balance = roundNumber(
        Number(auth.user.balance || 0) +
          actualAmount,
        6
      );

      // Mark TX as used
      db.usedTransactions[txid] = {
        txid,
        userId: auth.user.id,
        depositId: deposit.id,
        amount: actualAmount,
        from: transfer.from || "",
        to: transfer.to,
        createdAt: nowIso()
      };

      auth.user.updatedAt = nowIso();

      saveDB();

      // Rewards
      const rewards =
        processRewardsForDeposit(
          auth.user,
          actualAmount,
          deposit.id
        );

      const totalPoints =
        roundNumber(
          Number(auth.user.points || 0),
          2
        );

      // Admin notification
      await notifyAdmins(
        `💰 <b>New confirmed deposit</b>\n\n` +
        `User ID: <code>${auth.user.id}</code>\n` +
        `Username: @${auth.user.username || "none"}\n` +
        `Amount: <b>${actualAmount} USDT</b>\n` +
        `TXID: <code>${txid}</code>\n` +
        `Referral reward: ${rewards.referralReward} points\n` +
        `Daily reward: ${rewards.dailyReward} points`
      );

      res.json({
        ok: true,
        message:
          "Deposit confirmed successfully.",
        deposit,
        balance: roundNumber(
          auth.user.balance,
          6
        ),
        points: totalPoints,
        rewards
      });
    } catch (error) {
      console.error(
        "Deposit verify error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Deposit verification failed."
      });
    }
  }
);

// --------------------------------------------------
// Admin test credit
// --------------------------------------------------

app.post(
  "/api/admin/test-credit",
  async (req, res) => {
    try {
      const adminId =
        req.headers["x-admin-telegram-id"] ||
        req.body?.adminTelegramId;

      if (
        !ADMIN_TELEGRAM_IDS.includes(
          String(adminId || "")
        )
      ) {
        return res.status(403).json({
          ok: false,
          message: "Admin access denied."
        });
      }

      if (
        ADMIN_TEST_KEY &&
        String(req.headers["x-admin-test-key"] || "") !==
          String(ADMIN_TEST_KEY)
      ) {
        return res.status(403).json({
          ok: false,
          message: "Invalid admin test key."
        });
      }

      const telegramUserId =
        String(req.body?.telegramUserId || "");

      if (!telegramUserId) {
        return res.status(400).json({
          ok: false,
          message:
            "telegramUserId is required."
        });
      }

      const user = getUser(
        telegramUserId
      );

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "User not found."
        });
      }

      const id =
        "test_" +
        Date.now() +
        "_" +
        crypto.randomBytes(4).toString("hex");

      const amount = 10;

      user.balance = roundNumber(
        Number(user.balance || 0) +
          amount,
        6
      );

      db.testCredits[id] = {
        id,
        telegramUserId,
        amount,
        createdAt: nowIso()
      };

      user.updatedAt = nowIso();

      saveDB();

      await sendTelegramMessage(
        telegramUserId,
        `🧪 Test credit added\n\n` +
        `Amount: ${amount} USDT\n` +
        `Balance: ${user.balance} USDT`
      );

      res.json({
        ok: true,
        amount,
        balance: user.balance,
        message:
          "Test credit added successfully."
      });
    } catch (error) {
      console.error(
        "Admin test credit error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Test credit failed."
      });
    }
  }
);

// --------------------------------------------------
// Withdraw request
// --------------------------------------------------

app.post(
  "/api/withdrawals/request",
  async (req, res) => {
    try {
      const auth = requireTelegram(req, res);

      if (!auth) {
        return;
      }

      const amount =
        normalizeAmount(
          req.body?.amount
        );

      const address =
        String(
          req.body?.address || ""
        ).trim();

      if (amount <= 0) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid withdrawal amount."
        });
      }

      if (!isValidTronAddress(address)) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TRON address."
        });
      }

      if (
        Number(auth.user.balance || 0) <
        amount
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Insufficient balance."
        });
      }

      const id =
        "wd_" +
        Date.now() +
        "_" +
        crypto.randomBytes(4).toString("hex");

      // Current requested withdrawal rule:
      // 5 referrals are required.
      //
      // Note:
      // referral count only increases after the
      // referred user's confirmed >=10 USDT deposit.

      if (
        Number(auth.user.referrals || 0) < 5
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "You need 5 successful referrals before requesting a withdrawal."
        });
      }

      const withdrawal = {
        id,
        telegramUserId: auth.user.id,
        username: auth.user.username || "",
        amount,
        address,
        status: "pending",
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      // Reserve/deduct balance immediately.
      auth.user.balance = roundNumber(
        Number(auth.user.balance || 0) -
          amount,
        6
      );

      db.withdrawals[id] = withdrawal;

      auth.user.withdrawals.push(id);
      auth.user.updatedAt = nowIso();

      saveDB();

      await notifyAdmins(
        `💸 <b>New withdrawal request</b>\n\n` +
        `Request ID: <code>${id}</code>\n` +
        `User ID: <code>${auth.user.id}</code>\n` +
        `Username: @${auth.user.username || "none"}\n` +
        `Amount: <b>${amount} USDT</b>\n` +
        `Address: <code>${address}</code>\n` +
        `Status: Pending`
      );

      res.json({
        ok: true,
        message:
          "Withdrawal request submitted.",
        withdrawal,
        balance: roundNumber(
          auth.user.balance,
          6
        )
      });
    } catch (error) {
      console.error(
        "Withdrawal request error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Withdrawal request failed."
      });
    }
  }
);

// --------------------------------------------------
// My withdrawals
// --------------------------------------------------

app.get(
  "/api/withdrawals/me",
  (req, res) => {
    const auth = requireTelegram(req, res);

    if (!auth) {
      return;
    }

    const list = Object.values(
      db.withdrawals
    )
      .filter(
        (x) =>
          x.telegramUserId === auth.user.id
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    res.json({
      ok: true,
      withdrawals: list
    });
  }
);

// --------------------------------------------------
// Admin withdrawals
// --------------------------------------------------

app.get(
  "/api/admin/withdrawals",
  (req, res) => {
    const adminId =
      requireAdmin(req, res);

    if (!adminId) {
      return;
    }

    const list = Object.values(
      db.withdrawals
    ).sort(
      (a, b) =>
        new Date(b.createdAt) -
        new Date(a.createdAt)
    );

    res.json({
      ok: true,
      withdrawals: list
    });
  }
);

// --------------------------------------------------
// Admin approve withdrawal
// --------------------------------------------------

app.post(
  "/api/admin/withdrawals/approve",
  async (req, res) => {
    try {
      const adminId =
        requireAdmin(req, res);

      if (!adminId) {
        return;
      }

      const id =
        String(req.body?.withdrawalId || "");

      const withdrawal =
        db.withdrawals[id];

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !== "pending"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Only pending withdrawals can be approved."
        });
      }

      withdrawal.status = "approved";
      withdrawal.updatedAt = nowIso();
      withdrawal.approvedAt = nowIso();
      withdrawal.approvedBy = adminId;

      saveDB();

      await sendTelegramMessage(
        withdrawal.telegramUserId,
        `✅ <b>Withdrawal approved</b>\n\n` +
        `Request ID: <code>${withdrawal.id}</code>\n` +
        `Amount: <b>${withdrawal.amount} USDT</b>\n\n` +
        `The withdrawal is approved by admin.`
      );

      res.json({
        ok: true,
        withdrawal
      });
    } catch (error) {
      console.error(
        "Approve withdrawal error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Approval failed."
      });
    }
  }
);

// --------------------------------------------------
// Admin reject withdrawal
// --------------------------------------------------

app.post(
  "/api/admin/withdrawals/reject",
  async (req, res) => {
    try {
      const adminId =
        requireAdmin(req, res);

      if (!adminId) {
        return;
      }

      const id =
        String(req.body?.withdrawalId || "");

      const reason =
        String(
          req.body?.reason ||
            "Withdrawal rejected by admin."
        );

      const withdrawal =
        db.withdrawals[id];

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !== "pending" &&
        withdrawal.status !== "approved"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "This withdrawal cannot be rejected."
        });
      }

      const user =
        getUser(withdrawal.telegramUserId);

      if (
        user &&
        withdrawal.status !== "rejected"
      ) {
        user.balance = roundNumber(
          Number(user.balance || 0) +
            Number(withdrawal.amount || 0),
          6
        );

        user.updatedAt = nowIso();
      }

      withdrawal.status = "rejected";
      withdrawal.reason = reason;
      withdrawal.updatedAt = nowIso();
      withdrawal.rejectedAt = nowIso();
      withdrawal.rejectedBy = adminId;

      saveDB();

      await sendTelegramMessage(
        withdrawal.telegramUserId,
        `❌ <b>Withdrawal rejected</b>\n\n` +
        `Request ID: <code>${withdrawal.id}</code>\n` +
        `Amount: <b>${withdrawal.amount} USDT</b>\n` +
        `Reason: ${reason}\n\n` +
        `The amount has been returned to your Big Money balance.`
      );

      res.json({
        ok: true,
        withdrawal,
        balance: user
          ? roundNumber(user.balance, 6)
          : null
      });
    } catch (error) {
      console.error(
        "Reject withdrawal error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Rejection failed."
      });
    }
  }
);

// --------------------------------------------------
// Admin add payment TXID
// --------------------------------------------------

app.post(
  "/api/admin/withdrawals/txid",
  async (req, res) => {
    try {
      const adminId =
        requireAdmin(req, res);

      if (!adminId) {
        return;
      }

      const id =
        String(req.body?.withdrawalId || "");

      const txid =
        cleanTxid(
          req.body?.txid
        );

      if (!isValidTxid(txid)) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TXID."
        });
      }

      const withdrawal =
        db.withdrawals[id];

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      withdrawal.paymentTxid = txid;
      withdrawal.status = "approved";
      withdrawal.updatedAt = nowIso();
      withdrawal.paymentAddedAt = nowIso();
      withdrawal.paymentAddedBy = adminId;

      saveDB();

      await sendTelegramMessage(
        withdrawal.telegramUserId,
        `💚 <b>Withdrawal payment recorded</b>\n\n` +
        `Amount: <b>${withdrawal.amount} USDT</b>\n` +
        `TXID: <code>${txid}</code>\n\n` +
        `You can check the transaction on the TRON network.`
      );

      res.json({
        ok: true,
        withdrawal
      });
    } catch (error) {
      console.error(
        "Withdrawal TXID error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Could not save payment TXID."
      });
    }
  }
);

// --------------------------------------------------
// Admin users
// --------------------------------------------------

app.get(
  "/api/admin/users",
  (req, res) => {
    const adminId =
      requireAdmin(req, res);

    if (!adminId) {
      return;
    }

    const users = Object.values(
      db.users
    )
      .map((user) => ({
        id: user.id,
        telegramId: user.telegramId,
        username: user.username || "",
        firstName: user.firstName || "",
        balance: roundNumber(
          user.balance || 0,
          6
        ),
        points: roundNumber(
          user.points || 0,
          2
        ),
        referrals: Number(
          user.referrals || 0
        ),
        referredBy:
          user.referredBy || null,
        createdAt: user.createdAt
      }))
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    res.json({
      ok: true,
      users
    });
  }
);

// --------------------------------------------------
// Health
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    service: "Big Money",
    time: nowIso()
  });
});

// --------------------------------------------------
// 404
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Route not found."
  });
});

// --------------------------------------------------
// Error handler
// --------------------------------------------------

app.use((error, req, res, next) => {
  console.error(
    "Unhandled server error:",
    error
  );

  res.status(500).json({
    ok: false,
    message:
      error.message ||
      "Internal server error."
  });
});

// --------------------------------------------------
// Start
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `Big Money server running on port ${PORT}`
  );

  console.log(
    "Admin IDs:",
    ADMIN_TELEGRAM_IDS
  );

  console.log(
    "Telegram bot:",
    TELEGRAM_BOT_USERNAME
  );

  console.log(
    "Deposit address:",
    DEPOSIT_ADDRESS
  );

  console.log(
    "USDT contract:",
    USDT_CONTRACT
  );
});

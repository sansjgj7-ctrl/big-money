const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

/* =========================
   CONFIG
========================= */

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL = "https://api.trongrid.io";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const ADMIN_TELEGRAM_IDS = String(
  process.env.ADMIN_TELEGRAM_IDS || ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

/*
  Test-credit security key.

  In Render Environment add:
  ADMIN_TEST_KEY = یک رمز قوی
*/
const ADMIN_TEST_KEY =
  process.env.ADMIN_TEST_KEY || "";

/* Referral / Reward settings */

const REFERRAL_POINTS = 3;
const REFERRAL_MIN_DEPOSIT = 10;

const DAILY_REWARD_POINTS = 0.5;
const DAILY_REWARD_MIN_DEPOSIT = 10;

const DAILY_REWARD_TIMEZONE = "Asia/Kabul";

/* =========================
   DATABASE
========================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "big-money-data.json");

function emptyStore() {
  return {
    users: {},
    deposits: {},
    withdrawals: {},
    usedTransactions: {}
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(emptyStore(), null, 2)
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const store = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    if (!store.users) store.users = {};
    if (!store.deposits) store.deposits = {};
    if (!store.withdrawals) store.withdrawals = {};
    if (!store.usedTransactions) {
      store.usedTransactions = {};
    }

    return store;
  } catch (error) {
    console.error("Database read error:", error);
    return emptyStore();
  }
}

function writeStore(store) {
  ensureStore();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(store, null, 2)
  );
}

/* =========================
   HELPERS
========================= */

function nowISO() {
  return new Date().toISOString();
}

function usdtToBase(amount) {
  return Math.round(Number(amount) * 1000000);
}

function baseToUSDT(base) {
  return Number(base || 0) / 1000000;
}

function getTodayKabul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_REWARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function cleanTxid(value) {
  return String(value || "").trim();
}

function isValidTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

/* =========================
   USER
========================= */

function getUser(store, telegramUserId, extra = {}) {
  const id = String(telegramUserId);

  if (!store.users[id]) {
    store.users[id] = {
      telegramUserId: id,

      username: extra.username || "",
      firstName: extra.firstName || "",

      balance: 0,

      points: 0,

      referredBy: null,
      referralRewarded: false,

      lastDailyRewardDate: null,

      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  const user = store.users[id];

  /* Backward compatibility */
  if (typeof user.balance !== "number") {
    user.balance = Number(user.balance || 0);
  }

  if (typeof user.points !== "number") {
    user.points = Number(user.points || 0);
  }

  if (typeof user.referralRewarded !== "boolean") {
    user.referralRewarded = false;
  }

  if (!Object.prototype.hasOwnProperty.call(user, "referredBy")) {
    user.referredBy = null;
  }

  if (!Object.prototype.hasOwnProperty.call(user, "lastDailyRewardDate")) {
    user.lastDailyRewardDate = null;
  }

  if (extra.username) {
    user.username = extra.username;
  }

  if (extra.firstName) {
    user.firstName = extra.firstName;
  }

  user.updatedAt = Date.now();

  return user;
}

/* =========================
   TELEGRAM INIT DATA
========================= */

function validateTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      error: "TELEGRAM_BOT_TOKEN is not configured"
    };
  }

  if (!initData) {
    return {
      ok: false,
      error: "Telegram initData is missing"
    };
  }

  try {
    const params = new URLSearchParams(initData);

    const hash = params.get("hash");

    if (!hash) {
      return {
        ok: false,
        error: "Telegram hash is missing"
      };
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

    if (
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(hash)
      )
    ) {
      return {
        ok: false,
        error: "Invalid Telegram initData"
      };
    }

    const authDate = Number(params.get("auth_date"));

    if (!authDate) {
      return {
        ok: false,
        error: "auth_date is missing"
      };
    }

    const now = Math.floor(Date.now() / 1000);

    if (now - authDate > 86400) {
      return {
        ok: false,
        error: "Telegram initData expired"
      };
    }

    if (authDate - now > 300) {
      return {
        ok: false,
        error: "Invalid Telegram auth date"
      };
    }

    let telegramUser = null;

    const userRaw = params.get("user");

    if (userRaw) {
      telegramUser = JSON.parse(userRaw);
    }

    return {
      ok: true,
      telegramUser,
      startParam:
        params.get("start_param") ||
        params.get("startapp") ||
        ""
    };
  } catch (error) {
    console.error("Telegram validation error:", error);

    return {
      ok: false,
      error: "Could not validate Telegram data"
    };
  }
}

/* =========================
   TELEGRAM AUTH MIDDLEWARE
========================= */

function requireTelegram(req, res, next) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    req.query?.initData;

  const result = validateTelegramInitData(initData);

  if (!result.ok) {
    /*
      Backward compatibility:
      old frontend may send telegramUserId.
    */
    const oldId = String(
      req.body?.telegramUserId ||
      req.query?.telegramUserId ||
      ""
    ).trim();

    if (oldId) {
      req.telegramUser = {
        id: oldId
      };

      req.telegramStartParam = "";

      return next();
    }

    return res.status(401).json({
      ok: false,
      error: result.error
    });
  }

  if (!result.telegramUser?.id) {
    return res.status(401).json({
      ok: false,
      error: "Telegram user not found"
    });
  }

  req.telegramUser = result.telegramUser;
  req.telegramStartParam = result.startParam || "";

  next();
}

/* =========================
   ADMIN
========================= */

function isAdmin(telegramUserId) {
  return ADMIN_TELEGRAM_IDS.includes(
    String(telegramUserId)
  );
}

function requireAdmin(req, res, next) {
  const telegramUserId =
    req.telegramUser?.id ||
    req.body?.telegramUserId ||
    req.query?.telegramUserId;

  if (!telegramUserId) {
    return res.status(401).json({
      ok: false,
      error: "Telegram user is required"
    });
  }

  if (!isAdmin(telegramUserId)) {
    return res.status(403).json({
      ok: false,
      error: "Admin access required"
    });
  }

  next();
}

/* =========================
   REFERRAL REGISTRATION
========================= */

function registerReferral(store, user, startParam) {
  if (!startParam) return;

  if (!startParam.startsWith("ref_")) {
    return;
  }

  const inviterId = startParam.slice(4).trim();

  if (!inviterId) return;

  if (String(inviterId) === String(user.telegramUserId)) {
    return;
  }

  if (user.referredBy) {
    return;
  }

  if (!store.users[inviterId]) {
    return;
  }

  user.referredBy = String(inviterId);
  user.updatedAt = Date.now();
}

/* =========================
   REWARD PROCESSING
========================= */

function processDepositRewards(
  store,
  user,
  depositAmount
) {
  const result = {
    dailyReward: 0,
    referralReward: 0,
    referralUserId: null
  };

  /*
    Daily reward:
    0.50 points every day,
    if confirmed deposit >= 10 USDT.
  */

  if (depositAmount >= DAILY_REWARD_MIN_DEPOSIT) {
    const today = getTodayKabul();

    if (user.lastDailyRewardDate !== today) {
      user.points =
        Number(user.points || 0) +
        DAILY_REWARD_POINTS;

      user.lastDailyRewardDate = today;

      result.dailyReward = DAILY_REWARD_POINTS;
    }
  }

  /*
    Referral reward:
    3 points for inviter,
    only once for each referred user,
    after confirmed deposit >= 10 USDT.
  */

  if (
    depositAmount >= REFERRAL_MIN_DEPOSIT &&
    user.referredBy &&
    !user.referralRewarded
  ) {
    const inviter = store.users[
      String(user.referredBy)
    ];

    if (inviter) {
      inviter.points =
        Number(inviter.points || 0) +
        REFERRAL_POINTS;

      inviter.updatedAt = Date.now();

      user.referralRewarded = true;

      result.referralReward = REFERRAL_POINTS;
      result.referralUserId =
        String(user.referredBy);
    }
  }

  return result;
}

/* =========================
   TRON / USDT
========================= */

async function getUsdtTransfers() {
  const url =
    TRONGRID_URL +
    "/v1/accounts/" +
    DEPOSIT_ADDRESS +
    "/transactions/trc20" +
    "?limit=50&contract_address=" +
    USDT_CONTRACT;

  const headers = {};

  if (process.env.TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] =
      process.env.TRONGRID_API_KEY;
  }

  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    const text = await response
      .text()
      .catch(() => "");

    throw new Error(
      "TronGrid request failed: " +
        response.status +
        " " +
        text
    );
  }

  return await response.json();
}

function normalizeTransfer(tx) {
  return {
    transactionId:
      tx.transaction_id || null,

    from:
      tx.from || null,

    to:
      tx.to || null,

    amountUSDT:
      Number(tx.value || 0) / 1000000,

    confirmed:
      Boolean(tx.block_timestamp),

    timestamp:
      tx.block_timestamp || null,

    tokenContract:
      tx.token_info?.address ||
      tx.contract_address ||
      USDT_CONTRACT
  };
}

async function findTransfer(txid) {
  const data =
    await getUsdtTransfers();

  const transfers =
    (data.data || []).map(
      normalizeTransfer
    );

  return (
    transfers.find(
      (tx) =>
        String(tx.transactionId || "")
          .toLowerCase() ===
        txid.toLowerCase()
    ) || null
  );
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Big Money Backend",
    network: "TRON TRC20",
    version: "reward-test-credit"
  });
});

/* =========================
   CONFIG
========================= */

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,

    network: "TRON",
    token: "USDT",
    standard: "TRC20",

    depositAddress: DEPOSIT_ADDRESS,

    rewards: {
      referralPoints: REFERRAL_POINTS,
      referralMinimumDeposit:
        REFERRAL_MIN_DEPOSIT,

      dailyRewardPoints:
        DAILY_REWARD_POINTS,

      dailyRewardMinimumDeposit:
        DAILY_REWARD_MIN_DEPOSIT
    }
  });
});

/* =========================
   ACCOUNT
========================= */

app.get(
  "/api/account/:telegramUserId",
  (req, res) => {
    const telegramUserId =
      String(
        req.params.telegramUserId || ""
      ).trim();

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error: "telegramUserId is required"
      });
    }

    const store = readStore();

    const user = getUser(
      store,
      telegramUserId
    );

    const deposits =
      Object.values(store.deposits)
        .filter(
          (d) =>
            String(d.telegramUserId) ===
            telegramUserId
        )
        .sort(
          (a, b) =>
            (b.createdAt || 0) -
            (a.createdAt || 0)
        )
        .slice(0, 50);

    const withdrawals =
      Object.values(
        store.withdrawals
      )
        .filter(
          (w) =>
            String(w.telegramUserId) ===
            telegramUserId
        )
        .sort(
          (a, b) =>
            (b.createdAt || 0) -
            (a.createdAt || 0)
        )
        .slice(0, 50);

    res.json({
      ok: true,

      user: {
        telegramUserId,
        username:
          user.username || "",

        firstName:
          user.firstName || "",

        balance:
          Number(user.balance || 0),

        points:
          Number(user.points || 0),

        referredBy:
          user.referredBy || null,

        referralRewarded:
          Boolean(
            user.referralRewarded
          ),

        lastDailyRewardDate:
          user.lastDailyRewardDate ||
          null
      },

      deposits,
      withdrawals
    });
  }
);

/* =========================
   REFERRAL
========================= */

app.get(
  "/api/referral/:telegramUserId",
  (req, res) => {
    const telegramUserId =
      String(
        req.params.telegramUserId || ""
      ).trim();

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error: "telegramUserId is required"
      });
    }

    const store = readStore();

    getUser(
      store,
      telegramUserId
    );

    const referredUsers =
      Object.values(store.users)
        .filter(
          (u) =>
            String(u.referredBy) ===
            telegramUserId
        );

    const successfulReferrals =
      referredUsers.filter(
        (u) =>
          Boolean(u.referralRewarded)
      );

    const botUsername =
      process.env.TELEGRAM_BOT_USERNAME ||
      "bigmoney2026bot";

    const referralLink =
      "https://t.me/" +
      botUsername +
      "?startapp=ref_" +
      telegramUserId;

    res.json({
      ok: true,

      referralLink,

      totalInvited:
        referredUsers.length,

      successfulReferrals:
        successfulReferrals.length,

      points:
        successfulReferrals.length *
        REFERRAL_POINTS,

      rewardPerReferral:
        REFERRAL_POINTS,

      minimumDeposit:
        REFERRAL_MIN_DEPOSIT
    });
  }
);

/* =========================
   DEPOSIT CHECK
========================= */

app.get(
  "/api/deposits/check",
  async (req, res) => {
    try {
      const data =
        await getUsdtTransfers();

      res.json({
        ok: true,

        depositAddress:
          DEPOSIT_ADDRESS,

        transfers:
          (data.data || []).map(
            normalizeTransfer
          )
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error:
          "Could not check TRON transfers"
      });
    }
  }
);

/* =========================
   DEPOSIT REQUEST
========================= */

app.post(
  "/api/deposits/request",
  (req, res) => {
    const body = req.body || {};

    const telegramUserId =
      String(
        body.telegramUserId || ""
      ).trim();

    const amount =
      Number(body.amount);

    if (
      !telegramUserId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 100000000
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId and a valid amount are required"
      });
    }

    const store = readStore();

    getUser(
      store,
      telegramUserId
    );

    const id =
      "dep_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8);

    store.deposits[id] = {
      id,

      telegramUserId,

      claimedAmount:
        amount,

      txid: null,

      status:
        "pending",

      createdAt:
        Date.now()
    };

    writeStore(store);

    res.json({
      ok: true,

      deposit:
        store.deposits[id]
    });
  }
);

/* =========================
   DEPOSIT VERIFY
========================= */

app.post(
  "/api/deposits/verify",
  async (req, res) => {
    const body =
      req.body || {};

    const telegramUserId =
      String(
        body.telegramUserId || ""
      ).trim();

    const txid =
      cleanTxid(body.txid);

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId is required"
      });
    }

    if (!isValidTxid(txid)) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid TRON transaction ID"
      });
    }

    const store = readStore();

    const alreadyUsed =
      Object.values(
        store.deposits
      ).find(
        (d) =>
          d.txid &&
          String(d.txid)
            .toLowerCase() ===
            txid.toLowerCase() &&
          d.status ===
            "confirmed"
      );

    if (alreadyUsed) {
      return res.status(409).json({
        ok: false,
        error:
          "This transaction has already been credited"
      });
    }

    if (
      store.usedTransactions &&
      store.usedTransactions[
        txid.toLowerCase()
      ]
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "This transaction has already been used"
      });
    }

    try {
      const transfer =
        await findTransfer(txid);

      if (!transfer) {
        return res.status(404).json({
          ok: false,
          error:
            "Transaction was not found in recent USDT TRC20 transfers"
        });
      }

      if (!transfer.confirmed) {
        return res.status(409).json({
          ok: false,
          error:
            "Transaction is not confirmed yet"
        });
      }

      if (
        !transfer.to ||
        transfer.to.toLowerCase() !==
          DEPOSIT_ADDRESS.toLowerCase()
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Transaction recipient does not match the deposit address"
        });
      }

      if (
        transfer.tokenContract &&
        transfer.tokenContract.toLowerCase() !==
          USDT_CONTRACT.toLowerCase()
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Transaction token is not official USDT TRC20"
        });
      }

      if (
        !Number.isFinite(
          transfer.amountUSDT
        ) ||
        transfer.amountUSDT <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Transaction amount is invalid"
        });
      }

      const user =
        getUser(
          store,
          telegramUserId
        );

      const depositId =
        "dep_" +
        Date.now() +
        "_" +
        Math.random()
          .toString(36)
          .slice(2, 8);

      store.deposits[
        depositId
      ] = {
        id: depositId,

        telegramUserId,

        claimedAmount:
          null,

        txid:
          transfer.transactionId,

        actualAmount:
          transfer.amountUSDT,

        from:
          transfer.from,

        to:
          transfer.to,

        status:
          "confirmed",

        createdAt:
          Date.now(),

        confirmedAt:
          Date.now()
      };

      user.balance =
        Number(user.balance || 0) +
        transfer.amountUSDT;

      const rewards =
        processDepositRewards(
          store,
          user,
          transfer.amountUSDT
        );

      store.usedTransactions[
        txid.toLowerCase()
      ] = {
        telegramUserId,
        amount:
          transfer.amountUSDT,
        usedAt:
          Date.now()
      };

      writeStore(store);

      return res.json({
        ok: true,

        credited: true,

        amountUSDT:
          transfer.amountUSDT,

        balance:
          user.balance,

        points:
          user.points,

        transactionId:
          transfer.transactionId,

        rewards,

        deposit:
          store.deposits[
            depositId
          ]
      });
    } catch (error) {
      console.error(
        "Deposit verification error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Could not verify transaction on TRON"
      });
    }
  }
);

/* =========================
   TEST CREDIT
   EXACTLY 10 USDT
   ADMIN ONLY
========================= */

app.post(
  "/api/admin/test-credit",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    /*
      This endpoint adds exactly 10 USDT
      to the ADMIN'S account.

      It is NOT a blockchain deposit.
      It does NOT trigger referral reward.
      It does NOT trigger daily reward.
      It does NOT create a real TXID.
    */

    if (!ADMIN_TEST_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "ADMIN_TEST_KEY is not configured on the server"
      });
    }

    const suppliedKey =
      String(
        req.headers["x-admin-test-key"] ||
        req.body?.adminTestKey ||
        ""
      ).trim();

    if (
      !suppliedKey ||
      suppliedKey !==
        ADMIN_TEST_KEY
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Invalid admin test key"
      });
    }

    const telegramUserId =
      String(
        req.telegramUser?.id ||
        req.body?.telegramUserId ||
        ""
      ).trim();

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error:
          "Telegram user ID is required"
      });
    }

    const store = readStore();

    const user =
      getUser(
        store,
        telegramUserId
      );

    const TEST_AMOUNT = 10;

    user.balance =
      Number(user.balance || 0) +
      TEST_AMOUNT;

    user.updatedAt =
      Date.now();

    const testId =
      "test_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8);

    if (!store.testCredits) {
      store.testCredits = {};
    }

    store.testCredits[
      testId
    ] = {
      id: testId,

      telegramUserId,

      amount:
        TEST_AMOUNT,

      type:
        "ADMIN_TEST_CREDIT",

      createdAt:
        Date.now()
    };

    writeStore(store);

    return res.json({
      ok: true,

      test: true,

      credited:
        TEST_AMOUNT,

      balance:
        Number(user.balance || 0),

      points:
        Number(user.points || 0),

      message:
        "10 USDT test balance added successfully"
    });
  }
);

/* =========================
   WITHDRAWAL
========================= */

app.post(
  "/api/withdrawals/request",
  (req, res) => {
    const body =
      req.body || {};

    const telegramUserId =
      String(
        body.telegramUserId || ""
      ).trim();

    const address =
      String(
        body.address || ""
      ).trim();

    const amount =
      Number(body.amount);

    if (
      !telegramUserId ||
      !address ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId, address and valid amount are required"
      });
    }

    if (
      !isValidTronAddress(
        address
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid TRON address"
      });
    }

    const store =
      readStore();

    const user =
      getUser(
        store,
        telegramUserId
      );

    if (
      amount >
      Number(user.balance || 0)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Insufficient balance"
      });
    }

    /*
      Reserve/deduct balance.
      Actual blockchain transfer
      must be handled by admin approval.
    */

    user.balance =
      Number(user.balance || 0) -
      amount;

    const id =
      "wd_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8);

    store.withdrawals[id] = {
      id,

      telegramUserId,

      address,

      amount,

      status:
        "pending",

      createdAt:
        Date.now()
    };

    writeStore(store);

    res.json({
      ok: true,

      withdrawal:
        store.withdrawals[id],

      balance:
        user.balance
    });
  }
);

/* =========================
   ADMIN: WITHDRAWALS
========================= */

app.get(
  "/api/admin/withdrawals",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    const store =
      readStore();

    const withdrawals =
      Object.values(
        store.withdrawals
      )
        .sort(
          (a, b) =>
            (b.createdAt || 0) -
            (a.createdAt || 0)
        );

    res.json({
      ok: true,
      withdrawals
    });
  }
);

/* =========================
   ADMIN: USERS
========================= */

app.get(
  "/api/admin/users",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    const store =
      readStore();

    const users =
      Object.values(
        store.users
      );

    res.json({
      ok: true,
      users
    });
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "Big Money Backend running on port " +
        PORT
    );

    console.log(
      "Deposit address:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "Admin IDs configured:",
      ADMIN_TELEGRAM_IDS.length
    );

    console.log(
      "Test credit:",
      ADMIN_TEST_KEY
        ? "enabled"
        : "disabled"
    );
  }
);

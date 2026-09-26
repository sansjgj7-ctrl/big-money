const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const ADMIN_TELEGRAM_IDS = String(
  process.env.ADMIN_TELEGRAM_IDS || ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const USDT_DECIMALS = 6;

/*
========================================================
REWARDS
========================================================
*/

const REFERRAL_POINTS = 3;
const REFERRAL_MIN_DEPOSIT = 10;

const DAILY_REWARD_POINTS = 0.5;
const DAILY_REWARD_MIN_DEPOSIT = 10;

const DAILY_REWARD_TIMEZONE = "Asia/Kabul";

/*
========================================================
APP / DATABASE
========================================================
*/

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        origin === ALLOWED_ORIGIN ||
        origin === "https://web.telegram.org" ||
        origin === "https://web.telegram.org/"
      ) {
        return callback(null, true);
      }

      return callback(null, true);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Admin-Test-Key"
    ]
  })
);

app.use(express.json({ limit: "100kb" }));

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "big-money-data.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      users: [],
      deposits: [],
      withdrawals: [],
      usedTransactions: [],
      testCredits: []
    };

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(initial, null, 2)
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");

    const store = JSON.parse(data);

    store.users = Array.isArray(store.users)
      ? store.users
      : [];

    store.deposits = Array.isArray(store.deposits)
      ? store.deposits
      : [];

    store.withdrawals = Array.isArray(store.withdrawals)
      ? store.withdrawals
      : [];

    store.usedTransactions = Array.isArray(
      store.usedTransactions
    )
      ? store.usedTransactions
      : [];

    store.testCredits = Array.isArray(store.testCredits)
      ? store.testCredits
      : [];

    return store;
  } catch (error) {
    console.error("Database read error:", error);

    return {
      users: [],
      deposits: [],
      withdrawals: [],
      usedTransactions: [],
      testCredits: []
    };
  }
}

function writeStore(store) {
  ensureStore();

  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(store, null, 2)
  );

  fs.renameSync(tempFile, DATA_FILE);
}

/*
========================================================
HELPERS
========================================================
*/

function nowIso() {
  return new Date().toISOString();
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
    String(address || "").trim()
  );
}

function getTodayKabul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_REWARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function roundNumber(value, decimals = 6) {
  const factor = Math.pow(10, decimals);

  return (
    Math.round(
      (Number(value) + Number.EPSILON) * factor
    ) / factor
  );
}

function normalizeAmount(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return roundNumber(n, 6);
}

/*
========================================================
USER FUNCTIONS
========================================================
*/

function findUser(store, telegramUserId) {
  return store.users.find(
    (user) =>
      String(user.telegramUserId) ===
      String(telegramUserId)
  );
}

function createOrUpdateUser(store, telegramUser) {
  const id = String(telegramUser.id);

  let user = findUser(store, id);

  if (!user) {
    user = {
      telegramUserId: id,
      username: telegramUser.username || "",
      firstName: telegramUser.first_name || "",
      lastName: telegramUser.last_name || "",

      balance: 0,
      points: 0,

      referredBy: null,
      referralRewarded: false,

      lastDailyRewardDate: null,

      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    store.users.push(user);
  } else {
    user.username =
      telegramUser.username ||
      user.username ||
      "";

    user.firstName =
      telegramUser.first_name ||
      user.firstName ||
      "";

    user.lastName =
      telegramUser.last_name ||
      user.lastName ||
      "";

    if (typeof user.balance !== "number") {
      user.balance = Number(user.balance) || 0;
    }

    if (typeof user.points !== "number") {
      user.points = Number(user.points) || 0;
    }

    if (!("referralRewarded" in user)) {
      user.referralRewarded = false;
    }

    user.updatedAt = nowIso();
  }

  return user;
}

/*
========================================================
TELEGRAM AUTH
========================================================
*/

function parseTelegramInitData(initData) {
  const params = new URLSearchParams(initData);

  const data = {};

  for (const [key, value] of params.entries()) {
    data[key] = value;
  }

  return data;
}

function validateTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured."
    );
  }

  if (!initData) {
    throw new Error(
      "Telegram initData is required."
    );
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error(
      "Telegram authentication hash is missing."
    );
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) =>
      a.localeCompare(b)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac(
      "sha256",
      "WebAppData"
    )
    .update(TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac(
      "sha256",
      secretKey
    )
    .update(dataCheckString)
    .digest("hex");

  const receivedBuffer = Buffer.from(
    receivedHash,
    "hex"
  );

  const calculatedBuffer = Buffer.from(
    calculatedHash,
    "hex"
  );

  if (
    receivedBuffer.length !==
    calculatedBuffer.length ||
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error(
      "Invalid Telegram authentication."
    );
  }

  const authDate = Number(
    params.get("auth_date") || 0
  );

  if (!authDate) {
    throw new Error(
      "Telegram auth_date is missing."
    );
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  /*
  Reject very old initData.
  24 hours is used here so users do not get
  randomly logged out too quickly.
  */

  if (age > 86400 || age < -300) {
    throw new Error(
      "Telegram authentication data has expired."
    );
  }

  const userString = params.get("user");

  if (!userString) {
    throw new Error(
      "Telegram user data is missing."
    );
  }

  let telegramUser;

  try {
    telegramUser = JSON.parse(userString);
  } catch (error) {
    throw new Error(
      "Invalid Telegram user data."
    );
  }

  if (!telegramUser.id) {
    throw new Error(
      "Telegram user ID is missing."
    );
  }

  return {
    telegramUser,
    startParam:
      params.get("start_param") ||
      params.get("startapp") ||
      ""
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

function requireTelegram(req, res, next) {
  try {
    const initData =
      getInitDataFromRequest(req);

    const auth =
      validateTelegramInitData(initData);

    req.telegramUser =
      auth.telegramUser;

    req.telegramStartParam =
      auth.startParam;

    next();
  } catch (error) {
    console.error(
      "Telegram auth error:",
      error.message
    );

    return res.status(401).json({
      ok: false,
      message:
        error.message ||
        "Telegram authentication failed."
    });
  }
}

/*
========================================================
ADMIN AUTH
========================================================
*/

function isAdmin(telegramUserId) {
  return ADMIN_TELEGRAM_IDS.includes(
    String(telegramUserId)
  );
}

function requireAdmin(req, res, next) {
  if (!req.telegramUser) {
    return res.status(401).json({
      ok: false,
      message: "Telegram authentication required."
    });
  }

  if (
    !isAdmin(req.telegramUser.id)
  ) {
    return res.status(403).json({
      ok: false,
      message: "Admin access required."
    });
  }

  next();
}

/*
========================================================
REFERRALS
========================================================
*/

function extractReferralId(startParam) {
  const value = String(
    startParam || ""
  ).trim();

  if (!value) {
    return null;
  }

  if (value.startsWith("ref_")) {
    return value.substring(4);
  }

  return null;
}

function registerReferral(
  store,
  telegramUserId,
  startParam
) {
  const currentId =
    String(telegramUserId);

  const referralId =
    extractReferralId(startParam);

  if (!referralId) {
    return false;
  }

  if (referralId === currentId) {
    return false;
  }

  const currentUser =
    findUser(store, currentId);

  const referrer =
    findUser(store, referralId);

  if (!currentUser || !referrer) {
    return false;
  }

  if (currentUser.referredBy) {
    return false;
  }

  currentUser.referredBy =
    referralId;

  currentUser.updatedAt = nowIso();

  return true;
}

function getReferralInfo(
  store,
  telegramUserId
) {
  const id =
    String(telegramUserId);

  const user =
    findUser(store, id);

  if (!user) {
    return {
      referralLink:
        `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${id}`,
      invited: 0,
      successful: 0,
      points: 0
    };
  }

  const referredUsers =
    store.users.filter(
      (u) =>
        String(u.referredBy) === id
    );

  const successful =
    referredUsers.filter(
      (u) =>
        u.referralRewarded === true
    );

  return {
    referralLink:
      `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${id}`,

    invited:
      referredUsers.length,

    successful:
      successful.length,

    points:
      Number(user.points || 0)
  };
}

/*
========================================================
REWARD PROCESSING
========================================================
*/

function processDepositRewards(
  store,
  user,
  depositAmount
) {
  const amount =
    Number(depositAmount);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return {
      referralReward: 0,
      dailyReward: 0
    };
  }

  let referralReward = 0;
  let dailyReward = 0;

  /*
  Referral reward:
  The invited user must deposit at least
  10 USDT and the referral is rewarded only once.
  */

  if (
    amount >= REFERRAL_MIN_DEPOSIT &&
    user.referredBy &&
    !user.referralRewarded
  ) {
    const referrer =
      findUser(
        store,
        user.referredBy
      );

    if (
      referrer &&
      String(referrer.telegramUserId) !==
        String(user.telegramUserId)
    ) {
      referrer.points =
        roundNumber(
          Number(referrer.points || 0) +
            REFERRAL_POINTS,
          2
        );

      referrer.updatedAt =
        nowIso();

      user.referralRewarded =
        true;

      referralReward =
        REFERRAL_POINTS;
    }
  }

  /*
  Daily reward:
  Every Kabul day, the user can receive
  0.50 points after a confirmed deposit
  of at least 10 USDT.
  */

  if (
    amount >= DAILY_REWARD_MIN_DEPOSIT
  ) {
    const today =
      getTodayKabul();

    if (
      user.lastDailyRewardDate !==
      today
    ) {
      user.points =
        roundNumber(
          Number(user.points || 0) +
            DAILY_REWARD_POINTS,
          2
        );

      user.lastDailyRewardDate =
        today;

      dailyReward =
        DAILY_REWARD_POINTS;
    }
  }

  user.updatedAt =
    nowIso();

  return {
    referralReward,
    dailyReward
  };
}

/*
========================================================
TRONGRID
========================================================
*/

async function tronFetch(
  endpoint,
  options = {}
) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (TRONGRID_API_KEY) {
    headers[
      "TRON-PRO-API-KEY"
    ] = TRONGRID_API_KEY;
  }

  const response =
    await fetch(
      `${TRONGRID_URL}${endpoint}`,
      {
        ...options,
        headers
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      `TronGrid HTTP ${response.status}`
    );
  }

  return data;
}

function normalizeTransfer(
  event
) {
  const result =
    event.result || {};

  let from =
    result.from ||
    event.from ||
    "";

  let to =
    result.to ||
    event.to ||
    "";

  let value =
    result.value ??
    event.value ??
    "0";

  if (
    typeof from === "string" &&
    from.length === 64
  ) {
    try {
      const hex =
        Buffer.from(
          from,
          "hex"
        );

      if (
        hex.length === 32 &&
        hex[0] === 0x41
      ) {
        from = base58Encode(
          hex
        );
      }
    } catch {}
  }

  if (
    typeof to === "string" &&
    to.length === 64
  ) {
    try {
      const hex =
        Buffer.from(
          to,
          "hex"
        );

      if (
        hex.length === 32 &&
        hex[0] === 0x41
      ) {
        to = base58Encode(
          hex
        );
      }
    } catch {}
  }

  const amount =
    Number(value) /
    Math.pow(
      10,
      USDT_DECIMALS
    );

  return {
    txid:
      event.transaction_id ||
      event.transactionId ||
      "",

    from,
    to,

    amount:
      normalizeAmount(amount),

    contract:
      event.contract_address ||
      event.contractAddress ||
      "",

    blockTimestamp:
      event.block_timestamp ||
      event.blockTimestamp ||
      null
  };
}

/*
Simple Base58 encoder used only for
TronGrid address normalization.
*/

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buffer) {
  let zeros = 0;

  while (
    zeros < buffer.length &&
    buffer[zeros] === 0
  ) {
    zeros++;
  }

  let digits = [0];

  for (
    let i = zeros;
    i < buffer.length;
    i++
  ) {
    let carry =
      buffer[i];

    for (
      let j = 0;
      j < digits.length;
      j++
    ) {
      const value =
        digits[j] * 256 +
        carry;

      digits[j] =
        value % 58;

      carry =
        Math.floor(
          value / 58
        );
    }

    while (carry > 0) {
      digits.push(
        carry % 58
      );

      carry =
        Math.floor(
          carry / 58
        );
    }
  }

  let result = "";

  for (
    let i = 0;
    i < zeros;
    i++
  ) {
    result += "1";
  }

  for (
    let i = digits.length - 1;
    i >= 0;
    i--
  ) {
    result +=
      BASE58_ALPHABET[
        digits[i]
      ];
  }

  return result;
}

async function getUsdtTransfers() {
  const endpoint =
    `/v1/contracts/${USDT_CONTRACT}/events` +
    `?event_name=Transfer` +
    `&only_confirmed=true` +
    `&limit=50` +
    `&order_by=block_timestamp,desc`;

  const data =
    await tronFetch(
      endpoint
    );

  return Array.isArray(
    data.data
  )
    ? data.data.map(
        normalizeTransfer
      )
    : [];
}

function findTransfer(
  transfers,
  txid,
  amount
) {
  const matches =
    transfers.filter(
      (transfer) =>
        String(
          transfer.txid
        ).toLowerCase() ===
          String(txid).toLowerCase() &&
        String(
          transfer.to
        ) ===
          String(DEPOSIT_ADDRESS) &&
        String(
          transfer.contract
        ).toLowerCase() ===
          String(
            USDT_CONTRACT
          ).toLowerCase() &&
        Number(
          transfer.amount
        ) ===
          Number(amount)
    );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      "Multiple matching transfers were found."
    );
  }

  return null;
}

/*
========================================================
TELEGRAM MESSAGES
========================================================
*/

async function sendTelegramMessage(
  chatId,
  text
) {
  if (
    !TELEGRAM_BOT_TOKEN ||
    !chatId
  ) {
    return false;
  }

  try {
    const response =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            chat_id:
              String(chatId),

            text,

            disable_web_page_preview:
              true
          })
        }
      );

    if (!response.ok) {
      console.error(
        "Telegram message failed:",
        await response.text()
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "Telegram message error:",
      error
    );

    return false;
  }
}

async function notifyAdmins(
  text
) {
  for (
    const adminId of
    ADMIN_TELEGRAM_IDS
  ) {
    await sendTelegramMessage(
      adminId,
      text
    );
  }
}

/*
========================================================
ROOT
========================================================
*/

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      app: "Big Money",
      network: "TRON TRC20",
      token: "USDT",
      status: "online"
    });
  }
);

/*
========================================================
CONFIG
========================================================
*/

app.get(
  "/api/config",
  (req, res) => {
    res.json({
      ok: true,

      network: "TRON",
      token: "USDT",
      standard: "TRC20",

      depositAddress:
        DEPOSIT_ADDRESS,

      telegramBotUsername:
        TELEGRAM_BOT_USERNAME
    });
  }
);

/*
========================================================
ACCOUNT
========================================================
*/

app.get(
  "/api/account/:telegramUserId",
  requireTelegram,
  (req, res) => {
    try {
      const requestedId =
        String(
          req.params.telegramUserId
        );

      const authenticatedId =
        String(
          req.telegramUser.id
        );

      if (
        requestedId !==
        authenticatedId
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "You can only access your own account."
        });
      }

      const store =
        readStore();

      const user =
        createOrUpdateUser(
          store,
          req.telegramUser
        );

      registerReferral(
        store,
        authenticatedId,
        req.telegramStartParam
      );

      writeStore(store);

      const freshUser =
        findUser(
          store,
          authenticatedId
        );

      const referral =
        getReferralInfo(
          store,
          authenticatedId
        );

      res.json({
        ok: true,

        user: {
          telegramUserId:
            freshUser.telegramUserId,

          username:
            freshUser.username,

          firstName:
            freshUser.firstName,

          lastName:
            freshUser.lastName,

          balance:
            normalizeAmount(
              freshUser.balance
            ),

          points:
            Number(
              freshUser.points || 0
            ),

          referrals:
            referral.successful,

          totalInvited:
            referral.invited,

          successfulReferrals:
            referral.successful,

          referralLink:
            referral.referralLink,

          network: "TRON TRC20",
          token: "USDT"
        },

        referral
      });
    } catch (error) {
      console.error(
        "Account error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not load account."
      });
    }
  }
);

/*
========================================================
REFERRAL
========================================================
*/

app.get(
  "/api/referral/:telegramUserId",
  requireTelegram,
  (req, res) => {
    try {
      const requestedId =
        String(
          req.params.telegramUserId
        );

      const authenticatedId =
        String(
          req.telegramUser.id
        );

      if (
        requestedId !==
        authenticatedId
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "You can only access your own referral data."
        });
      }

      const store =
        readStore();

      createOrUpdateUser(
        store,
        req.telegramUser
      );

      registerReferral(
        store,
        authenticatedId,
        req.telegramStartParam
      );

      writeStore(store);

      const referral =
        getReferralInfo(
          store,
          authenticatedId
        );

      res.json({
        ok: true,
        referral
      });
    } catch (error) {
      console.error(
        "Referral error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not load referral information."
      });
    }
  }
);

/*
========================================================
CHECK DEPOSITS
========================================================
*/

app.get(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {
    try {
      const transfers =
        await getUsdtTransfers();

      const matching =
        transfers.filter(
          (transfer) =>
            String(
              transfer.to
            ) ===
              String(
                DEPOSIT_ADDRESS
              ) &&
            String(
              transfer.contract
            ).toLowerCase() ===
              String(
                USDT_CONTRACT
              ).toLowerCase()
        );

      res.json({
        ok: true,
        deposits: matching
      });
    } catch (error) {
      console.error(
        "Deposit check error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not check blockchain."
      });
    }
  }
);

/*
========================================================
DEPOSIT REQUEST
========================================================
*/

app.post(
  "/api/deposits/request",
  requireTelegram,
  (req, res) => {
    try {
      const amount =
        normalizeAmount(
          req.body?.amount
        );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid deposit amount."
        });
      }

      const store =
        readStore();

      createOrUpdateUser(
        store,
        req.telegramUser
      );

      registerReferral(
        store,
        req.telegramUser.id,
        req.telegramStartParam
      );

      const request = {
        id:
          "DEP-" +
          Date.now() +
          "-" +
          crypto
            .randomBytes(4)
            .toString("hex"),

        telegramUserId:
          String(
            req.telegramUser.id
          ),

        amount,

        status: "waiting",

        createdAt:
          nowIso()
      };

      store.deposits.push(
        request
      );

      writeStore(store);

      res.json({
        ok: true,
        deposit: request
      });
    } catch (error) {
      console.error(
        "Deposit request error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not create deposit request."
      });
    }
  }
);

/*
========================================================
VERIFY DEPOSIT
========================================================
*/

app.post(
  "/api/deposits/verify",
  requireTelegram,
  async (req, res) => {
    try {
      const txid =
        cleanTxid(
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
            "Invalid TRON TXID."
        });
      }

      if (
        !Number.isFinite(
          requestedAmount
        ) ||
        requestedAmount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid deposit amount."
        });
      }

      const store =
        readStore();

      const user =
        createOrUpdateUser(
          store,
          req.telegramUser
        );

      registerReferral(
        store,
        req.telegramUser.id,
        req.telegramStartParam
      );

      /*
      Prevent TXID reuse.
      */

      const alreadyUsed =
        store.usedTransactions.some(
          (item) =>
            String(
              item.txid
            ).toLowerCase() ===
            txid.toLowerCase()
        );

      if (alreadyUsed) {
        return res.status(400).json({
          ok: false,
          message:
            "This TXID has already been used."
        });
      }

      /*
      Check solidified transaction.
      */

      const transaction =
        await tronFetch(
          `/walletsolidity/gettransactionbyid?value=${encodeURIComponent(
            txid
          )}`
        );

      if (
        !transaction ||
        !transaction.txID
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Transaction was not found."
        });
      }

      /*
      Check solidified transaction info.
      */

      const transactionInfo =
        await tronFetch(
          `/walletsolidity/gettransactioninfobyid?value=${encodeURIComponent(
            txid
          )}`
        );

      if (
        !transactionInfo ||
        !transactionInfo.id
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Transaction is not confirmed yet."
        });
      }

      if (
        transactionInfo.receipt &&
        transactionInfo.receipt.result &&
        transactionInfo.receipt.result !==
          "SUCCESS"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Transaction failed."
        });
      }

      /*
      Get confirmed Transfer event
      for this exact TXID.
      */

      const events =
        await tronFetch(
          `/v1/transactions/${encodeURIComponent(
            txid
          )}/events?only_confirmed=true&event_name=Transfer`
        );

      const transferEvents =
        Array.isArray(events.data)
          ? events.data
          : [];

      const transfers =
        transferEvents.map(
          normalizeTransfer
        );

      const matching =
        findTransfer(
          transfers,
          txid,
          requestedAmount
        );

      if (!matching) {
        return res.status(400).json({
          ok: false,
          message:
            "Confirmed USDT transfer not found for this TXID and amount."
        });
      }

      /*
      Verify exact official USDT contract.
      */

      if (
        String(
          matching.contract
        ).toLowerCase() !==
        String(
          USDT_CONTRACT
        ).toLowerCase()
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid USDT contract."
        });
      }

      /*
      Verify recipient.
      */

      if (
        String(
          matching.to
        ) !==
        String(
          DEPOSIT_ADDRESS
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "USDT was not sent to the Big Money deposit address."
        });
      }

      /*
      IMPORTANT:
      The current implementation verifies
      the confirmed transaction and recipient.
      It does not bind the sender wallet to
      the Telegram account.
      */

      const creditAmount =
        normalizeAmount(
          matching.amount
        );

      user.balance =
        roundNumber(
          Number(user.balance || 0) +
            creditAmount,
          6
        );

      const rewards =
        processDepositRewards(
          store,
          user,
          creditAmount
        );

      const depositRecord = {
        id:
          "DEP-" +
          Date.now() +
          "-" +
          crypto
            .randomBytes(4)
            .toString("hex"),

        telegramUserId:
          String(
            req.telegramUser.id
          ),

        txid,

        amount:
          creditAmount,

        from:
          matching.from || "",

        to:
          matching.to,

        contract:
          matching.contract,

        status:
          "confirmed",

        referralReward:
          rewards.referralReward,

        dailyReward:
          rewards.dailyReward,

        createdAt:
          nowIso()
      };

      store.deposits.push(
        depositRecord
      );

      store.usedTransactions.push({
        txid,
        telegramUserId:
          String(
            req.telegramUser.id
          ),

        amount:
          creditAmount,

        usedAt:
          nowIso()
      });

      writeStore(store);

      res.json({
        ok: true,

        message:
          "Deposit confirmed successfully.",

        credited:
          creditAmount,

        balance:
          normalizeAmount(
            user.balance
          ),

        points:
          Number(
            user.points || 0
          ),

        referralReward:
          rewards.referralReward,

        dailyReward:
          rewards.dailyReward,

        deposit:
          depositRecord
      });
    } catch (error) {
      console.error(
        "Deposit verification error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          error.message ||
          "Could not verify deposit."
      });
    }
  }
);

/*
========================================================
ADMIN TEST CREDIT
========================================================
*/

app.post(
  "/api/admin/test-credit",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    try {
      const headerKey =
        req.headers[
          "x-admin-test-key"
        ];

      const bodyKey =
        req.body?.adminTestKey ||
        req.body?.key;

      const suppliedKey =
        headerKey ||
        bodyKey ||
        "";

      if (
        !ADMIN_TEST_KEY ||
        suppliedKey !==
          ADMIN_TEST_KEY
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Invalid admin test key."
        });
      }

      const store =
        readStore();

      const user =
        createOrUpdateUser(
          store,
          req.telegramUser
        );

      /*
      Exactly 10 USDT test credit.
      No referral reward.
      No daily reward.
      */

      user.balance =
        roundNumber(
          Number(user.balance || 0) +
            10,
          6
        );

      const record = {
        id:
          "TEST-" +
          Date.now() +
          "-" +
          crypto
            .randomBytes(4)
            .toString("hex"),

        telegramUserId:
          String(
            req.telegramUser.id
          ),

        amount: 10,

        createdAt:
          nowIso()
      };

      store.testCredits.push(
        record
      );

      writeStore(store);

      res.json({
        ok: true,

        message:
          "10 USDT test credit added.",

        added: 10,

        balance:
          normalizeAmount(
            user.balance
          )
      });
    } catch (error) {
      console.error(
        "Test credit error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not add test balance."
      });
    }
  }
);

/*
========================================================
WITHDRAWAL REQUEST
========================================================
*/

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {
    try {
      const address =
        String(
          req.body?.address || ""
        ).trim();

      const amount =
        normalizeAmount(
          req.body?.amount
        );

      if (
        !isValidTronAddress(
          address
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TRON TRC20 address."
        });
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid withdrawal amount."
        });
      }

      const store =
        readStore();

      const user =
        createOrUpdateUser(
          store,
          req.telegramUser
        );

      if (
        Number(user.balance || 0) <
        amount
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Insufficient balance."
        });
      }

      /*
      Reserve/deduct balance immediately.
      If admin rejects the request, balance
      is returned.
      */

      user.balance =
        roundNumber(
          Number(user.balance || 0) -
            amount,
          6
        );

      const withdrawal = {
        id:
          "WD-" +
          Date.now() +
          "-" +
          crypto
            .randomBytes(4)
            .toString("hex"),

        telegramUserId:
          String(
            req.telegramUser.id
          ),

        username:
          req.telegramUser.username ||
          "",

        amount,

        address,

        status:
          "pending",

        paymentTxid:
          "",

        reason:
          "",

        createdAt:
          nowIso(),

        updatedAt:
          nowIso()
      };

      store.withdrawals.push(
        withdrawal
      );

      writeStore(store);

      await notifyAdmins(
        [
          "💸 Big Money Withdrawal Request",
          "",
          `ID: ${withdrawal.id}`,
          `User ID: ${withdrawal.telegramUserId}`,
          `Username: @${withdrawal.username || "none"}`,
          `Amount: ${withdrawal.amount} USDT`,
          `Address: ${withdrawal.address}`,
          "",
          "Status: PENDING"
        ].join("\n")
      );

      res.json({
        ok: true,

        message:
          "Withdrawal request submitted.",

        withdrawalId:
          withdrawal.id,

        withdrawal
      });
    } catch (error) {
      console.error(
        "Withdrawal request error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not create withdrawal request."
      });
    }
  }
);

/*
========================================================
USER WITHDRAWAL HISTORY
========================================================
*/

app.get(
  "/api/withdrawals/me",
  requireTelegram,
  (req, res) => {
    try {
      const store =
        readStore();

      const userId =
        String(
          req.telegramUser.id
        );

      const withdrawals =
        store.withdrawals
          .filter(
            (withdrawal) =>
              String(
                withdrawal.telegramUserId
              ) === userId
          )
          .sort(
            (a, b) =>
              new Date(
                b.createdAt || 0
              ) -
              new Date(
                a.createdAt || 0
              )
          );

      res.json({
        ok: true,
        withdrawals
      });
    } catch (error) {
      console.error(
        "Withdrawal history error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not load withdrawal history."
      });
    }
  }
);

/*
========================================================
ADMIN - VIEW WITHDRAWALS
========================================================
*/

app.get(
  "/api/admin/withdrawals",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    try {
      const store =
        readStore();

      const withdrawals =
        [...store.withdrawals]
          .sort(
            (a, b) =>
              new Date(
                b.createdAt || 0
              ) -
              new Date(
                a.createdAt || 0
              )
          );

      res.json({
        ok: true,
        withdrawals
      });
    } catch (error) {
      console.error(
        "Admin withdrawal list error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not load withdrawal requests."
      });
    }
  }
);

/*
========================================================
ADMIN - APPROVE WITHDRAWAL
========================================================
*/

app.post(
  "/api/admin/withdrawals/:withdrawalId/approve",
  requireTelegram,
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        String(
          req.params.withdrawalId
        );

      const store =
        readStore();

      const withdrawal =
        store.withdrawals.find(
          (item) =>
            String(item.id) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Only pending withdrawals can be approved."
        });
      }

      const paymentTxid =
        cleanTxid(
          req.body?.paymentTxid
        );

      if (
        paymentTxid &&
        !isValidTxid(paymentTxid)
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid payment TXID."
        });
      }

      withdrawal.status =
        "approved";

      if (paymentTxid) {
        withdrawal.paymentTxid =
          paymentTxid;
      }

      withdrawal.updatedAt =
        nowIso();

      writeStore(store);

      await sendTelegramMessage(
        withdrawal.telegramUserId,
        [
          "✅ Big Money Withdrawal Update",
          "",
          `Amount: ${withdrawal.amount} USDT`,
          `Status: APPROVED`,
          "",
          paymentTxid
            ? `Payment TXID: ${paymentTxid}`
            : "Payment TXID: Not added yet.",
          "",
          "Please check your withdrawal history."
        ].join("\n")
      );

      res.json({
        ok: true,

        message:
          "Withdrawal approved.",

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
          "Could not approve withdrawal."
      });
    }
  }
);

/*
========================================================
ADMIN - REJECT WITHDRAWAL
========================================================
*/

app.post(
  "/api/admin/withdrawals/:withdrawalId/reject",
  requireTelegram,
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        String(
          req.params.withdrawalId
        );

      const reason =
        String(
          req.body?.reason ||
            "Withdrawal rejected by admin."
        ).trim();

      const store =
        readStore();

      const withdrawal =
        store.withdrawals.find(
          (item) =>
            String(item.id) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Only pending withdrawals can be rejected."
        });
      }

      const user =
        findUser(
          store,
          withdrawal.telegramUserId
        );

      /*
      Return reserved balance.
      */

      if (user) {
        user.balance =
          roundNumber(
            Number(user.balance || 0) +
              Number(
                withdrawal.amount || 0
              ),
            6
          );

        user.updatedAt =
          nowIso();
      }

      withdrawal.status =
        "rejected";

      withdrawal.reason =
        reason;

      withdrawal.updatedAt =
        nowIso();

      writeStore(store);

      await sendTelegramMessage(
        withdrawal.telegramUserId,
        [
          "❌ Big Money Withdrawal Update",
          "",
          `Amount: ${withdrawal.amount} USDT`,
          "Status: REJECTED",
          "",
          `Reason: ${reason}`,
          "",
          "The amount has been returned to your Big Money balance."
        ].join("\n")
      );

      res.json({
        ok: true,

        message:
          "Withdrawal rejected.",

        withdrawal
      });
    } catch (error) {
      console.error(
        "Reject withdrawal error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not reject withdrawal."
      });
    }
  }
);

/*
========================================================
ADMIN - ADD PAYMENT TXID
========================================================
*/

app.post(
  "/api/admin/withdrawals/:withdrawalId/txid",
  requireTelegram,
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        String(
          req.params.withdrawalId
        );

      const paymentTxid =
        cleanTxid(
          req.body?.paymentTxid ||
            req.body?.txid
        );

      if (
        !isValidTxid(
          paymentTxid
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid payment TXID."
        });
      }

      const store =
        readStore();

      const withdrawal =
        store.withdrawals.find(
          (item) =>
            String(item.id) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      withdrawal.paymentTxid =
        paymentTxid;

      /*
      If admin adds a payment TXID,
      mark it approved.
      */

      if (
        withdrawal.status ===
        "pending"
      ) {
        withdrawal.status =
          "approved";
      }

      withdrawal.updatedAt =
        nowIso();

      writeStore(store);

      await sendTelegramMessage(
        withdrawal.telegramUserId,
        [
          "💸 Big Money Payment Update",
          "",
          `Amount: ${withdrawal.amount} USDT`,
          "Status: PAID / TXID ADDED",
          "",
          `Payment TXID: ${paymentTxid}`,
          "",
          "Please check your withdrawal history."
        ].join("\n")
      );

      res.json({
        ok: true,

        message:
          "Payment TXID saved.",

        withdrawal
      });
    } catch (error) {
      console.error(
        "Payment TXID error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not save payment TXID."
      });
    }
  }
);

/*
========================================================
ADMIN - USERS
========================================================
*/

app.get(
  "/api/admin/users",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    try {
      const store =
        readStore();

      const users =
        store.users.map(
          (user) => ({
            telegramUserId:
              user.telegramUserId,

            username:
              user.username,

            firstName:
              user.firstName,

            balance:
              normalizeAmount(
                user.balance
              ),

            points:
              Number(
                user.points || 0
              ),

            referredBy:
              user.referredBy,

            referralRewarded:
              !!user.referralRewarded,

            lastDailyRewardDate:
              user.lastDailyRewardDate,

            createdAt:
              user.createdAt
          })
        );

      res.json({
        ok: true,
        users
      });
    } catch (error) {
      console.error(
        "Admin users error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not load users."
      });
    }
  }
);

/*
========================================================
404
========================================================
*/

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      message:
        "Endpoint not found."
    });
  }
);

/*
========================================================
ERROR HANDLER
========================================================
*/

app.use(
  (error, req, res, next) => {
    console.error(
      "Unhandled server error:",
      error
    );

    res.status(500).json({
      ok: false,
      message:
        "Internal server error."
    });
  }
);

/*
========================================================
START SERVER
========================================================
*/

ensureStore();

app.listen(
  PORT,
  () => {
    console.log(
      `Big Money server running on port ${PORT}`
    );

    console.log(
      `Deposit address: ${DEPOSIT_ADDRESS}`
    );

    console.log(
      `USDT contract: ${USDT_CONTRACT}`
    );

    console.log(
      `Telegram bot: @${TELEGRAM_BOT_USERNAME}`
    );

    console.log(
      `Admins configured: ${ADMIN_TELEGRAM_IDS.length}`
    );
  }
);

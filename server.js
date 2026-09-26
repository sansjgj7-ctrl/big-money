// ============================================================
// 💚 BIG MONEY - BACKEND
// Telegram Mini App + USDT TRC20
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

const ADMIN_KEY =
  process.env.ADMIN_KEY ||
  process.env.ADMIN_SECRET ||
  "";

const TRONGRID_API_KEY =
  process.env.TRON_PRO_API_KEY ||
  process.env.TRONGRID_API_KEY ||
  "";

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL =
  process.env.TRONGRID_URL ||
  "https://api.trongrid.io";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const USDT_DECIMALS = 6;

// Referral reward
const REFERRAL_REWARD_POINTS = 3;

// Daily reward
const DAILY_REWARD_POINTS = 0.5;

// Minimum deposit for rewards/referral qualification
const QUALIFYING_DEPOSIT = 10;

// Withdrawal requires successful referrals
const REQUIRED_REFERRALS = 5;

// Telegram auth validity
const TELEGRAM_AUTH_MAX_AGE =
  24 * 60 * 60;

// ============================================================
// CORS
// ============================================================

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Admin-Test-Key",
      "X-Telegram-Init-Data"
    ]
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

// ============================================================
// DATABASE
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(
  DATA_DIR,
  "big-money-data.json"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function defaultDB() {
  return {
    users: [],
    deposits: [],
    withdrawals: [],
    usedTransactions: [],
    testCredits: []
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const db = defaultDB();
      fs.writeFileSync(
        DB_FILE,
        JSON.stringify(db, null, 2)
      );
      return db;
    }

    const raw = fs.readFileSync(
      DB_FILE,
      "utf8"
    );

    const db = JSON.parse(raw);

    return {
      users: Array.isArray(db.users)
        ? db.users
        : [],
      deposits: Array.isArray(db.deposits)
        ? db.deposits
        : [],
      withdrawals: Array.isArray(db.withdrawals)
        ? db.withdrawals
        : [],
      usedTransactions: Array.isArray(
        db.usedTransactions
      )
        ? db.usedTransactions
        : [],
      testCredits: Array.isArray(db.testCredits)
        ? db.testCredits
        : []
    };
  } catch (err) {
    console.error(
      "Database load error:",
      err
    );

    return defaultDB();
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

// ============================================================
// HELPERS
// ============================================================

function nowISO() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto
      .randomBytes(5)
      .toString("hex")
  );
}

function roundNumber(value, decimals = 6) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  const factor = Math.pow(10, decimals);

  return (
    Math.round((n + Number.EPSILON) * factor) /
    factor
  );
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function sameAddress(a, b) {
  return (
    normalizeAddress(a).toLowerCase() ===
    normalizeAddress(b).toLowerCase()
  );
}

// ============================================================
// KABUL DAY
// ============================================================

function kabulDateString(date = new Date()) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Kabul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(date);
}

// ============================================================
// USER
// ============================================================

function ensureUser(telegramUser) {
  const id = String(
    telegramUser.id
  );

  let user = db.users.find(
    u => String(u.id) === id
  );

  if (!user) {
    user = {
      id,
      telegramId: id,
      username:
        telegramUser.username ||
        "",
      firstName:
        telegramUser.first_name ||
        "",
      lastName:
        telegramUser.last_name ||
        "",
      balance: 0,
      points: 0,
      referrals: 0,
      successfulReferrals: 0,
      referredBy: null,
      referralRewardGiven: false,
      dailyRewards: [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    db.users.push(user);
    saveDB();
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

    user.updatedAt = nowISO();
  }

  return user;
}

// ============================================================
// TELEGRAM WEBAPP AUTH
// ============================================================

function parseTelegramInitData(initData) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    throw new Error(
      "Telegram authentication data is missing."
    );
  }

  const params = new URLSearchParams(
    initData
  );

  const hash = params.get("hash");

  if (!hash) {
    throw new Error(
      "Telegram authentication hash is missing."
    );
  }

  const data = [];

  for (const [key, value] of params.entries()) {
    if (key === "hash") {
      continue;
    }

    data.push(`${key}=${value}`);
  }

  data.sort();

  const dataCheckString =
    data.join("\n");

  const secretKey = crypto
    .createHmac(
      "sha256",
      "WebAppData"
    )
    .update(TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(dataCheckString)
      .digest("hex");

  const provided =
    Buffer.from(hash, "hex");

  const calculated =
    Buffer.from(
      calculatedHash,
      "hex"
    );

  if (
    provided.length !==
    calculated.length ||
    !crypto.timingSafeEqual(
      provided,
      calculated
    )
  ) {
    throw new Error(
      "Invalid Telegram authentication."
    );
  }

  const authDate =
    Number(params.get("auth_date"));

  if (
    !Number.isFinite(authDate)
  ) {
    throw new Error(
      "Telegram auth_date is missing."
    );
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (
    age < 0 ||
    age > TELEGRAM_AUTH_MAX_AGE
  ) {
    throw new Error(
      "Telegram authentication has expired."
    );
  }

  const userJSON =
    params.get("user");

  if (!userJSON) {
    throw new Error(
      "Telegram user information is missing."
    );
  }

  let telegramUser;

  try {
    telegramUser =
      JSON.parse(userJSON);
  } catch {
    throw new Error(
      "Invalid Telegram user data."
    );
  }

  if (
    !telegramUser ||
    !telegramUser.id
  ) {
    throw new Error(
      "Invalid Telegram user."
    );
  }

  return {
    user: telegramUser,
    startParam:
      params.get("start_param") ||
      ""
  };
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function telegramAuth(
  req,
  res,
  next
) {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(500).json({
        ok: false,
        message:
          "TELEGRAM_BOT_TOKEN is not configured."
      });
    }

    const initData =
      req.headers[
        "x-telegram-init-data"
      ];

    const auth =
      parseTelegramInitData(
        initData
      );

    req.telegramUser =
      auth.user;

    req.startParam =
      auth.startParam;

    req.appUser =
      ensureUser(auth.user);

    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message:
        err.message ||
        "Telegram authentication failed."
    });
  }
}

// ============================================================
// REFERRAL REGISTRATION
// ============================================================

function registerReferral(
  user,
  startParam
) {
  if (!startParam) {
    return false;
  }

  const match =
    String(startParam).match(
      /^ref_(\d+)$/
    );

  if (!match) {
    return false;
  }

  const referrerId =
    String(match[1]);

  const userId =
    String(user.id);

  if (
    referrerId === userId
  ) {
    return false;
  }

  if (user.referredBy) {
    return false;
  }

  const referrer =
    db.users.find(
      u =>
        String(u.id) ===
        referrerId
    );

  if (!referrer) {
    return false;
  }

  user.referredBy =
    referrerId;

  referrer.referrals =
    Number(referrer.referrals || 0) +
    1;

  saveDB();

  return true;
}

// ============================================================
// REFERRAL REWARD
// ============================================================

function applyReferralReward(
  referredUser
) {
  if (
    !referredUser.referredBy
  ) {
    return false;
  }

  if (
    referredUser.referralRewardGiven
  ) {
    return false;
  }

  const referrer =
    db.users.find(
      u =>
        String(u.id) ===
        String(referredUser.referredBy)
    );

  if (!referrer) {
    return false;
  }

  referrer.points =
    roundNumber(
      Number(referrer.points || 0) +
        REFERRAL_REWARD_POINTS,
      2
    );

  referrer.successfulReferrals =
    Number(
      referrer.successfulReferrals || 0
    ) + 1;

  referredUser.referralRewardGiven =
    true;

  saveDB();

  return true;
}

// ============================================================
// DAILY REWARD
// ============================================================

function applyDailyReward(
  user
) {
  if (!Array.isArray(user.dailyRewards)) {
    user.dailyRewards = [];
  }

  const today =
    kabulDateString();

  if (
    user.dailyRewards.includes(today)
  ) {
    return false;
  }

  user.points =
    roundNumber(
      Number(user.points || 0) +
        DAILY_REWARD_POINTS,
      2
    );

  user.dailyRewards.push(
    today
  );

  saveDB();

  return true;
}

// ============================================================
// TRON / TRONGRID
// ============================================================

function tronHeaders() {
  const headers = {
    "Content-Type":
      "application/json"
  };

  if (TRONGRID_API_KEY) {
    headers[
      "TRON-PRO-API-KEY"
    ] = TRONGRID_API_KEY;
  }

  return headers;
}

async function tronFetch(
  url,
  options = {},
  retries = 2
) {
  let lastError;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const response =
        await fetch(url, {
          ...options,
          headers: {
            ...tronHeaders(),
            ...(options.headers || {})
          }
        });

      const text =
        await response.text();

      if (
        response.status === 429 &&
        attempt < retries
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1000 *
                (attempt + 1)
            )
        );

        continue;
      }

      if (!response.ok) {
        throw new Error(
          `TronGrid error ${response.status}: ${text}`
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          "Invalid TronGrid response."
        );
      }
    } catch (err) {
      lastError = err;

      if (attempt < retries) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              800 *
                (attempt + 1)
            )
        );
      }
    }
  }

  throw lastError;
}

// ============================================================
// BASE58 / TRON ADDRESS HELPERS
// ============================================================

const BASE58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str) {
  let num = 0n;

  for (const char of str) {
    const index =
      BASE58.indexOf(char);

    if (index < 0) {
      throw new Error(
        "Invalid Base58 character."
      );
    }

    num =
      num * 58n +
      BigInt(index);
  }

  let hex =
    num.toString(16);

  if (hex.length % 2) {
    hex = "0" + hex;
  }

  let leadingZeroes = 0;

  for (
    let i = 0;
    i < str.length &&
    str[i] === "1";
    i++
  ) {
    leadingZeroes++;
  }

  return (
    "00".repeat(
      leadingZeroes
    ) + hex
  );
}

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest();
}

function tronAddressToHex(address) {
  const decoded =
    Buffer.from(
      base58Decode(address),
      "hex"
    );

  if (decoded.length !== 25) {
    throw new Error(
      "Invalid TRON address."
    );
  }

  const payload =
    decoded.subarray(0, 21);

  const checksum =
    decoded.subarray(21);

  const calculated =
    sha256(
      sha256(payload)
    ).subarray(0, 4);

  if (
    !calculated.equals(checksum)
  ) {
    throw new Error(
      "Invalid TRON address checksum."
    );
  }

  return payload.toString(
    "hex"
  );
}

function tronHexToBase58(hex) {
  let clean =
    String(hex || "")
      .replace(/^0x/, "")
      .toLowerCase();

  if (
    clean.length % 2 !== 0
  ) {
    clean = "0" + clean;
  }

  const payload =
    Buffer.from(
      clean,
      "hex"
    );

  const checksum =
    sha256(
      sha256(payload)
    ).subarray(0, 4);

  const full =
    Buffer.concat([
      payload,
      checksum
    ]);

  let num = 0n;

  for (const byte of full) {
    num =
      num * 256n +
      BigInt(byte);
  }

  let result = "";

  while (num > 0n) {
    const remainder =
      Number(num % 58n);

    result =
      BASE58[remainder] +
      result;

    num /= 58n;
  }

  for (
    let i = 0;
    i < full.length &&
    full[i] === 0;
    i++
  ) {
    result =
      "1" + result;
  }

  return result;
}

// ============================================================
// TRON TRANSACTION
// ============================================================

async function getSolidTransaction(
  txid
) {
  const data =
    await tronFetch(
      `${TRONGRID_URL}/walletsolidity/gettransactionbyid`,
      {
        method: "POST",
        body: JSON.stringify({
          value: txid
        })
      }
    );

  return data;
}

async function getSolidTransactionInfo(
  txid
) {
  const data =
    await tronFetch(
      `${TRONGRID_URL}/walletsolidity/gettransactioninfobyid`,
      {
        method: "POST",
        body: JSON.stringify({
          value: txid
        })
      }
    );

  return data;
}

// ============================================================
// DECODE TRC20 TRANSFER
// ============================================================

function decodeTRC20Transfer(
  transaction
) {
  try {
    const contracts =
      transaction?.raw_data
        ?.contract;

    if (
      !Array.isArray(contracts) ||
      contracts.length === 0
    ) {
      return null;
    }

    const contract =
      contracts[0];

    if (
      contract.type !==
      "TriggerSmartContract"
    ) {
      return null;
    }

    const value =
      contract.parameter?.value;

    if (!value) {
      return null;
    }

    const contractAddressHex =
      value.contract_address;

    const ownerAddressHex =
      value.owner_address;

    const data =
      String(value.data || "")
        .toLowerCase();

    // transfer(address,uint256)
    if (
      !data.startsWith(
        "a9059cbb"
      )
    ) {
      return null;
    }

    if (data.length < 136) {
      return null;
    }

    const toWord =
      data.slice(
        8,
        72
      );

    const amountWord =
      data.slice(
        72,
        136
      );

    const toHex =
      "41" +
      toWord.slice(-40);

    const to =
      tronHexToBase58(
        toHex
      );

    const from =
      tronHexToBase58(
        ownerAddressHex
      );

    const amountRaw =
      BigInt(
        "0x" +
          amountWord
      );

    return {
      from,
      to,
      amountRaw,
      amount:
        Number(amountRaw) /
        Math.pow(
          10,
          USDT_DECIMALS
        ),
      contractHex:
        contractAddressHex
          .toLowerCase()
          .replace(/^41/, "")
    };
  } catch (err) {
    console.error(
      "TRC20 decode error:",
      err.message
    );

    return null;
  }
}

// ============================================================
// CONFIRMED EVENT LOOKUP
// ============================================================

async function getConfirmedTransferEvents(
  txid
) {
  const url =
    `${TRONGRID_URL}/v1/transactions/${txid}/events` +
    `?only_confirmed=true&event_name=Transfer`;

  const data =
    await tronFetch(url);

  return Array.isArray(data.data)
    ? data.data
    : [];
}

// ============================================================
// FIND EXACT CONFIRMED USDT TRANSFER
// ============================================================

async function findConfirmedUSDTTransfer(
  txid
) {
  // ----------------------------------------------------------
  // STEP 1: solid transaction
  // ----------------------------------------------------------

  const tx =
    await getSolidTransaction(
      txid
    );

  if (
    !tx ||
    tx.txID !== txid
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // STEP 2: solid receipt
  // ----------------------------------------------------------

  const info =
    await getSolidTransactionInfo(
      txid
    );

  if (!info) {
    return null;
  }

  if (
    info.receipt &&
    info.receipt.result &&
    info.receipt.result !==
      "SUCCESS"
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // STEP 3: decode transaction directly
  // ----------------------------------------------------------

  const decoded =
    decodeTRC20Transfer(tx);

  if (
    decoded &&
    sameAddress(
      decoded.to,
      DEPOSIT_ADDRESS
    )
  ) {
    let usdtContractHex;

    try {
      usdtContractHex =
        tronAddressToHex(
          USDT_CONTRACT
        )
          .replace(/^41/, "")
          .toLowerCase();
    } catch {
      usdtContractHex =
        "";
    }

    if (
      decoded.contractHex ===
      usdtContractHex
    ) {
      return {
        txid,
        from: decoded.from,
        to: decoded.to,
        amount:
          decoded.amount,
        amountRaw:
          decoded.amountRaw.toString(),
        source:
          "solid_transaction"
      };
    }
  }

  // ----------------------------------------------------------
  // STEP 4: fallback to Transfer event
  // ----------------------------------------------------------

  try {
    const events =
      await getConfirmedTransferEvents(
        txid
      );

    const matches =
      events.filter(
        event => {
          const result =
            event.result || {};

          const to =
            result.to ||
            event.to ||
            "";

          const value =
            result.value ??
            event.value ??
            null;

          const contract =
            event.contract_address ||
            event.contractAddress ||
            "";

          return (
            sameAddress(
              to,
              DEPOSIT_ADDRESS
            ) &&
            (
              contract ===
              USDT_CONTRACT ||
              contract.toLowerCase() ===
              USDT_CONTRACT.toLowerCase()
            ) &&
            value !== null
          );
        }
      );

    if (
      matches.length === 1
    ) {
      const event =
        matches[0];

      const result =
        event.result || {};

      const rawValue =
        result.value ??
        event.value;

      const amount =
        Number(rawValue) /
        Math.pow(
          10,
          USDT_DECIMALS
        );

      return {
        txid,
        from:
          result.from ||
          event.from ||
          "",
        to:
          result.to ||
          event.to ||
          DEPOSIT_ADDRESS,
        amount,
        amountRaw:
          String(rawValue),
        source:
          "confirmed_event"
      };
    }

    if (
      matches.length > 1
    ) {
      throw new Error(
        "Multiple matching USDT transfers found."
      );
    }
  } catch (err) {
    console.error(
      "Event fallback error:",
      err.message
    );
  }

  return null;
}

// ============================================================
// RATE LIMIT
// ============================================================

const rateMap =
  new Map();

function rateLimit(
  req,
  res,
  next
) {
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"] ||
    "unknown";

  const now =
    Date.now();

  const current =
    rateMap.get(ip);

  if (!current) {
    rateMap.set(ip, {
      count: 1,
      time: now
    });

    return next();
  }

  if (
    now - current.time >
    60 * 1000
  ) {
    rateMap.set(ip, {
      count: 1,
      time: now
    });

    return next();
  }

  current.count++;

  if (current.count > 60) {
    return res.status(429).json({
      ok: false,
      message:
        "Too many requests. Please try again later."
    });
  }

  next();
}

app.use(rateLimit);

// ============================================================
// HOME
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      name: "Big Money",
      network: "TRON TRC20",
      token: "USDT",
      standard: "TRC20",
      depositAddress:
        DEPOSIT_ADDRESS
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "Big Money",
      time: nowISO()
    });
  }
);

// ============================================================
// CONFIG
// ============================================================

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
      botUsername:
        TELEGRAM_BOT_USERNAME,
      referralRewardPoints:
        REFERRAL_REWARD_POINTS,
      dailyRewardPoints:
        DAILY_REWARD_POINTS,
      qualifyingDeposit:
        QUALIFYING_DEPOSIT,
      requiredReferrals:
        REQUIRED_REFERRALS
    });
  }
);

// ============================================================
// ACCOUNT
// ============================================================

app.post(
  "/api/account",
  telegramAuth,
  (req, res) => {
    try {
      const user =
        req.appUser;

      registerReferral(
        user,
        req.startParam
      );

      const successfulReferrals =
        Number(
          user.successfulReferrals ||
            0
        );

      res.json({
        ok: true,
        user: {
          id: user.id,
          username:
            user.username,
          firstName:
            user.firstName,
          lastName:
            user.lastName,
          balance:
            roundNumber(
              user.balance,
              6
            ),
          points:
            roundNumber(
              user.points,
              2
            ),
          referrals:
            Number(
              user.referrals || 0
            ),
          successfulReferrals,
          requiredReferrals:
            REQUIRED_REFERRALS,
          referralLink:
            `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${user.id}`,
          network:
            "TRON TRC20"
        }
      });
    } catch (err) {
      console.error(
        "Account error:",
        err
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not load account."
      });
    }
  }
);

// Also support GET account route
app.get(
  "/api/account/:telegramUserId",
  telegramAuth,
  (req, res) => {
    try {
      if (
        String(
          req.params.telegramUserId
        ) !==
        String(
          req.telegramUser.id
        )
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "User ID does not match Telegram account."
        });
      }

      const user =
        req.appUser;

      registerReferral(
        user,
        req.startParam
      );

      res.json({
        ok: true,
        user: {
          id: user.id,
          username:
            user.username,
          firstName:
            user.firstName,
          lastName:
            user.lastName,
          balance:
            roundNumber(
              user.balance,
              6
            ),
          points:
            roundNumber(
              user.points,
              2
            ),
          referrals:
            Number(
              user.referrals || 0
            ),
          successfulReferrals:
            Number(
              user.successfulReferrals ||
                0
            ),
          requiredReferrals:
            REQUIRED_REFERRALS,
          referralLink:
            `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${user.id}`,
          network:
            "TRON TRC20"
        }
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not load account."
      });
    }
  }
);

// ============================================================
// REFERRAL
// ============================================================

app.get(
  "/api/referral/:telegramUserId",
  telegramAuth,
  (req, res) => {
    try {
      if (
        String(
          req.params.telegramUserId
        ) !==
        String(
          req.telegramUser.id
        )
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "User ID does not match Telegram account."
        });
      }

      const user =
        req.appUser;

      registerReferral(
        user,
        req.startParam
      );

      const successful =
        Number(
          user.successfulReferrals ||
            0
        );

      res.json({
        ok: true,
        referralLink:
          `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${user.id}`,
        referrals:
          Number(
            user.referrals || 0
          ),
        successfulReferrals:
          successful,
        requiredReferrals:
          REQUIRED_REFERRALS,
        points:
          roundNumber(
            user.points,
            2
          )
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not load referral data."
      });
    }
  }
);

// ============================================================
// DEPOSIT CHECK
// ============================================================

app.get(
  "/api/deposits/check",
  telegramAuth,
  async (req, res) => {
    try {
      const url =
        `${TRONGRID_URL}/v1/accounts/${DEPOSIT_ADDRESS}/transactions/trc20` +
        `?limit=50` +
        `&contract_address=${USDT_CONTRACT}` +
        `&only_confirmed=true` +
        `&only_to=true`;

      const data =
        await tronFetch(url);

      const transfers =
        Array.isArray(data.data)
          ? data.data
          : [];

      const cleaned =
        transfers.map(
          item => ({
            txid:
              item.transaction_id,
            from:
              item.from,
            to:
              item.to,
            amount:
              Number(
                item.value
              ) /
              Math.pow(
                10,
                USDT_DECIMALS
              ),
            token:
              item.token_info?.symbol ||
              "USDT",
            confirmed:
              true,
            timestamp:
              item.block_timestamp
          })
        );

      res.json({
        ok: true,
        transfers: cleaned
      });
    } catch (err) {
      console.error(
        "Deposit check error:",
        err
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not check TRON blockchain right now."
      });
    }
  }
);

// ============================================================
// DEPOSIT REQUEST
// ============================================================

app.post(
  "/api/deposits/request",
  telegramAuth,
  (req, res) => {
    try {
      const amount =
        Number(req.body?.amount);

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

      const request = {
        id: randomId("dep_req"),
        telegramUserId:
          String(
            req.telegramUser.id
          ),
        amount:
          roundNumber(
            amount,
            6
          ),
        status:
          "waiting_txid",
        createdAt:
          nowISO()
      };

      db.deposits.push(
        request
      );

      saveDB();

      res.json({
        ok: true,
        request
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not create deposit request."
      });
    }
  }
);

// ============================================================
// DEPOSIT VERIFY
// ============================================================

app.post(
  "/api/deposits/verify",
  telegramAuth,
  async (req, res) => {
    try {
      const user =
        req.appUser;

      registerReferral(
        user,
        req.startParam
      );

      const txid =
        String(
          req.body?.txid ||
            ""
        )
          .trim()
          .toLowerCase();

      const amount =
        Number(
          req.body?.amount
        );

      // ------------------------------------------------------
      // TXID validation
      // ------------------------------------------------------

      if (
        !/^[a-f0-9]{64}$/i.test(
          txid
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TRON TXID. TXID must contain 64 hexadecimal characters."
        });
      }

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

      // ------------------------------------------------------
      // Check duplicate
      // ------------------------------------------------------

      const existing =
        db.usedTransactions.find(
          x =>
            String(x.txid).toLowerCase() ===
            txid
        );

      if (existing) {
        return res.status(400).json({
          ok: false,
          message:
            "This TXID has already been used."
        });
      }

      // ------------------------------------------------------
      // Find confirmed USDT transfer
      // ------------------------------------------------------

      let transfer;

      try {
        transfer =
          await findConfirmedUSDTTransfer(
            txid
          );
      } catch (err) {
        console.error(
          "Blockchain verification error:",
          err
        );

        if (
          String(
            err.message || ""
          ).includes("429")
        ) {
          return res.status(429).json({
            ok: false,
            message:
              "TRON network service is busy. Please wait 20-30 seconds and try again."
          });
        }

        return res.status(502).json({
          ok: false,
          message:
            "Could not verify the transaction on TRON right now."
        });
      }

      if (!transfer) {
        return res.status(400).json({
          ok: false,
          message:
            "No confirmed USDT TRC20 transfer to the Big Money deposit address was found for this TXID."
        });
      }

      // ------------------------------------------------------
      // Exact recipient
      // ------------------------------------------------------

      if (
        !sameAddress(
          transfer.to,
          DEPOSIT_ADDRESS
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "This transaction was not sent to the Big Money deposit address."
        });
      }

      // ------------------------------------------------------
      // Exact amount
      // ------------------------------------------------------

      const receivedAmount =
        roundNumber(
          Number(
            transfer.amount
          ),
          6
        );

      if (
        !Number.isFinite(
          receivedAmount
        ) ||
        receivedAmount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid USDT amount found on blockchain."
        });
      }

      if (
        Math.abs(
          receivedAmount -
            amount
        ) >
        0.000001
      ) {
        return res.status(400).json({
          ok: false,
          message:
            `Amount mismatch. Blockchain received ${receivedAmount} USDT, but you entered ${amount} USDT.`
        });
      }

      // ------------------------------------------------------
      // CREDIT USER
      // ------------------------------------------------------

      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) +
            receivedAmount,
          6
        );

      // ------------------------------------------------------
      // SAVE USED TXID FIRST
      // ------------------------------------------------------

      db.usedTransactions.push({
        txid,
        telegramUserId:
          String(
            user.id
          ),
        amount:
          receivedAmount,
        from:
          transfer.from || "",
        to:
          DEPOSIT_ADDRESS,
        source:
          transfer.source,
        createdAt:
          nowISO()
      });

      // ------------------------------------------------------
      // DEPOSIT RECORD
      // ------------------------------------------------------

      db.deposits.push({
        id:
          randomId("deposit"),
        telegramUserId:
          String(
            user.id
          ),
        txid,
        amount:
          receivedAmount,
        from:
          transfer.from || "",
        to:
          DEPOSIT_ADDRESS,
        status:
          "confirmed",
        source:
          transfer.source,
        createdAt:
          nowISO()
      });

      saveDB();

      // ------------------------------------------------------
      // REWARDS
      // ------------------------------------------------------

      let referralReward =
        false;

      let dailyReward =
        false;

      if (
        receivedAmount >=
        QUALIFYING_DEPOSIT
      ) {
        referralReward =
          applyReferralReward(
            user
          );

        dailyReward =
          applyDailyReward(
            user
          );
      }

      saveDB();

      // ------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------

      res.json({
        ok: true,
        message:
          "Deposit verified successfully.",
        txid,
        amount:
          receivedAmount,
        balance:
          roundNumber(
            user.balance,
            6
          ),
        points:
          roundNumber(
            user.points,
            2
          ),
        referralReward,
        dailyReward,
        successfulReferrals:
          Number(
            user.successfulReferrals ||
              0
          )
      });
    } catch (err) {
      console.error(
        "Deposit verify error:",
        err
      );

      res.status(500).json({
        ok: false,
        message:
          "Deposit verification failed."
      });
    }
  }
);

// ============================================================
// WITHDRAWAL REQUEST
// ============================================================

app.post(
  "/api/withdrawals/request",
  telegramAuth,
  (req, res) => {
    try {
      const user =
        req.appUser;

      const address =
        String(
          req.body?.address ||
            ""
        ).trim();

      const amount =
        Number(
          req.body?.amount
        );

      // ------------------------------------------------------
      // Address
      // ------------------------------------------------------

      if (
        !/^T[a-zA-Z0-9]{33}$/.test(
          address
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TRON USDT address."
        });
      }

      // ------------------------------------------------------
      // Amount
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Referral requirement
      // ------------------------------------------------------

      const successful =
        Number(
          user.successfulReferrals ||
            0
        );

      if (
        successful <
        REQUIRED_REFERRALS
      ) {
        return res.status(400).json({
          ok: false,
          message:
            `You need ${REQUIRED_REFERRALS} successful referrals before requesting a withdrawal. You currently have ${successful}.`
        });
      }

      // ------------------------------------------------------
      // Balance
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Deduct immediately
      // ------------------------------------------------------

      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) - amount,
          6
        );

      const withdrawal = {
        id:
          randomId("withdrawal"),
        telegramUserId:
          String(
            user.id
          ),
        username:
          user.username || "",
        address,
        amount:
          roundNumber(
            amount,
            6
          ),
        status:
          "pending",
        paymentTxid:
          "",
        createdAt:
          nowISO(),
        updatedAt:
          nowISO()
      };

      db.withdrawals.push(
        withdrawal
      );

      saveDB();

      res.json({
        ok: true,
        message:
          "Withdrawal request submitted. Waiting for admin approval.",
        withdrawalId:
          withdrawal.id,
        status:
          withdrawal.status,
        balance:
          user.balance
      });
    } catch (err) {
      console.error(
        "Withdrawal request error:",
        err
      );

      res.status(500).json({
        ok: false,
        message:
          "Could not create withdrawal request."
      });
    }
  }
);

// ============================================================
// MY WITHDRAWALS
// ============================================================

app.get(
  "/api/withdrawals/me",
  telegramAuth,
  (req, res) => {
    try {
      const withdrawals =
        db.withdrawals
          .filter(
            w =>
              String(
                w.telegramUserId
              ) ===
              String(
                req.telegramUser.id
              )
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt) -
              new Date(a.createdAt)
          );

      res.json({
        ok: true,
        withdrawals
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not load withdrawal history."
      });
    }
  }
);

// ============================================================
// ADMIN AUTH
// ============================================================

function adminAuth(
  req,
  res,
  next
) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      ok: false,
      message:
        "Admin key is not configured."
    });
  }

  const supplied =
    req.headers[
      "x-admin-test-key"
    ] ||
    req.headers.authorization
      ?.replace(
        /^Bearer\s+/i,
        ""
      );

  if (
    !supplied ||
    supplied !== ADMIN_KEY
  ) {
    return res.status(401).json({
      ok: false,
      message:
        "Unauthorized."
    });
  }

  next();
}

// ============================================================
// ADMIN USERS
// ============================================================

app.get(
  "/api/admin/users",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      users: db.users.map(
        user => ({
          id: user.id,
          username:
            user.username,
          balance:
            roundNumber(
              user.balance,
              6
            ),
          points:
            roundNumber(
              user.points,
              2
            ),
          referrals:
            Number(
              user.referrals || 0
            ),
          successfulReferrals:
            Number(
              user.successfulReferrals ||
                0
            ),
          referredBy:
            user.referredBy,
          createdAt:
            user.createdAt
        })
      )
    });
  }
);

// ============================================================
// ADMIN WITHDRAWALS
// ============================================================

app.get(
  "/api/admin/withdrawals",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,
      withdrawals:
        db.withdrawals
          .slice()
          .sort(
            (a, b) =>
              new Date(b.createdAt) -
              new Date(a.createdAt)
          )
    });
  }
);

// ============================================================
// ADMIN APPROVE WITHDRAWAL
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/approve",
  adminAuth,
  (req, res) => {
    try {
      const withdrawal =
        db.withdrawals.find(
          w =>
            w.id ===
            req.params.id
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

      withdrawal.status =
        "approved";

      withdrawal.updatedAt =
        nowISO();

      saveDB();

      res.json({
        ok: true,
        message:
          "Withdrawal approved. USDT blockchain transfer is NOT automatic.",
        withdrawal
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not approve withdrawal."
      });
    }
  }
);

// ============================================================
// ADMIN REJECT WITHDRAWAL
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/reject",
  adminAuth,
  (req, res) => {
    try {
      const withdrawal =
        db.withdrawals.find(
          w =>
            w.id ===
            req.params.id
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
        db.users.find(
          u =>
            String(u.id) ===
            String(
              withdrawal.telegramUserId
            )
        );

      if (user) {
        user.balance =
          roundNumber(
            Number(
              user.balance || 0
            ) +
              Number(
                withdrawal.amount
              ),
            6
          );
      }

      withdrawal.status =
        "rejected";

      withdrawal.updatedAt =
        nowISO();

      withdrawal.rejectionReason =
        String(
          req.body?.reason ||
            "Rejected by admin."
        );

      saveDB();

      res.json({
        ok: true,
        message:
          "Withdrawal rejected and balance returned.",
        withdrawal
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not reject withdrawal."
      });
    }
  }
);

// ============================================================
// ADMIN ADD PAYMENT TXID
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/txid",
  adminAuth,
  (req, res) => {
    try {
      const withdrawal =
        db.withdrawals.find(
          w =>
            w.id ===
            req.params.id
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "Withdrawal not found."
        });
      }

      const txid =
        String(
          req.body?.txid ||
            ""
        )
          .trim()
          .toLowerCase();

      if (
        !/^[a-f0-9]{64}$/.test(
          txid
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Invalid TRON TXID."
        });
      }

      withdrawal.paymentTxid =
        txid;

      withdrawal.status =
        "paid";

      withdrawal.updatedAt =
        nowISO();

      saveDB();

      res.json({
        ok: true,
        message:
          "Payment TXID recorded.",
        withdrawal
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Could not record payment TXID."
      });
    }
  }
);

// ============================================================
// ADMIN TEST CREDIT
// ============================================================
// Adds exactly 10 USDT to the authenticated Telegram user.
// This does NOT give referral or daily rewards.
// Use only for testing.

app.post(
  "/api/admin/test-credit",
  adminAuth,
  telegramAuth,
  (req, res) => {
    try {
      const user =
        req.appUser;

      const amount = 10;

      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) +
            amount,
          6
        );

      const record = {
        id:
          randomId("test"),
        telegramUserId:
          String(
            user.id
          ),
        amount,
        createdAt:
          nowISO()
      };

      db.testCredits.push(
        record
      );

      saveDB();

      res.json({
        ok: true,
        message:
          "Test credit added.",
        amount,
        balance:
          user.balance
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message:
          "Test credit failed."
      });
    }
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      message:
        "API endpoint not found."
    });
  }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled error:",
      err
    );

    res.status(500).json({
      ok: false,
      message:
        "Internal server error."
    });
  }
);

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "💚 BIG MONEY BACKEND"
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `TRON: ${TRONGRID_URL}`
    );

    console.log(
      `USDT: ${USDT_CONTRACT}`
    );

    console.log(
      `Deposit: ${DEPOSIT_ADDRESS}`
    );

    console.log(
      `Origin: ${ALLOWED_ORIGIN}`
    );

    console.log(
      `Bot: @${TELEGRAM_BOT_USERNAME}`
    );

    console.log(
      "========================================"
    );
  }
);

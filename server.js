

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const TRONGRID_URL =
  process.env.TRONGRID_URL ||
  "https://api.trongrid.io";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY ||
  "";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const TELEGRAM_AUTH_MAX_AGE =
  Number(
    process.env.TELEGRAM_AUTH_MAX_AGE || 3600
  );

// ============================================================
// TRON / USDT
// ============================================================

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const USDT_DECIMALS =
  Number(
    process.env.USDT_DECIMALS || 6
  );

// ============================================================
// MONEY RULES
// ============================================================

// User must have at least 10 USDT
// in CONFIRMED deposits to receive daily reward.
const QUALIFYING_DEPOSIT =
  Number(
    process.env.QUALIFYING_DEPOSIT || 10
  );

// Daily reward is exactly 5 USDT.
const DAILY_REWARD_USDT =
  Number(
    process.env.DAILY_REWARD_USDT ||
    process.env.DAILY_REWARD ||
    5
  );

// Exactly 24 hours.
const DAILY_REWARD_INTERVAL_MS =
  24 * 60 * 60 * 1000;

// Minimum individual deposit.
const MIN_DEPOSIT =
  Number(
    process.env.MIN_DEPOSIT ||
    10
  );

const MIN_WITHDRAWAL =
  Number(
    process.env.MIN_WITHDRAWAL ||
    1
  );

// ============================================================
// REFERRAL
// ============================================================

const REQUIRED_REFERRALS =
  Number(
    process.env.REQUIRED_REFERRALS || 5
  );

const REFERRAL_REWARD =
  Number(
    process.env.REFERRAL_REWARD || 3
  );

// ============================================================
// ADMIN
// ============================================================

const ADMIN_TELEGRAM_IDS =
  String(
    process.env.ADMIN_TELEGRAM_IDS || ""
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS ||
  "";

// ============================================================
// SUPABASE
// ============================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  "";

const SUPABASE_TABLE =
  process.env.SUPABASE_TABLE ||
  "big_money_store";

// ============================================================
// LOCAL JSON DATABASE
// ============================================================

const DATA_DIR =
  path.join(__dirname, "data");

const DATA_FILE =
  path.join(
    DATA_DIR,
    "big-money-data.json"
  );

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(
    DATA_DIR,
    { recursive: true }
  );
}

function emptyStore() {
  return {
    users: {},
    deposits: {},
    withdrawals: {},
    referrals: {}
  };
}

function loadLocalStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return emptyStore();
    }

    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );

    if (!raw.trim()) {
      return emptyStore();
    }

    const parsed =
      JSON.parse(raw);

    return {
      users:
        parsed.users || {},

      deposits:
        parsed.deposits || {},

      withdrawals:
        parsed.withdrawals || {},

      referrals:
        parsed.referrals || {}
    };
  } catch (error) {
    console.error(
      "LOCAL DB LOAD ERROR:",
      error.message
    );

    return emptyStore();
  }
}

let store =
  loadLocalStore();

let storeLock =
  Promise.resolve();

function saveLocalStore() {
  const tempFile =
    DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      store,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    DATA_FILE
  );
}

function withStoreLock(fn) {
  const run =
    storeLock.then(
      async () => {
        return await fn();
      }
    );

  storeLock =
    run.catch(() => {});

  return run;
}

// ============================================================
// SUPABASE
// ============================================================

async function supabaseRequest(
  method,
  body
) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
    return null;
  }

  const url =
    `${SUPABASE_URL.replace(
      /\/$/,
      ""
    )}/rest/v1/${SUPABASE_TABLE}`;

  const headers = {
    "Content-Type":
      "application/json",

    "apikey":
      SUPABASE_SECRET_KEY,

    "Authorization":
      `Bearer ${SUPABASE_SECRET_KEY}`
  };

  if (method === "POST") {
    headers["Prefer"] =
      "resolution=merge-duplicates,return=minimal";
  }

  const response =
    await fetch(
      url,
      {
        method,
        headers,
        body:
          body
            ? JSON.stringify(body)
            : undefined
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${method} ${response.status}: ${text}`
    );
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function saveStore() {
  saveLocalStore();

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
    return;
  }

  try {
    await supabaseRequest(
      "POST",
      {
        id: "main",
        data: store,
        updated_at: new Date().toISOString()
      }
    );
  } catch (error) {
    console.error(
      "SUPABASE SAVE ERROR:",
      error.message
    );
  }
}

async function loadSupabaseStore() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
    return;
  }

  try {
    const url =
      `${SUPABASE_URL.replace(
        /\/$/,
        ""
      )}/rest/v1/${SUPABASE_TABLE}` +
      `?id=eq.main&select=data&limit=1`;

    const response =
      await fetch(
        url,
        {
          headers: {
            "apikey":
              SUPABASE_SECRET_KEY,

            "Authorization":
              `Bearer ${SUPABASE_SECRET_KEY}`
          }
        }
      );

    if (!response.ok) {
      console.error(
        "SUPABASE LOAD STATUS:",
        response.status
      );
      return;
    }

    const rows =
      await response.json();

    if (
      Array.isArray(rows) &&
      rows.length > 0 &&
      rows[0].data
    ) {
      const remote =
        rows[0].data;

      store = {
        users:
          remote.users || {},

        deposits:
          remote.deposits || {},

        withdrawals:
          remote.withdrawals || {},

        referrals:
          remote.referrals || {}
      };

      saveLocalStore();

      console.log(
        "Supabase database loaded."
      );
    }
  } catch (error) {
    console.error(
      "SUPABASE LOAD ERROR:",
      error.message
    );
  }
}

// ============================================================
// EXPRESS
// ============================================================

app.use(
  cors({
    origin: function (
      origin,
      callback
    ) {
      if (!origin) {
        return callback(
          null,
          true
        );
      }

      const allowed = [
        ALLOWED_ORIGIN,
        "https://sansjgj7-ctrl.github.io",
        "https://safikhanzada437-eng.github.io"
      ];

      if (
        allowed.includes(origin)
      ) {
        return callback(
          null,
          true
        );
      }

      return callback(
        null,
        false
      );
    },

    methods: [
      "GET",
      "POST",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "X-Telegram-Init-Data"
    ]
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

// ============================================================
// HELPERS
// ============================================================

function roundMoney(value) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return 0;
  }

  return (
    Math.round(
      (n + Number.EPSILON) *
        1000000
    ) / 1000000
  );
}

function formatMoney(value) {
  return roundMoney(
    value
  ).toFixed(6);
}

function nowIso() {
  return new Date()
    .toISOString();
}

function isValidTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(
    String(txid || "").trim()
  );
}

function isValidTronAddress(
  address
) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

// ============================================================
// USER
// ============================================================

function ensureUser(
  telegramUser
) {
  const id =
    String(
      telegramUser.id
    );

  if (!store.users[id]) {
    store.users[id] = {
      telegramId: id,

      username:
        telegramUser.username || "",

      firstName:
        telegramUser.first_name || "",

      lastName:
        telegramUser.last_name || "",

      balance: 0,

      points: 0,

      referralCode:
        `ref_${id}`,

      referredBy: null,

      referralCount: 0,

      // Exact successful daily reward time.
      lastDailyRewardAt: null,

      dailyRewardCount: 0,

      createdAt:
        nowIso(),

      updatedAt:
        nowIso()
    };

    return store.users[id];
  }

  const user =
    store.users[id];

  user.username =
    telegramUser.username ??
    user.username ??
    "";

  user.firstName =
    telegramUser.first_name ??
    user.firstName ??
    "";

  user.lastName =
    telegramUser.last_name ??
    user.lastName ??
    "";

  user.balance =
    Number(
      user.balance || 0
    );

  user.points =
    Number(
      user.points || 0
    );

  user.referralCount =
    Number(
      user.referralCount || 0
    );

  user.dailyRewardCount =
    Number(
      user.dailyRewardCount || 0
    );

  if (!user.referralCode) {
    user.referralCode =
      `ref_${id}`;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      user,
      "lastDailyRewardAt"
    )
  ) {
    user.lastDailyRewardAt =
      null;
  }

  user.updatedAt =
    nowIso();

  return user;
}

// ============================================================
// TELEGRAM AUTH
// ============================================================

function parseQueryString(
  queryString
) {
  const params =
    new URLSearchParams(
      String(
        queryString || ""
      )
    );

  const result = {};

  for (
    const [
      key,
      value
    ] of params.entries()
  ) {
    result[key] = value;
  }

  return result;
}

function validateTelegramInitData(
  initData
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured."
    );
  }

  if (!initData) {
    throw new Error(
      "Telegram initData is missing."
    );
  }

  const params =
    new URLSearchParams(
      initData
    );

  const hash =
    params.get("hash");

  if (!hash) {
    throw new Error(
      "Telegram hash is missing."
    );
  }

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(
        ([a], [b]) =>
          a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

  const secretKey =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(
        TELEGRAM_BOT_TOKEN
      )
      .digest();

  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(
        dataCheckString
      )
      .digest("hex");

  const received =
    String(
      hash
    ).toLowerCase();

  if (
    received.length !==
    calculatedHash.length
  ) {
    throw new Error(
      "Invalid Telegram authentication."
    );
  }

  const valid =
    crypto.timingSafeEqual(
      Buffer.from(
        received
      ),
      Buffer.from(
        calculatedHash
      )
    );

  if (!valid) {
    throw new Error(
      "Invalid Telegram authentication."
    );
  }

  const authDate =
    Number(
      params.get(
        "auth_date"
      ) || 0
    );

  if (!authDate) {
    throw new Error(
      "Telegram auth_date is missing."
    );
  }

  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;

  if (
    TELEGRAM_AUTH_MAX_AGE > 0 &&
    (
      age < -60 ||
      age >
        TELEGRAM_AUTH_MAX_AGE
    )
  ) {
    throw new Error(
      "Telegram session has expired. Reopen the Mini App."
    );
  }

  const userRaw =
    params.get(
      "user"
    );

  if (!userRaw) {
    throw new Error(
      "Telegram user data is missing."
    );
  }

  let user;

  try {
    user =
      JSON.parse(
        userRaw
      );
  } catch {
    throw new Error(
      "Invalid Telegram user data."
    );
  }

  if (
    !user ||
    !user.id
  ) {
    throw new Error(
      "Telegram user ID is missing."
    );
  }

  return {
    user,

    params:
      parseQueryString(
        initData
      )
  };
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

async function telegramAuth(
  req,
  res,
  next
) {
  try {
    const initData =
      req.headers[
        "x-telegram-init-data"
      ];

    const result =
      validateTelegramInitData(
        initData
      );

    req.telegramUser =
      result.user;

    req.telegramParams =
      result.params;

    await withStoreLock(
      async () => {
        ensureUser(
          req.telegramUser
        );

        saveLocalStore();
      }
    );

    next();
  } catch (error) {
    console.error(
      "AUTH ERROR:",
      error.message
    );

    return res
      .status(401)
      .json({
        ok: false,
        error:
          error.message
      });
  }
}

// ============================================================
// ADMIN
// ============================================================

function adminAuth(
  req,
  res,
  next
) {
  if (!req.telegramUser) {
    return res
      .status(401)
      .json({
        ok: false,
        error:
          "Not authenticated."
      });
  }

  const id =
    String(
      req.telegramUser.id
    );

  if (
    !ADMIN_TELEGRAM_IDS.includes(
      id
    )
  ) {
    return res
      .status(403)
      .json({
        ok: false,
        error:
          "Admin access required."
      });
  }

  next();
}

// ============================================================
// TRONGRID
// ============================================================

async function tronRequest(
  url,
  options = {}
) {
  const headers = {
    Accept:
      "application/json",

    ...(options.headers || {})
  };

  if (TRONGRID_API_KEY) {
    headers[
      "TRON-PRO-API-KEY"
    ] =
      TRONGRID_API_KEY;
  }

  const response =
    await fetch(
      url,
      {
        ...options,
        headers
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      `TronGrid ${response.status}: ${text}`
    );
  }

  return data;
}

// ============================================================
// BLOCKCHAIN TRANSFERS
// ============================================================

async function getConfirmedUsdtTransfers(
  txid
) {
  if (!isValidTxid(txid)) {
    throw new Error(
      "Invalid TXID."
    );
  }

  const url =
    `${TRONGRID_URL.replace(
      /\/$/,
      ""
    )}` +
    `/v1/transactions/${txid}/events` +
    `?only_confirmed=true&limit=200`;

  const data =
    await tronRequest(
      url
    );

  const events =
    Array.isArray(data.data)
      ? data.data
      : [];

  const transfers = [];

  for (
    const event of events
  ) {
    if (
      String(
        event.event_name || ""
      ).toLowerCase() !==
      "transfer"
    ) {
      continue;
    }

    const contract =
      String(
        event.contract_address ||
        event.address ||
        ""
      );

    if (
      contract.toLowerCase() !==
      USDT_CONTRACT.toLowerCase()
    ) {
      continue;
    }

    const result =
      event.result || {};

    const from =
      result.from ||
      event.from ||
      "";

    const to =
      result.to ||
      event.to ||
      "";

    const rawValue =
      result.value ??
      event.value ??
      "0";

    const rawNumber =
      Number(
        rawValue
      );

    if (
      !Number.isFinite(
        rawNumber
      ) ||
      rawNumber <= 0
    ) {
      continue;
    }

    const amount =
      roundMoney(
        rawNumber /
          Math.pow(
            10,
            USDT_DECIMALS
          )
      );

    transfers.push({
      txid,

      from,

      to,

      amount,

      rawAmount:
        String(
          rawValue
        ),

      contract:
        USDT_CONTRACT,

      eventName:
        "Transfer",

      confirmed:
        true
    });
  }

  return transfers;
}

// ============================================================
// VERIFY TRANSACTION
// ============================================================

async function verifyTransaction(
  txid
) {
  const transfers =
    await getConfirmedUsdtTransfers(
      txid
    );

  const matching =
    transfers.filter(
      (transfer) =>
        String(
          transfer.to
        ).toLowerCase() ===
        DEPOSIT_ADDRESS.toLowerCase()
    );

  if (!matching.length) {
    return {
      ok: false,

      error:
        "No confirmed USDT transfer to the Big Money deposit address was found for this TXID."
    };
  }

  const totalAmount =
    roundMoney(
      matching.reduce(
        (
          sum,
          transfer
        ) =>
          sum +
          Number(
            transfer.amount ||
              0
          ),
        0
      )
    );

  if (
    totalAmount <
    MIN_DEPOSIT
  ) {
    return {
      ok: false,

      error:
        `Minimum deposit is ${formatMoney(
          MIN_DEPOSIT
        )} USDT.`,

      amount:
        totalAmount,

      transfers:
        matching
    };
  }

  return {
    ok: true,

    amount:
      totalAmount,

    transfer:
      matching[0],

    transfers:
      matching
  };
}

// ============================================================
// USER CONFIRMED DEPOSIT TOTAL
// ============================================================

function getConfirmedDepositTotal(
  userId
) {
  const id =
    String(userId);

  let total = 0;

  for (
    const deposit of Object.values(
      store.deposits
    )
  ) {
    if (
      String(
        deposit.userId
      ) !== id
    ) {
      continue;
    }

    if (
      String(
        deposit.status
      ).toLowerCase() !==
      "confirmed"
    ) {
      continue;
    }

    total +=
      Number(
        deposit.amount || 0
      );
  }

  return roundMoney(
    total
  );
}

function isUserQualifiedForDailyReward(
  userId
) {
  const total =
    getConfirmedDepositTotal(
      userId
    );

  return (
    total >=
    QUALIFYING_DEPOSIT
  );
}

// ============================================================
// DAILY REWARD STATUS
// ============================================================

function getDailyRewardStatus(
  user
) {
  const confirmedDepositTotal =
    getConfirmedDepositTotal(
      user.telegramId
    );

  const qualified =
    confirmedDepositTotal >=
    QUALIFYING_DEPOSIT;

  if (!qualified) {
    return {
      qualified: false,

      available: false,

      confirmedDepositTotal,

      requiredDeposit:
        QUALIFYING_DEPOSIT,

      reward:
        DAILY_REWARD_USDT,

      remainingMs: 0,

      nextClaimAt: null,

      reason:
        `You need at least ${formatMoney(
          QUALIFYING_DEPOSIT
        )} USDT in confirmed deposits to receive the daily reward.`
    };
  }

  const last =
    user.lastDailyRewardAt
      ? new Date(
          user.lastDailyRewardAt
        ).getTime()
      : 0;

  if (
    !Number.isFinite(last) ||
    last <= 0
  ) {
    return {
      qualified: true,

      available: true,

      confirmedDepositTotal,

      requiredDeposit:
        QUALIFYING_DEPOSIT,

      reward:
        DAILY_REWARD_USDT,

      remainingMs: 0,

      nextClaimAt: null,

      reason:
        "Daily reward is available."
    };
  }

  const next =
    last +
    DAILY_REWARD_INTERVAL_MS;

  const remaining =
    Math.max(
      0,
      next - Date.now()
    );

  return {
    qualified: true,

    available:
      remaining <= 0,

    confirmedDepositTotal,

    requiredDeposit:
      QUALIFYING_DEPOSIT,

    reward:
      DAILY_REWARD_USDT,

    remainingMs:
      remaining,

    nextClaimAt:
      remaining > 0
        ? new Date(
            next
          ).toISOString()
        : null,

    reason:
      remaining <= 0
        ? "Daily reward is available."
        : "Daily reward is not available yet."
  };
}

// ============================================================
// REFERRALS
// ============================================================

function processReferral(
  newUserId,
  startParam
) {
  const value =
    String(
      startParam || ""
    ).trim();

  if (!value) {
    return null;
  }

  if (
    !value.startsWith(
      "ref_"
    )
  ) {
    return null;
  }

  const inviterId =
    value.substring(4);

  if (!inviterId) {
    return null;
  }

  if (
    String(
      inviterId
    ) ===
    String(
      newUserId
    )
  ) {
    return null;
  }

  const newUser =
    store.users[
      String(newUserId)
    ];

  const inviter =
    store.users[
      String(inviterId)
    ];

  if (
    !newUser ||
    !inviter
  ) {
    return null;
  }

  if (
    newUser.referredBy
  ) {
    return null;
  }

  newUser.referredBy =
    String(
      inviterId
    );

  inviter.referralCount =
    Number(
      inviter.referralCount ||
        0
    ) + 1;

  inviter.points =
    roundMoney(
      Number(
        inviter.points ||
          0
      ) +
        REFERRAL_REWARD
    );

  const referralId =
    `${inviterId}_${newUserId}`;

  store.referrals[
    referralId
  ] = {
    id:
      referralId,

    inviterId:
      String(
        inviterId
      ),

    invitedUserId:
      String(
        newUserId
      ),

    reward:
      REFERRAL_REWARD,

    createdAt:
      nowIso()
  };

  return {
    inviterId:
      String(
        inviterId
      ),

    invitedUserId:
      String(
        newUserId
      ),

    reward:
      REFERRAL_REWARD
  };
}

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,

      name:
        "Big Money Backend",

      network:
        "TRON TRC20",

      version:
        "daily-reward-5usdt-qualified-v1",

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardCooldownHours:
        24,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      minDeposit:
        MIN_DEPOSIT,

      depositVerification:
        "TXID blockchain amount",

      time:
        nowIso()
    });
  }
);

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,

      name:
        "Big Money Backend",

      network:
        "TRON TRC20",

      version:
        "daily-reward-5usdt-qualified-v1",

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardCooldownHours:
        24,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      minDeposit:
        MIN_DEPOSIT
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

      name:
        "Big Money",

      network:
        "TRON TRC20",

      depositAddress:
        DEPOSIT_ADDRESS,

      usdtContract:
        USDT_CONTRACT,

      minDeposit:
        MIN_DEPOSIT,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      minWithdrawal:
        MIN_WITHDRAWAL,

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardCooldownHours:
        24,

      requiredReferrals:
        REQUIRED_REFERRALS,

      referralReward:
        REFERRAL_REWARD,

      botUsername:
        TELEGRAM_BOT_USERNAME,

      transfers: []
    });
  }
);

// ============================================================
// ACCOUNT
// ============================================================

app.get(
  "/api/account",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      let account;

      await withStoreLock(
        async () => {
          const user =
            ensureUser(
              req.telegramUser
            );

          const startParam =
            req.telegramParams
              ?.start_param ||
            "";

          if (
            startParam &&
            !user.referredBy
          ) {
            processReferral(
              user.telegramId,
              startParam
            );
          }

          user.updatedAt =
            nowIso();

          saveLocalStore();

          const confirmedDepositTotal =
            getConfirmedDepositTotal(
              user.telegramId
            );

          account = {
            telegramId:
              user.telegramId,

            username:
              user.username,

            firstName:
              user.firstName,

            lastName:
              user.lastName,

            balance:
              roundMoney(
                user.balance
              ),

            points:
              roundMoney(
                user.points
              ),

            referralCode:
              user.referralCode,

            referredBy:
              user.referredBy,

            referralCount:
              Number(
                user.referralCount ||
                  0
              ),

            dailyRewardCount:
              Number(
                user.dailyRewardCount ||
                  0
              ),

            lastDailyRewardAt:
              user.lastDailyRewardAt,

            dailyReward:
              DAILY_REWARD_USDT,

            qualifyingDeposit:
              QUALIFYING_DEPOSIT,

            confirmedDepositTotal,

            dailyRewardStatus:
              getDailyRewardStatus(
                user
              )
          };
        }
      );

      return res.json({
        ok: true,

        user:
          account,

        account
      });
    } catch (error) {
      console.error(
        "ACCOUNT ERROR:",
        error.message
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not load account."
        });
    }
  }
);

// ============================================================
// PROFILE
// ============================================================

app.get(
  "/api/profile",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const user =
        store.users[
          String(
            req.telegramUser.id
          )
        ];

      const confirmedDepositTotal =
        getConfirmedDepositTotal(
          user.telegramId
        );

      return res.json({
        ok: true,

        profile: {
          telegramId:
            user.telegramId,

          username:
            user.username,

          firstName:
            user.firstName,

          lastName:
            user.lastName,

          referralCode:
            user.referralCode,

          balance:
            roundMoney(
              user.balance
            ),

          points:
            roundMoney(
              user.points
            ),

          referralCount:
            Number(
              user.referralCount ||
                0
            ),

          confirmedDepositTotal,

          qualifyingDeposit:
            QUALIFYING_DEPOSIT,

          dailyReward:
            DAILY_REWARD_USDT,

          lastDailyRewardAt:
            user.lastDailyRewardAt,

          dailyRewardStatus:
            getDailyRewardStatus(
              user
            )
        }
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not load profile."
        });
    }
  }
);

// ============================================================
// DAILY REWARD STATUS
// ============================================================

app.get(
  "/api/daily-reward/status",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const user =
        store.users[
          String(
            req.telegramUser.id
          )
        ];

      const status =
        getDailyRewardStatus(
          user
        );

      return res.json({
        ok: true,

        reward:
          DAILY_REWARD_USDT,

        cooldownHours:
          24,

        qualifyingDeposit:
          QUALIFYING_DEPOSIT,

        available:
          status.available,

        qualified:
          status.qualified,

        confirmedDepositTotal:
          status.confirmedDepositTotal,

        remainingMs:
          status.remainingMs,

        nextClaimAt:
          status.nextClaimAt,

        lastDailyRewardAt:
          user.lastDailyRewardAt,

        claimCount:
          Number(
            user.dailyRewardCount ||
              0
          ),

        reason:
          status.reason
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not load daily reward status."
        });
    }
  }
);

// ============================================================
// DAILY REWARD CLAIM
// ============================================================

app.post(
  "/api/daily-reward/claim",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      let result;

      await withStoreLock(
        async () => {
          const user =
            ensureUser(
              req.telegramUser
            );

          // ==================================================
          // STEP 1:
          // CHECK CONFIRMED DEPOSITS
          // ==================================================

          const confirmedDepositTotal =
            getConfirmedDepositTotal(
              user.telegramId
            );

          if (
            confirmedDepositTotal <
            QUALIFYING_DEPOSIT
          ) {
            result = {
              ok: false,

              code:
                "DEPOSIT_REQUIRED",

              error:
                `You need at least ${formatMoney(
                  QUALIFYING_DEPOSIT
                )} USDT in confirmed deposits before you can claim the daily reward.`,

              message:
                `Confirmed deposit: ${formatMoney(
                  confirmedDepositTotal
                )} USDT. Required: ${formatMoney(
                  QUALIFYING_DEPOSIT
                )} USDT.`,

              reward:
                DAILY_REWARD_USDT,

              qualifyingDeposit:
                QUALIFYING_DEPOSIT,

              confirmedDepositTotal,

              available:
                false
            };

            return;
          }

          // ==================================================
          // STEP 2:
          // CHECK EXACT 24 HOURS
          // ==================================================

          const status =
            getDailyRewardStatus(
              user
            );

          if (
            !status.available
          ) {
            const totalSeconds =
              Math.ceil(
                status.remainingMs /
                  1000
              );

            const hours =
              Math.floor(
                totalSeconds /
                  3600
              );

            const minutes =
              Math.floor(
                (
                  totalSeconds %
                  3600
                ) /
                  60
              );

            const seconds =
              totalSeconds %
              60;

            result = {
              ok: false,

              code:
                "COOLDOWN",

              error:
                "Daily reward is not available yet.",

              message:
                `Come back in ${hours}h ${minutes}m ${seconds}s.`,

              reward:
                DAILY_REWARD_USDT,

              confirmedDepositTotal,

              available:
                false,

              remainingMs:
                status.remainingMs,

              nextClaimAt:
                status.nextClaimAt
            };

            return;
          }

          // ==================================================
          // STEP 3:
          // ADD EXACTLY 5 USDT
          // ==================================================

          const reward =
            DAILY_REWARD_USDT;

          user.balance =
            roundMoney(
              Number(
                user.balance || 0
              ) +
                reward
            );

          // IMPORTANT:
          // Save the exact successful claim time.
          // This is what creates the 24-hour cooldown.
          user.lastDailyRewardAt =
            nowIso();

          user.dailyRewardCount =
            Number(
              user.dailyRewardCount ||
                0
            ) + 1;

          user.updatedAt =
            nowIso();

          saveLocalStore();

          await saveStore();

          const newStatus =
            getDailyRewardStatus(
              user
            );

          result = {
            ok: true,

            code:
              "REWARD_GRANTED",

            message:
              `Daily reward +${formatMoney(
                reward
              )} USDT has been added to your balance.`,

            reward,

            amount:
              reward,

            balance:
              roundMoney(
                user.balance
              ),

            dailyRewardCount:
              user.dailyRewardCount,

            lastDailyRewardAt:
              user.lastDailyRewardAt,

            confirmedDepositTotal,

            qualifyingDeposit:
              QUALIFYING_DEPOSIT,

            available:
              false,

            remainingMs:
              newStatus.remainingMs,

            nextClaimAt:
              newStatus.nextClaimAt
          };
        }
      );

      if (
        !result.ok
      ) {
        return res
          .status(
            result.code ===
              "COOLDOWN"
              ? 429
              : 400
          )
          .json(
            result
          );
      }

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        "DAILY REWARD ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "Could not claim daily reward."
        });
    }
  }
);

// Compatibility endpoint.
app.get(
  "/api/daily-reward",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const user =
        store.users[
          String(
            req.telegramUser.id
          )
        ];

      const status =
        getDailyRewardStatus(
          user
        );

      return res.json({
        ok: true,

        reward:
          DAILY_REWARD_USDT,

        qualifyingDeposit:
          QUALIFYING_DEPOSIT,

        confirmedDepositTotal:
          status.confirmedDepositTotal,

        available:
          status.available,

        qualified:
          status.qualified,

        remainingMs:
          status.remainingMs,

        nextClaimAt:
          status.nextClaimAt,

        lastDailyRewardAt:
          user.lastDailyRewardAt
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not load daily reward."
        });
    }
  }
);

// ============================================================
// REFERRALS
// ============================================================

app.get(
  "/api/referrals",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const user =
        store.users[
          String(
            req.telegramUser.id
          )
        ];

      const referralCode =
        user.referralCode ||
        `ref_${user.telegramId}`;

      const referralLink =
        `https://t.me/${TELEGRAM_BOT_USERNAME}` +
        `?startapp=${encodeURIComponent(
          referralCode
        )}`;

      const referrals =
        Object.values(
          store.referrals
        )
          .filter(
            (r) =>
              String(
                r.inviterId
              ) ===
              String(
                user.telegramId
              )
          )
          .map(
            (r) => {
              const invited =
                store.users[
                  String(
                    r.invitedUserId
                  )
                ];

              return {
                id:
                  r.id,

                telegramId:
                  r.invitedUserId,

                username:
                  invited?.username ||
                  "",

                firstName:
                  invited?.firstName ||
                  "",

                reward:
                  Number(
                    r.reward ||
                      0
                  ),

                createdAt:
                  r.createdAt
              };
            }
          );

      return res.json({
        ok: true,

        referralCode,

        referralLink,

        referralCount:
          Number(
            user.referralCount ||
              0
          ),

        points:
          roundMoney(
            user.points
          ),

        requiredReferrals:
          REQUIRED_REFERRALS,

        referralReward:
          REFERRAL_REWARD,

        referrals
      });
    } catch (error) {
      console.error(
        "REFERRALS ERROR:",
        error.message
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not load referrals."
        });
    }
  }
);

// Compatibility endpoint.
app.get(
  "/api/referral",
  telegramAuth,
  async (
    req,
    res
  ) => {
    const user =
      store.users[
        String(
          req.telegramUser.id
        )
      ];

    const referralCode =
      user.referralCode ||
      `ref_${user.telegramId}`;

    const referralLink =
      `https://t.me/${TELEGRAM_BOT_USERNAME}` +
      `?startapp=${encodeURIComponent(
        referralCode
      )}`;

    return res.json({
      ok: true,

      referralCode,

      referralLink,

      referralCount:
        Number(
          user.referralCount ||
            0
        ),

      points:
        roundMoney(
          user.points
        ),

      requiredReferrals:
        REQUIRED_REFERRALS,

      referralReward:
        REFERRAL_REWARD
    });
  }
);

// ============================================================
// DEPOSIT REQUEST
// ============================================================

app.post(
  "/api/deposits/request",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const requestedAmount =
        Number(
          req.body?.amount
        );

      if (
        !Number.isFinite(
          requestedAmount
        ) ||
        requestedAmount <
          MIN_DEPOSIT
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              `Minimum deposit is ${formatMoney(
                MIN_DEPOSIT
              )} USDT.`
          });
      }

      const userId =
        String(
          req.telegramUser.id
        );

      const id =
        crypto.randomUUID();

      const deposit = {
        id,

        userId,

        telegramId:
          userId,

        requestedAmount:
          roundMoney(
            requestedAmount
          ),

        amount:
          null,

        txid:
          null,

        status:
          "pending",

        createdAt:
          nowIso(),

        updatedAt:
          nowIso()
      };

      await withStoreLock(
        async () => {
          store.deposits[id] =
            deposit;

          saveLocalStore();

          await saveStore();
        }
      );

      return res.json({
        ok: true,

        depositAddress:
          DEPOSIT_ADDRESS,

        deposit
      });
    } catch (error) {
      console.error(
        "DEPOSIT REQUEST ERROR:",
        error.message
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not create deposit request."
        });
    }
  }
);

// ============================================================
// PROCESS CONFIRMED DEPOSIT
// ============================================================

async function processDeposit(
  deposit,
  transfer
) {
  const user =
    store.users[
      String(
        deposit.userId
      )
    ];

  if (!user) {
    throw new Error(
      "User for deposit not found."
    );
  }

  const amount =
    roundMoney(
      Number(
        transfer.amount
      )
    );

  if (
    !Number.isFinite(
      amount
    ) ||
    amount <
      MIN_DEPOSIT
  ) {
    throw new Error(
      "Deposit amount is below minimum."
    );
  }

  // ----------------------------------------------------------
  // DUPLICATE TXID PROTECTION
  // ----------------------------------------------------------

  const alreadyCredited =
    Object.values(
      store.deposits
    ).some(
      (d) =>
        String(
          d.txid || ""
        ).toLowerCase() ===
        String(
          transfer.txid
        ).toLowerCase() &&
        String(
          d.status || ""
        ).toLowerCase() ===
        "confirmed"
    );

  if (
    alreadyCredited
  ) {
    throw new Error(
      "This TXID has already been credited."
    );
  }

  // ----------------------------------------------------------
  // CREDIT USER
  // ----------------------------------------------------------

  user.balance =
    roundMoney(
      Number(
        user.balance || 0
      ) +
        amount
    );

  deposit.amount =
    amount;

  deposit.txid =
    transfer.txid;

  deposit.status =
    "confirmed";

  deposit.confirmedAt =
    nowIso();

  deposit.updatedAt =
    nowIso();

  deposit.transfer =
    transfer;

  user.updatedAt =
    nowIso();

  return {
    amount,

    balance:
      roundMoney(
        user.balance
      ),

    deposit
  };
}

// ============================================================
// VERIFY DEPOSIT BY TXID
// ============================================================

app.post(
  "/api/deposits/verify",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const txid =
        String(
          req.body?.txid ||
          ""
        ).trim();

      if (
        !isValidTxid(
          txid
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Please enter a valid 64-character TXID."
          });
      }

      // ------------------------------------------------------
      // CHECK IF TXID WAS ALREADY CREDITED
      // ------------------------------------------------------

      const existing =
        Object.values(
          store.deposits
        ).find(
          (d) =>
            String(
              d.txid || ""
            ).toLowerCase() ===
            txid.toLowerCase() &&
            String(
              d.status || ""
            ).toLowerCase() ===
            "confirmed"
        );

      if (existing) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "This TXID has already been credited."
          });
      }

      // ------------------------------------------------------
      // BLOCKCHAIN VERIFICATION
      // ------------------------------------------------------

      const verification =
        await verifyTransaction(
          txid
        );

      if (
        !verification.ok
      ) {
        return res
          .status(400)
          .json(
            verification
          );
      }

      const transfer =
        verification.transfer;

      const userId =
        String(
          req.telegramUser.id
        );

      let result;

      await withStoreLock(
        async () => {
          const user =
            ensureUser(
              req.telegramUser
            );

          // Check again inside lock.
          const duplicate =
            Object.values(
              store.deposits
            ).find(
              (d) =>
                String(
                  d.txid || ""
                ).toLowerCase() ===
                txid.toLowerCase() &&
                String(
                  d.status || ""
                ).toLowerCase() ===
                "confirmed"
            );

          if (duplicate) {
            throw new Error(
              "This TXID has already been credited."
            );
          }

          // --------------------------------------------------
          // USE EXISTING PENDING DEPOSIT IF AVAILABLE
          // --------------------------------------------------

          let deposit =
            Object.values(
              store.deposits
            ).find(
              (d) =>
                String(
                  d.userId
                ) ===
                userId &&
                String(
                  d.status
                ).toLowerCase() ===
                "pending" &&
                !d.txid
            );

          // --------------------------------------------------
          // OTHERWISE CREATE NEW DEPOSIT
          // --------------------------------------------------

          if (!deposit) {
            const id =
              crypto.randomUUID();

            deposit = {
              id,

              userId,

              telegramId:
                userId,

              requestedAmount:
                null,

              amount:
                null,

              txid:
                null,

              status:
                "pending",

              createdAt:
                nowIso(),

              updatedAt:
                nowIso()
            };

            store.deposits[id] =
              deposit;
          }

          const processed =
            await processDeposit(
              deposit,
              {
                ...transfer,

                txid
              }
            );

          result = {
            ok: true,

            message:
              `Deposit verified successfully. +${formatMoney(
                processed.amount
              )} USDT added to your balance.`,

            amount:
              processed.amount,

            balance:
              processed.balance,

            txid,

            deposit:
              processed.deposit
          };

          saveLocalStore();

          await saveStore();
        }
      );

      return res.json(
        result
      );
    } catch (error) {
      console.error(
        "DEPOSIT VERIFY ERROR:",
        error.message
      );

      return res
        .status(400)
        .json({
          ok: false,

          error:
            error.message ||
            "Could not verify deposit."
        });
    }
  }
);

// ============================================================
// CHECK BLOCKCHAIN
// ============================================================

app.get(
  "/api/deposits/check",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        String(
          req.telegramUser.id
        );

      const deposits =
        Object.values(
          store.deposits
        )
          .filter(
            (d) =>
              String(
                d.userId
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

      const confirmed =
        deposits.filter(
          (d) =>
            String(
              d.status
            ).toLowerCase() ===
            "confirmed"
        );

      const total =
        roundMoney(
          confirmed.reduce(
            (
              sum,
              d
            ) =>
              sum +
              Number(
                d.amount ||
                  0
              ),
            0
          )
        );

      return res.json({
        ok: true,

        depositAddress:
          DEPOSIT_ADDRESS,

        minDeposit:
          MIN_DEPOSIT,

        qualifyingDeposit:
          QUALIFYING_DEPOSIT,

        confirmedDepositTotal:
          total,

        qualifiedForDailyReward:
          total >=
          QUALIFYING_DEPOSIT,

        deposits
      });
    } catch (error) {
      console.error(
        "DEPOSIT CHECK ERROR:",
        error.message
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not check deposits."
        });
    }
  }
);

// ============================================================
// TRANSACTIONS
// ============================================================

app.get(
  "/api/transactions",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        String(
          req.telegramUser.id
        );

      const deposits =
        Object.values(
          store.deposits
        )
          .filter(
            (d) =>
              String(
                d.userId
              ) === userId
          )
          .map(
            (d) => ({
              type:
                "deposit",

              id:
                d.id,

              txid:
                d.txid,

              amount:
                Number(
                  d.amount || 0
                ),

              status:
                d.status,

              createdAt:
                d.createdAt,

              confirmedAt:
                d.confirmedAt ||
                null
            })
          );

      const withdrawals =
        Object.values(
          store.withdrawals
        )
          .filter(
            (w) =>
              String(
                w.userId
              ) === userId
          )
          .map(
            (w) => ({
              type:
                "withdrawal",

              id:
                w.id,

              txid:
                w.txid ||
                null,

              amount:
                Number(
                  w.amount || 0
                ),

              address:
                w.address,

              status:
                w.status,

              createdAt:
                w.createdAt
            })
          );

      const all = [
        ...deposits,
        ...withdrawals
      ].sort(
        (a, b) =>
          new Date(
            b.createdAt || 0
          ) -
          new Date(
            a.createdAt || 0
          )
      );

      return res.json({
        ok: true,

        transactions:
          all
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Could not load transactions."
        });
    }
  }
);

// ============================================================
// WITHDRAW REQUEST
// ============================================================

app.post(
  "/api/withdraw",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const amount =
        Number(
          req.body?.amount
        );

      const address =
        String(
          req.body?.address ||
          ""
        ).trim();

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <
          MIN_WITHDRAWAL
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              `Minimum withdrawal is ${formatMoney(
                MIN_WITHDRAWAL
              )} USDT.`
          });
      }

      if (
        !isValidTronAddress(
          address
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "Invalid TRON address."
          });
      }

      const userId =
        String(
          req.telegramUser.id
        );

      let withdrawal;

      await withStoreLock(
        async () => {
          const user =
            ensureUser(
              req.telegramUser
            );

          if (
            Number(
              user.balance
            ) <
            amount
          ) {
            throw new Error(
              "Insufficient balance."
            );
          }

          if (
            Number(
              user.referralCount ||
                0
            ) <
            REQUIRED_REFERRALS
          ) {
            throw new Error(
              `You need at least ${REQUIRED_REFERRALS} successful referrals before withdrawal.`
            );
          }

          user.balance =
            roundMoney(
              Number(
                user.balance
              ) -
                amount
            );

          const id =
            crypto.randomUUID();

          withdrawal = {
            id,

            userId,

            telegramId:
              userId,

            amount:
              roundMoney(
                amount
              ),

            address,

            txid:
              null,

            status:
              "pending",

            createdAt:
              nowIso(),

            updatedAt:
              nowIso()
          };

          store.withdrawals[
            id
          ] =
            withdrawal;

          user.updatedAt =
            nowIso();

          saveLocalStore();

          await saveStore();
        }
      );

      return res.json({
        ok: true,

        message:
          "Withdrawal request submitted.",

        withdrawal
      });
    } catch (error) {
      console.error(
        "WITHDRAW ERROR:",
        error.message
      );

      return res
        .status(400)
        .json({
          ok: false,

          error:
            error.message ||
            "Could not create withdrawal."
        });
    }
  }
);

// Compatibility endpoint.
app.post(
  "/api/withdrawals/request",
  telegramAuth,
  async (
    req,
    res
  ) => {
    req.url =
      "/api/withdraw";

    try {
      const amount =
        Number(
          req.body?.amount
        );

      const address =
        String(
          req.body?.address ||
          ""
        ).trim();

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <
          MIN_WITHDRAWAL
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              `Minimum withdrawal is ${formatMoney(
                MIN_WITHDRAWAL
              )} USDT.`
          });
      }

      if (
        !isValidTronAddress(
          address
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Invalid TRON address."
          });
      }

      const userId =
        String(
          req.telegramUser.id
        );

      let withdrawal;

      await withStoreLock(
        async () => {
          const user =
            ensureUser(
              req.telegramUser
            );

          if (
            Number(
              user.balance
            ) <
            amount
          ) {
            throw new Error(
              "Insufficient balance."
            );
          }

          if (
            Number(
              user.referralCount ||
                0
            ) <
            REQUIRED_REFERRALS
          ) {
            throw new Error(
              `You need at least ${REQUIRED_REFERRALS} successful referrals before withdrawal.`
            );
          }

          user.balance =
            roundMoney(
              Number(
                user.balance
              ) -
                amount
            );

          const id =
            crypto.randomUUID();

          withdrawal = {
            id,

            userId,

            telegramId:
              userId,

            amount:
              roundMoney(
                amount
              ),

            address,

            txid:
              null,

            status:
              "pending",

            createdAt:
              nowIso(),

            updatedAt:
              nowIso()
          };

          store.withdrawals[
            id
          ] =
            withdrawal;

          user.updatedAt =
            nowIso();

          saveLocalStore();

          await saveStore();
        }
      );

      return res.json({
        ok: true,

        message:
          "Withdrawal request submitted.",

        withdrawal
      });
    } catch (error) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);

// ============================================================
// ADMIN - USERS
// ============================================================

app.get(
  "/api/admin/users",
  telegramAuth,
  adminAuth,
  async (
    req,
    res
  ) => {
    const users =
      Object.values(
        store.users
      ).map(
        (u) => ({
          telegramId:
            u.telegramId,

          username:
            u.username,

          firstName:
            u.firstName,

          lastName:
            u.lastName,

          balance:
            roundMoney(
              u.balance
            ),

          points:
            roundMoney(
              u.points
            ),

          referralCount:
            Number(
              u.referralCount ||
                0
            ),

          confirmedDepositTotal:
            getConfirmedDepositTotal(
              u.telegramId
            ),

          dailyRewardCount:
            Number(
              u.dailyRewardCount ||
                0
            ),

          lastDailyRewardAt:
            u.lastDailyRewardAt,

          createdAt:
            u.createdAt
        })
      );

    return res.json({
      ok: true,
      users
    });
  }
);

// ============================================================
// ADMIN - DEPOSITS
// ============================================================

app.get(
  "/api/admin/deposits",
  telegramAuth,
  adminAuth,
  async (
    req,
    res
  ) => {
    return res.json({
      ok: true,

      deposits:
        Object.values(
          store.deposits
        ).sort(
          (a, b) =>
            new Date(
              b.createdAt || 0
            ) -
            new Date(
              a.createdAt || 0
            )
        )
    });
  }
);

// ============================================================
// ADMIN - WITHDRAWALS
// ============================================================

app.get(
  "/api/admin/withdrawals",
  telegramAuth,
  adminAuth,
  async (
    req,
    res
  ) => {
    return res.json({
      ok: true,

      withdrawals:
        Object.values(
          store.withdrawals
        ).sort(
          (a, b) =>
            new Date(
              b.createdAt || 0
            ) -
            new Date(
              a.createdAt || 0
            )
        )
    });
  }
);

// ============================================================
// ADMIN - CONFIRM WITHDRAWAL
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/complete",
  telegramAuth,
  adminAuth,
  async (
    req,
    res
  ) => {
    try {
      const id =
        String(
          req.params.id
        );

      const txid =
        String(
          req.body?.txid ||
          ""
        ).trim();

      await withStoreLock(
        async () => {
          const withdrawal =
            store.withdrawals[
              id
            ];

          if (!withdrawal) {
            throw new Error(
              "Withdrawal not found."
            );
          }

          withdrawal.status =
            "completed";

          withdrawal.txid =
            txid || null;

          withdrawal.completedAt =
            nowIso();

          withdrawal.updatedAt =
            nowIso();

          saveLocalStore();

          await saveStore();
        }
      );

      return res.json({
        ok: true,

        message:
          "Withdrawal marked as completed."
      });
    } catch (error) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);

// ============================================================
// ADMIN - REJECT WITHDRAWAL
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/reject",
  telegramAuth,
  adminAuth,
  async (
    req,
    res
  ) => {
    try {
      const id =
        String(
          req.params.id
        );

      await withStoreLock(
        async () => {
          const withdrawal =
            store.withdrawals[
              id
            ];

          if (!withdrawal) {
            throw new Error(
              "Withdrawal not found."
            );
          }

          if (
            withdrawal.status ===
            "rejected"
          ) {
            throw new Error(
              "Withdrawal is already rejected."
            );
          }

          if (
            withdrawal.status ===
            "completed"
          ) {
            throw new Error(
              "Completed withdrawal cannot be rejected."
            );
          }

          const user =
            store.users[
              String(
                withdrawal.userId
              )
            ];

          if (user) {
            user.balance =
              roundMoney(
                Number(
                  user.balance ||
                    0
                ) +
                  Number(
                    withdrawal.amount ||
                      0
                  )
              );

            user.updatedAt =
              nowIso();
          }

          withdrawal.status =
            "rejected";

          withdrawal.rejectedAt =
            nowIso();

          withdrawal.updatedAt =
            nowIso();

          saveLocalStore();

          await saveStore();
        }
      );

      return res.json({
        ok: true,

        message:
          "Withdrawal rejected and amount returned to user balance."
      });
    } catch (error) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            error.message
        });
    }
  }
);

// ============================================================
// BACKGROUND DEPOSIT SCANNER
// ============================================================
//
// If a pending deposit already has a TXID,
// the server periodically checks it.
// ============================================================

let scannerRunning =
  false;

async function scanPendingDeposits() {
  if (scannerRunning) {
    return;
  }

  scannerRunning = true;

  try {
    const pending =
      Object.values(
        store.deposits
      )
        .filter(
          (d) =>
            String(
              d.status
            ).toLowerCase() ===
            "pending" &&
            isValidTxid(
              d.txid
            )
        )
        .slice(
          0,
          20
        );

    for (
      const deposit of pending
    ) {
      try {
        const verification =
          await verifyTransaction(
            deposit.txid
          );

        if (
          !verification.ok
        ) {
          continue;
        }

        const transfer =
          verification.transfer;

        await withStoreLock(
          async () => {
            const current =
              store.deposits[
                deposit.id
              ];

            if (
              !current ||
              current.status ===
                "confirmed"
            ) {
              return;
            }

            const duplicate =
              Object.values(
                store.deposits
              ).some(
                (d) =>
                  String(
                    d.txid || ""
                  ).toLowerCase() ===
                  String(
                    deposit.txid
                  ).toLowerCase() &&
                  d.status ===
                    "confirmed"
              );

            if (duplicate) {
              return;
            }

            await processDeposit(
              current,
              transfer
            );

            saveLocalStore();

            await saveStore();

            console.log(
              "Pending deposit confirmed:",
              deposit.txid
            );
          }
        );
      } catch (error) {
        console.error(
          "SCANNER TX ERROR:",
          deposit.txid,
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      "DEPOSIT SCANNER ERROR:",
      error.message
    );
  } finally {
    scannerRunning =
      false;
  }
}

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  await loadSupabaseStore();

  saveLocalStore();

  app.listen(
    PORT,
    () => {
      console.log(
        "================================================"
      );

      console.log(
        "BIG MONEY BACKEND STARTED"
      );

      console.log(
        "================================================"
      );

      console.log(
        `PORT: ${PORT}`
      );

      console.log(
        `NETWORK: TRON TRC20`
      );

      console.log(
        `DEPOSIT ADDRESS: ${DEPOSIT_ADDRESS}`
      );

      console.log(
        `MIN DEPOSIT: ${MIN_DEPOSIT} USDT`
      );

      console.log(
        `QUALIFYING DEPOSIT: ${QUALIFYING_DEPOSIT} USDT`
      );

      console.log(
        `DAILY REWARD: ${DAILY_REWARD_USDT} USDT`
      );

      console.log(
        `DAILY REWARD COOLDOWN: 24 HOURS`
      );

      console.log(
        `REQUIRED REFERRALS: ${REQUIRED_REFERRALS}`
      );

      console.log(
        `REFERRAL REWARD: ${REFERRAL_REWARD}`
      );

      console.log(
        `SUPABASE: ${
          SUPABASE_URL
            ? "configured"
            : "not configured"
        }`
      );

      console.log(
        "================================================"
      );
    }
  );

  // Check pending deposits every 15 seconds.
  setInterval(
    () => {
      scanPendingDeposits()
        .catch(
          (error) =>
            console.error(
              "SCANNER ERROR:",
              error.message
            )
        );
    },
    15000
  );
}

startServer()
  .catch(
    (error) => {
      console.error(
        "SERVER START ERROR:",
        error
      );

      process.exit(1);
    }
  );

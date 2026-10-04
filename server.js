const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

// ============================================================
// ENVIRONMENT
// ============================================================

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

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

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://sansjgj7-ctrl.github.io";

const USDT_DECIMALS = 6;

// ============================================================
// BIG MONEY RULES
// ============================================================

const QUALIFYING_DEPOSIT = 10;

// Daily reward = 5 USDT
const DAILY_REWARD_USDT = 5;

// Referral points removed
const REFERRAL_REWARD_POINTS = 0;

const REQUIRED_REFERRALS = 5;

// Legacy point conversion
const POINT_USDT_RATE = 1;

// Admin test credit
const TEST_CREDIT_USDT = 10;

// ============================================================
// APP
// ============================================================

app.use(
  cors({
    origin: true,
    credentials: false
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
const DATA_FILE = path.join(
  DATA_DIR,
  "big-money-data.json"
);

function emptyDB() {
  return {
    users: [],
    deposits: [],
    withdrawals: [],
    usedTransactions: [],
    pointConversions: []
  };
}

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(emptyDB(), null, 2)
    );
  }
}

function loadDB() {
  ensureDB();

  try {
    const raw = fs.readFileSync(
      DATA_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    return {
      users: Array.isArray(data.users)
        ? data.users
        : [],

      deposits: Array.isArray(data.deposits)
        ? data.deposits
        : [],

      withdrawals: Array.isArray(data.withdrawals)
        ? data.withdrawals
        : [],

      usedTransactions:
        Array.isArray(data.usedTransactions)
          ? data.usedTransactions
          : [],

      pointConversions:
        Array.isArray(data.pointConversions)
          ? data.pointConversions
          : []
    };
  } catch (error) {
    console.error(
      "Database read error:",
      error
    );

    return emptyDB();
  }
}

let db = loadDB();

function saveDB() {
  ensureDB();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(db, null, 2)
  );
}

// ============================================================
// HELPERS
// ============================================================

function nowISO() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto.randomBytes(4).toString("hex")
  );
}

function roundNumber(value, decimals = 6) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  const factor = Math.pow(10, decimals);

  return Math.round(n * factor) / factor;
}

function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

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

function cleanTxid(value) {
  return String(value || "").trim();
}

function isValidTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "")
  );
}

// ============================================================
// USER
// ============================================================

function findUser(telegramUserId) {
  const id = String(telegramUserId);

  return db.users.find(
    (u) =>
      String(u.telegramUserId) === id
  );
}

function ensureUser(telegramUser) {
  const id = String(
    telegramUser?.id ||
    telegramUser?.telegramUserId ||
    ""
  );

  if (!id) {
    throw new Error(
      "Telegram user ID is missing"
    );
  }

  let user = findUser(id);

  if (!user) {
    user = {
      telegramUserId: id,

      username:
        telegramUser?.username || "",

      firstName:
        telegramUser?.first_name || "",

      lastName:
        telegramUser?.last_name || "",

      balance: 0,

      points: 0,

      referrals: [],

      totalInvited: 0,

      successfulReferrals: 0,

      referredBy: null,

      referralRewardGiven: false,

      dailyRewards: [],

      dailyRewardEligible: false,

      qualifiedAt: null,

      createdAt: nowISO(),

      updatedAt: nowISO()
    };

    db.users.push(user);
    saveDB();
  } else {
    user.username =
      telegramUser?.username ??
      user.username ??
      "";

    user.firstName =
      telegramUser?.first_name ??
      user.firstName ??
      "";

    user.lastName =
      telegramUser?.last_name ??
      user.lastName ??
      "";

    if (!Array.isArray(user.referrals)) {
      user.referrals = [];
    }

    if (!Array.isArray(user.dailyRewards)) {
      user.dailyRewards = [];
    }

    if (
      typeof user.successfulReferrals !==
      "number"
    ) {
      user.successfulReferrals = 0;
    }

    if (
      typeof user.totalInvited !==
      "number"
    ) {
      user.totalInvited =
        user.referrals.length;
    }

    if (
      typeof user.points !==
      "number"
    ) {
      user.points = 0;
    }

    if (
      typeof user.balance !==
      "number"
    ) {
      user.balance = 0;
    }

    if (
      typeof user.dailyRewardEligible !==
      "boolean"
    ) {
      user.dailyRewardEligible =
        Boolean(user.qualifiedAt);
    }

    user.updatedAt = nowISO();
  }

  return user;
}

// ============================================================
// REFERRAL
// ============================================================

function registerReferral(
  newUser,
  startParam
) {
  const param =
    String(startParam || "").trim();

  if (!param) {
    return;
  }

  let referrerId = "";

  if (param.startsWith("ref_")) {
    referrerId = param.slice(4);
  } else if (param.startsWith("ref")) {
    referrerId = param.slice(3);
  }

  if (!referrerId) {
    return;
  }

  if (
    String(referrerId) ===
    String(newUser.telegramUserId)
  ) {
    return;
  }

  if (newUser.referredBy) {
    return;
  }

  const referrer =
    findUser(referrerId);

  if (!referrer) {
    return;
  }

  newUser.referredBy =
    String(referrerId);

  if (!Array.isArray(referrer.referrals)) {
    referrer.referrals = [];
  }

  const exists =
    referrer.referrals.some(
      (x) =>
        String(x.telegramUserId) ===
        String(newUser.telegramUserId)
    );

  if (!exists) {
    referrer.referrals.push({
      telegramUserId:
        String(newUser.telegramUserId),

      successful: false,

      createdAt: nowISO()
    });

    referrer.totalInvited =
      referrer.referrals.length;
  }

  saveDB();
}

// ============================================================
// TELEGRAM AUTH
// ============================================================

function verifyTelegramInitData(
  initData
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const raw =
    String(initData || "").trim();

  if (!raw) {
    throw new Error(
      "Telegram initData is missing"
    );
  }

  const params =
    new URLSearchParams(raw);

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    throw new Error(
      "Telegram hash is missing"
    );
  }

  params.delete("hash");

  const dataCheckString =
    Array.from(params.entries())
      .sort(([a], [b]) =>
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
      .update(dataCheckString)
      .digest("hex");

  if (
    !constantTimeEqual(
      calculatedHash,
      receivedHash
    )
  ) {
    throw new Error(
      "Invalid Telegram initData"
    );
  }

  const authDate =
    Number(params.get("auth_date"));

  if (
    !Number.isFinite(authDate)
  ) {
    throw new Error(
      "Invalid Telegram auth_date"
    );
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (
    age < 0 ||
    age > 86400
  ) {
    throw new Error(
      "Telegram authentication expired"
    );
  }

  let telegramUser = null;

  const userJSON =
    params.get("user");

  if (userJSON) {
    try {
      telegramUser =
        JSON.parse(userJSON);
    } catch (error) {
      throw new Error(
        "Invalid Telegram user data"
      );
    }
  }

  if (
    !telegramUser ||
    !telegramUser.id
  ) {
    throw new Error(
      "Telegram user is missing"
    );
  }

  return {
    telegramUser,
    startParam:
      params.get("start_param") || ""
  };
}

function telegramAuth(
  req,
  res,
  next
) {
  try {
    const initData =
      req.get(
        "X-Telegram-Init-Data"
      ) ||
      req.body?.initData ||
      req.query?.initData ||
      "";

    const auth =
      verifyTelegramInitData(
        initData
      );

    const user =
      ensureUser(
        auth.telegramUser
      );

    registerReferral(
      user,
      auth.startParam
    );

    req.telegramUser =
      auth.telegramUser;

    req.appUser = user;

    next();
  } catch (error) {
    console.error(
      "Telegram auth error:",
      error.message
    );

    return res.status(401).json({
      ok: false,
      error: error.message
    });
  }
}

// ============================================================
// DAILY REWARD
// ============================================================

function applyDailyReward(user) {
  if (!user.dailyRewardEligible) {
    return {
      awarded: false,
      amount: 0,
      reason:
        "User is not eligible for daily reward"
    };
  }

  if (!Array.isArray(user.dailyRewards)) {
    user.dailyRewards = [];
  }

  const today =
    kabulDateString();

  const alreadyClaimed =
    user.dailyRewards.includes(
      today
    );

  if (alreadyClaimed) {
    return {
      awarded: false,
      amount: 0,
      reason:
        "Daily reward already claimed today"
    };
  }

  user.balance =
    roundNumber(
      Number(user.balance || 0) +
        DAILY_REWARD_USDT,
      USDT_DECIMALS
    );

  user.dailyRewards.push(today);

  return {
    awarded: true,
    amount: DAILY_REWARD_USDT,
    date: today
  };
}

// ============================================================
// SUCCESSFUL REFERRAL
// ============================================================

function applyReferralReward(
  depositedUser
) {
  if (
    Number(
      depositedUser.lastQualifyingDeposit || 0
    ) >= QUALIFYING_DEPOSIT
  ) {
    // Already qualified before
    return;
  }

  if (
    !depositedUser.referredBy
  ) {
    return;
  }

  const referrer =
    findUser(
      depositedUser.referredBy
    );

  if (!referrer) {
    return;
  }

  if (
    !Array.isArray(referrer.referrals)
  ) {
    referrer.referrals = [];
  }

  const referral =
    referrer.referrals.find(
      (x) =>
        String(x.telegramUserId) ===
        String(
          depositedUser.telegramUserId
        )
    );

  if (!referral) {
    return;
  }

  if (referral.successful) {
    return;
  }

  referral.successful = true;
  referral.successfulAt =
    nowISO();

  referrer.successfulReferrals =
    Number(
      referrer.successfulReferrals || 0
    ) + 1;

  // No points are awarded.
  referrer.points =
    Number(referrer.points || 0);

  referrer.updatedAt =
    nowISO();
}

// ============================================================
// TRONGRID HEADERS
// ============================================================

function tronHeaders() {
  const headers = {
    Accept: "application/json"
  };

  if (TRONGRID_API_KEY) {
    headers[
      "TRON-PRO-API-KEY"
    ] = TRONGRID_API_KEY;
  }

  return headers;
}

// ============================================================
// TRON GRID - DIRECT EVENTS
// ============================================================

async function findTransferFromEvents(
  txid
) {
  const url =
    `${TRONGRID_URL}/v1/transactions/${encodeURIComponent(
      txid
    )}/events` +
    `?only_confirmed=true` +
    `&limit=200`;

  const response =
    await fetch(url, {
      method: "GET",
      headers: tronHeaders()
    });

  if (!response.ok) {
    return null;
  }

  const json =
    await response.json();

  const events =
    Array.isArray(json.data)
      ? json.data
      : [];

  const matches =
    events.filter((event) => {
      const eventTxid =
        String(
          event.transaction_id ||
            ""
        ).toLowerCase();

      const contract =
        String(
          event.contract_address ||
            event.token_info?.address ||
            ""
        );

      const eventName =
        String(
          event.event_name ||
            event.name ||
            ""
        ).toLowerCase();

      const to =
        String(
          event.result?.to ||
            event.to ||
            ""
        );

      return (
        eventTxid ===
          txid.toLowerCase() &&

        (
          eventName ===
            "transfer" ||
          eventName ===
            "transfer(address,address,uint256)"
        ) &&

        contract ===
          USDT_CONTRACT &&

        to ===
          DEPOSIT_ADDRESS
      );
    });

  if (
    matches.length === 0
  ) {
    return null;
  }

  const transfer =
    matches[0];

  const rawValue =
    String(
      transfer.result?.value ??
      transfer.value ??
      ""
    );

  if (
    !/^\d+$/.test(rawValue)
  ) {
    return null;
  }

  const decimals =
    Number(
      transfer.token_info
        ?.decimals ??
        USDT_DECIMALS
    );

  const amount =
    Number(rawValue) /
    Math.pow(10, decimals);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return {
    txid,

    from:
      String(
        transfer.result?.from ||
        transfer.from ||
        ""
      ),

    to:
      String(
        transfer.result?.to ||
        transfer.to ||
        ""
      ),

    amount:
      roundNumber(
        amount,
        USDT_DECIMALS
      ),

    contract:
      USDT_CONTRACT,

    confirmed: true,

    timestamp:
      transfer.block_timestamp ||
      null
  };
}

// ============================================================
// TRON GRID - ACCOUNT TRC20 HISTORY
// ============================================================

async function findTransferFromHistory(
  txid
) {
  const url =
    `${TRONGRID_URL}/v1/accounts/${encodeURIComponent(
      DEPOSIT_ADDRESS
    )}/transactions/trc20` +
    `?only_confirmed=true` +
    `&limit=200` +
    `&contract_address=${encodeURIComponent(
      USDT_CONTRACT
    )}` +
    `&only_to=true`;

  const response =
    await fetch(url, {
      method: "GET",
      headers: tronHeaders()
    });

  if (!response.ok) {
    const body =
      await response
        .text()
        .catch(() => "");

    throw new Error(
      `TronGrid API error ${response.status}: ${body.slice(
        0,
        300
      )}`
    );
  }

  const json =
    await response.json();

  const transfers =
    Array.isArray(json.data)
      ? json.data
      : [];

  const transfer =
    transfers.find(
      (item) =>
        String(
          item.transaction_id ||
            ""
        ).toLowerCase() ===
          txid.toLowerCase() &&

        String(
          item.to || ""
        ) ===
          DEPOSIT_ADDRESS &&

        String(
          item.token_info?.address ||
            ""
        ) ===
          USDT_CONTRACT
    );

  if (!transfer) {
    return null;
  }

  const rawValue =
    String(
      transfer.value || ""
    );

  if (
    !/^\d+$/.test(rawValue)
  ) {
    return null;
  }

  const decimals =
    Number(
      transfer.token_info
        ?.decimals ??
        USDT_DECIMALS
    );

  const amount =
    Number(rawValue) /
    Math.pow(10, decimals);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return {
    txid,

    from:
      String(
        transfer.from || ""
      ),

    to:
      String(
        transfer.to || ""
      ),

    amount:
      roundNumber(
        amount,
        USDT_DECIMALS
      ),

    contract:
      String(
        transfer.token_info
          ?.address ||
          USDT_CONTRACT
      ),

    confirmed: true,

    timestamp:
      transfer.block_timestamp ||
      null
  };
}

// ============================================================
// FIND CONFIRMED USDT TRANSFER
// ============================================================

async function findConfirmedUSDTTransfer(
  txid
) {
  const clean =
    cleanTxid(txid);

  if (!isValidTxid(clean)) {
    throw new Error(
      "Invalid TXID"
    );
  }

  // First try direct transaction events.
  const eventTransfer =
    await findTransferFromEvents(
      clean
    );

  if (eventTransfer) {
    return eventTransfer;
  }

  // Then try confirmed TRC20 history.
  const historyTransfer =
    await findTransferFromHistory(
      clean
    );

  if (historyTransfer) {
    return historyTransfer;
  }

  return null;
}

// ============================================================
// HOME / HEALTH
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      name: "Big Money Backend",
      network: "TRON TRC20",
      time: nowISO()
    });
  }
);

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      server: "Big Money",
      network: "TRON TRC20",
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

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      referralRewardPoints:
        0,

      dailyRewardPoints:
        0,

      dailyRewardUSDT:
        DAILY_REWARD_USDT,

      requiredReferrals:
        REQUIRED_REFERRALS,

      pointUsdtRate:
        POINT_USDT_RATE
    });
  }
);

// ============================================================
// ACCOUNT RESPONSE
// ============================================================

function accountResponse(
  user
) {
  const successfulReferrals =
    Number(
      user.successfulReferrals || 0
    );

  const invited =
    Number(
      user.totalInvited || 0
    );

  const referralLink =
    `https://t.me/bigmoney2026bot?startapp=ref_${user.telegramUserId}`;

  return {
    ok: true,

    user: {
      telegramUserId:
        String(user.telegramUserId),

      username:
        user.username || "",

      firstName:
        user.firstName || "",

      lastName:
        user.lastName || "",

      balance:
        roundNumber(
          Number(user.balance || 0),
          USDT_DECIMALS
        ),

      points:
        roundNumber(
          Number(user.points || 0),
          6
        ),

      totalInvited:
        invited,

      successfulReferrals:
        successfulReferrals,

      referredBy:
        user.referredBy || null,

      dailyRewardEligible:
        Boolean(
          user.dailyRewardEligible
        )
    },

    balance:
      roundNumber(
        Number(user.balance || 0),
        USDT_DECIMALS
      ),

    points:
      roundNumber(
        Number(user.points || 0),
        6
      ),

    referral: {
      invited,

      successful:
        successfulReferrals,

      required:
        REQUIRED_REFERRALS,

      referralLink
    },

    dailyReward: {
      amount:
        DAILY_REWARD_USDT,

      eligible:
        Boolean(
          user.dailyRewardEligible
        ),

      today:
        kabulDateString(),

      claimedToday:
        Array.isArray(
          user.dailyRewards
        ) &&
        user.dailyRewards.includes(
          kabulDateString()
        )
    }
  };
}

// ============================================================
// GET ACCOUNT
// ============================================================

app.get(
  "/api/account/:telegramUserId",
  telegramAuth,
  (req, res) => {
    const requestedId =
      String(
        req.params.telegramUserId ||
          ""
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
        error:
          "Telegram user ID mismatch"
      });
    }

    return res.json(
      accountResponse(
        req.appUser
      )
    );
  }
);

// ============================================================
// POST ACCOUNT
// Compatibility with older frontend
// ============================================================

app.post(
  "/api/account",
  telegramAuth,
  (req, res) => {
    return res.json(
      accountResponse(
        req.appUser
      )
    );
  }
);

// ============================================================
// REFERRAL
// ============================================================

app.get(
  "/api/referral/:telegramUserId",
  telegramAuth,
  (req, res) => {
    const requestedId =
      String(
        req.params.telegramUserId ||
          ""
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
        error:
          "Telegram user ID mismatch"
      });
    }

    const user =
      req.appUser;

    const referrals =
      Array.isArray(user.referrals)
        ? user.referrals
        : [];

    res.json({
      ok: true,

      invited:
        Number(
          user.totalInvited || 0
        ),

      successful:
        Number(
          user.successfulReferrals ||
            0
        ),

      required:
        REQUIRED_REFERRALS,

      points:
        Number(user.points || 0),

      referralLink:
        `https://t.me/bigmoney2026bot?startapp=ref_${user.telegramUserId}`,

      referrals
    });
  }
);

// ============================================================
// DAILY REWARD CLAIM
// ============================================================

app.post(
  "/api/daily-reward/claim",
  telegramAuth,
  (req, res) => {
    const user =
      req.appUser;

    if (
      !user.dailyRewardEligible
    ) {
      return res.status(400).json({
        ok: false,
        error:
          `Make a confirmed deposit of at least ${QUALIFYING_DEPOSIT} USDT to become eligible for the daily reward.`
      });
    }

    const result =
      applyDailyReward(user);

    if (result.awarded) {
      saveDB();

      return res.json({
        ok: true,

        awarded: true,

        amount:
          result.amount,

        balance:
          roundNumber(
            user.balance,
            USDT_DECIMALS
          ),

        date:
          result.date
      });
    }

    return res.json({
      ok: true,

      awarded: false,

      amount: 0,

      balance:
        roundNumber(
          user.balance,
          USDT_DECIMALS
        ),

      reason:
        result.reason
    });
  }
);

// Alias for frontend compatibility
app.post(
  "/api/daily-reward",
  telegramAuth,
  (req, res) => {
    const user =
      req.appUser;

    if (
      !user.dailyRewardEligible
    ) {
      return res.status(400).json({
        ok: false,
        error:
          `Make a confirmed deposit of at least ${QUALIFYING_DEPOSIT} USDT to become eligible for the daily reward.`
      });
    }

    const result =
      applyDailyReward(user);

    if (result.awarded) {
      saveDB();
    }

    return res.json({
      ok: true,

      awarded:
        result.awarded,

      amount:
        result.awarded
          ? result.amount
          : 0,

      balance:
        roundNumber(
          user.balance,
          USDT_DECIMALS
        ),

      reason:
        result.reason || null
    });
  }
);

// ============================================================
// POINT CONVERSION
// ============================================================

app.post(
  "/api/points/convert",
  telegramAuth,
  (req, res) => {
    const user =
      req.appUser;

    const points =
      Number(
        req.body?.points
      );

    if (
      !Number.isFinite(points) ||
      points <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid points amount"
      });
    }

    if (
      points >
      Number(user.points || 0)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Insufficient points"
      });
    }

    const usdt =
      roundNumber(
        points *
          POINT_USDT_RATE,
        USDT_DECIMALS
      );

    user.points =
      roundNumber(
        Number(user.points || 0) -
          points,
        6
      );

    user.balance =
      roundNumber(
        Number(user.balance || 0) +
          usdt,
        USDT_DECIMALS
      );

    db.pointConversions.push({
      id: makeId("convert"),

      telegramUserId:
        String(user.telegramUserId),

      points,

      usdt,

      rate:
        POINT_USDT_RATE,

      createdAt:
        nowISO()
    });

    saveDB();

    res.json({
      ok: true,

      pointsConverted:
        points,

      usdt,

      balance:
        user.balance,

      remainingPoints:
        user.points
    });
  }
);

// ============================================================
// POINT HISTORY
// ============================================================

app.get(
  "/api/points/history",
  telegramAuth,
  (req, res) => {
    const user =
      req.appUser;

    const history =
      db.pointConversions
        .filter(
          (x) =>
            String(
              x.telegramUserId
            ) ===
            String(
              user.telegramUserId
            )
        )
        .slice(-100)
        .reverse();

    res.json({
      ok: true,
      history
    });
  }
);

// ============================================================
// CHECK BLOCKCHAIN
// ============================================================

app.get(
  "/api/deposits/check",
  async (req, res) => {
    try {
      const url =
        `${TRONGRID_URL}/v1/accounts/${encodeURIComponent(
          DEPOSIT_ADDRESS
        )}/transactions/trc20` +
        `?only_confirmed=true` +
        `&limit=200` +
        `&contract_address=${encodeURIComponent(
          USDT_CONTRACT
        )}` +
        `&only_to=true`;

      const response =
        await fetch(url, {
          headers:
            tronHeaders()
        });

      if (!response.ok) {
        const body =
          await response
            .text()
            .catch(() => "");

        throw new Error(
          `TronGrid ${response.status}: ${body.slice(
            0,
            300
          )}`
        );
      }

      const json =
        await response.json();

      const transfers =
        Array.isArray(
          json.data
        )
          ? json.data.map(
              (x) => ({
                transactionId:
                  x.transaction_id,

                from:
                  x.from,

                to:
                  x.to,

                amountUSDT:
                  roundNumber(
                    Number(
                      x.value || 0
                    ) /
                      Math.pow(
                        10,
                        Number(
                          x.token_info
                            ?.decimals ??
                            USDT_DECIMALS
                        )
                      ),
                    USDT_DECIMALS
                  ),

                confirmed:
                  true,

                timestamp:
                  x.block_timestamp,

                tokenContract:
                  x.token_info
                    ?.address ||
                  USDT_CONTRACT
              })
            )
          : [];

      res.json({
        ok: true,

        depositAddress:
          DEPOSIT_ADDRESS,

        transfers
      });
    } catch (error) {
      console.error(
        "Blockchain check error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Could not check TRON blockchain"
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
    const user =
      req.appUser;

    const amount =
      Number(
        req.body?.amount
      );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid deposit amount"
      });
    }

    const deposit = {
      id: makeId("dep"),

      telegramUserId:
        String(user.telegramUserId),

      claimedAmount:
        roundNumber(
          amount,
          USDT_DECIMALS
        ),

      txid: null,

      status: "pending",

      createdAt:
        nowISO()
    };

    db.deposits.push(
      deposit
    );

    saveDB();

    res.json({
      ok: true,
      deposit
    });
  }
);

// ============================================================
// VERIFY DEPOSIT
// ============================================================

app.post(
  "/api/deposits/verify",
  telegramAuth,
  async (req, res) => {
    try {
      const user =
        req.appUser;

      const txid =
        cleanTxid(
          req.body?.txid
        );

      if (!isValidTxid(txid)) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid TXID. TXID must contain exactly 64 hexadecimal characters."
        });
      }

      const alreadyUsed =
        db.usedTransactions.some(
          (x) =>
            String(x).toLowerCase() ===
            txid.toLowerCase()
        );

      if (alreadyUsed) {
        return res.status(409).json({
          ok: false,
          error:
            "This TXID has already been credited."
        });
      }

      const transfer =
        await findConfirmedUSDTTransfer(
          txid
        );

      if (!transfer) {
        return res.status(404).json({
          ok: false,
          error:
            "No confirmed USDT transfer to the Big Money deposit address was found."
        });
      }

      // Exact recipient check
      if (
        String(
          transfer.to || ""
        ) !==
        String(
          DEPOSIT_ADDRESS
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Transaction recipient does not match the Big Money deposit address."
        });
      }

      // Exact USDT contract check
      if (
        String(
          transfer.contract || ""
        ) !==
        String(
          USDT_CONTRACT
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "The transaction is not the official TRON USDT token."
        });
      }

      const amount =
        roundNumber(
          Number(
            transfer.amount
          ),
          USDT_DECIMALS
        );

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid blockchain amount."
        });
      }

      // ======================================================
      // CREDIT BALANCE
      // ======================================================

      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) + amount,
          USDT_DECIMALS
        );

      // Record deposit
      db.deposits.push({
        id: makeId("dep"),

        telegramUserId:
          String(
            user.telegramUserId
          ),

        txid,

        amount,

        from:
          transfer.from || "",

        to:
          transfer.to ||
          DEPOSIT_ADDRESS,

        contract:
          transfer.contract ||
          USDT_CONTRACT,

        status:
          "confirmed",

        createdAt:
          nowISO(),

        confirmedAt:
          nowISO()
      });

      // Mark TXID used
      db.usedTransactions.push(
        txid
      );

      // ======================================================
      // QUALIFYING DEPOSIT
      // ======================================================

      let becameEligible =
        false;

      if (
        amount >=
        QUALIFYING_DEPOSIT
      ) {
        const wasEligible =
          Boolean(
            user.dailyRewardEligible
          );

        user.dailyRewardEligible =
          true;

        if (
          !user.qualifiedAt
        ) {
          user.qualifiedAt =
            nowISO();
        }

        user.lastQualifyingDeposit =
          roundNumber(
            amount,
            USDT_DECIMALS
          );

        becameEligible =
          !wasEligible;

        // Successful referral
        if (!wasEligible) {
          applyReferralReward(
            user
          );
        }

        // Give today's daily reward
        applyDailyReward(
          user
        );
      }

      saveDB();

      return res.json({
        ok: true,

        credited:
          amount,

        amountUSDT:
          amount,

        transactionId:
          txid,

        balance:
          roundNumber(
            user.balance,
            USDT_DECIMALS
          ),

        qualified:
          Boolean(
            user.dailyRewardEligible
          ),

        becameEligible,

        dailyRewardUSDT:
          DAILY_REWARD_USDT,

        user: {
          telegramUserId:
            String(
              user.telegramUserId
            ),

          balance:
            roundNumber(
              user.balance,
              USDT_DECIMALS
            ),

          points:
            roundNumber(
              Number(
                user.points || 0
              ),
              6
            ),

          successfulReferrals:
            Number(
              user.successfulReferrals ||
                0
            )
        }
      });
    } catch (error) {
      console.error(
        "Deposit verification error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          error.message ||
          "Could not verify the transaction on TRON."
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

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid withdrawal amount"
      });
    }

    if (
      Number(
        user.successfulReferrals ||
          0
      ) <
      REQUIRED_REFERRALS
    ) {
      return res.status(400).json({
        ok: false,
        error:
          `You need ${REQUIRED_REFERRALS} successful referrals before withdrawal.`
      });
    }

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

    const withdrawal = {
      id: makeId("wd"),

      telegramUserId:
        String(
          user.telegramUserId
        ),

      address,

      amount:
        roundNumber(
          amount,
          USDT_DECIMALS
        ),

      status:
        "pending",

      createdAt:
        nowISO()
    };

    // Reserve balance
    user.balance =
      roundNumber(
        Number(
          user.balance || 0
        ) - amount,
        USDT_DECIMALS
      );

    db.withdrawals.push(
      withdrawal
    );

    saveDB();

    res.json({
      ok: true,

      withdrawal,

      balance:
        user.balance
    });
  }
);

// ============================================================
// WITHDRAWAL HISTORY
// ============================================================

app.get(
  "/api/withdrawals",
  telegramAuth,
  (req, res) => {
    const user =
      req.appUser;

    const withdrawals =
      db.withdrawals
        .filter(
          (x) =>
            String(
              x.telegramUserId
            ) ===
            String(
              user.telegramUserId
            )
        )
        .sort(
          (a, b) =>
            String(b.createdAt)
              .localeCompare(
                String(
                  a.createdAt
                )
              )
        );

    res.json({
      ok: true,
      withdrawals
    });
  }
);

// ============================================================
// ADMIN AUTH
// ============================================================

function requireAdmin(
  req,
  res,
  next
) {
  const id =
    String(
      req.telegramUser?.id ||
        ""
    );

  if (
    !ADMIN_TELEGRAM_IDS.includes(
      id
    )
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "Admin access denied"
    });
  }

  next();
}

function adminAuth(
  req,
  res,
  next
) {
  telegramAuth(
    req,
    res,
    () =>
      requireAdmin(
        req,
        res,
        next
      )
  );
}

// ============================================================
// ADMIN - USERS
// ============================================================

app.get(
  "/api/admin/users",
  adminAuth,
  (req, res) => {
    res.json({
      ok: true,

      users:
        db.users.map(
          (user) => ({
            telegramUserId:
              String(
                user.telegramUserId
              ),

            username:
              user.username || "",

            balance:
              Number(
                user.balance || 0
              ),

            points:
              Number(
                user.points || 0
              ),

            totalInvited:
              Number(
                user.totalInvited ||
                  0
              ),

            successfulReferrals:
              Number(
                user.successfulReferrals ||
                  0
              ),

            dailyRewardEligible:
              Boolean(
                user.dailyRewardEligible
              ),

            createdAt:
              user.createdAt
          })
        )
    });
  }
);

// ============================================================
// ADMIN - BALANCE
// ============================================================

app.get(
  "/api/admin/user/:telegramUserId",
  adminAuth,
  (req, res) => {
    const user =
      findUser(
        req.params
          .telegramUserId
      );

    if (!user) {
      return res.status(404).json({
        ok: false,
        error:
          "User not found"
      });
    }

    res.json({
      ok: true,

      user: {
        telegramUserId:
          String(
            user.telegramUserId
          ),

        balance:
          Number(
            user.balance || 0
          ),

        points:
          Number(
            user.points || 0
          ),

        successfulReferrals:
          Number(
            user.successfulReferrals ||
              0
          )
      }
    });
  }
);

// ============================================================
// ADMIN TEST CREDIT
// ============================================================

app.post(
  "/api/admin/test-credit",
  adminAuth,
  (req, res) => {
    const telegramUserId =
      String(
        req.body
          ?.telegramUserId ||
          ""
      ).trim();

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId is required"
      });
    }

    const user =
      findUser(
        telegramUserId
      );

    if (!user) {
      return res.status(404).json({
        ok: false,
        error:
          "User not found"
      });
    }

    user.balance =
      roundNumber(
        Number(
          user.balance || 0
        ) +
          TEST_CREDIT_USDT,
        USDT_DECIMALS
      );

    saveDB();

    res.json({
      ok: true,

      testCredit:
        TEST_CREDIT_USDT,

      balance:
        user.balance,

      note:
        "This is an admin test credit. It is not a blockchain deposit, does not qualify referrals, and does not activate the daily reward."
    });
  }
);

// ============================================================
// ADMIN - WITHDRAWALS
// ============================================================

app.get(
  "/api/admin/withdrawals",
  adminAuth,
  (req, res) => {
    const withdrawals =
      db.withdrawals
        .slice()
        .sort(
          (a, b) =>
            String(b.createdAt)
              .localeCompare(
                String(
                  a.createdAt
                )
              )
        );

    res.json({
      ok: true,
      withdrawals
    });
  }
);

// ============================================================
// ADMIN - APPROVE WITHDRAWAL
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/approve",
  adminAuth,
  (req, res) => {
    const withdrawal =
      db.withdrawals.find(
        (x) =>
          String(x.id) ===
          String(
            req.params.id
          )
      );

    if (!withdrawal) {
      return res.status(404).json({
        ok: false,
        error:
          "Withdrawal not found"
      });
    }

    if (
      withdrawal.status !==
      "pending"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Withdrawal is not pending"
      });
    }

    withdrawal.status =
      "approved";

    withdrawal.approvedAt =
      nowISO();

    saveDB();

    res.json({
      ok: true,
      withdrawal
    });
  }
);

// ============================================================
// ADMIN - REJECT WITHDRAWAL
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/reject",
  adminAuth,
  (req, res) => {
    const withdrawal =
      db.withdrawals.find(
        (x) =>
          String(x.id) ===
          String(
            req.params.id
          )
      );

    if (!withdrawal) {
      return res.status(404).json({
        ok: false,
        error:
          "Withdrawal not found"
      });
    }

    if (
      withdrawal.status !==
      "pending"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Withdrawal is not pending"
      });
    }

    const user =
      findUser(
        withdrawal.telegramUserId
      );

    if (user) {
      user.balance =
        roundNumber(
          Number(
            user.balance || 0
          ) +
            Number(
              withdrawal.amount ||
                0
            ),
          USDT_DECIMALS
        );
    }

    withdrawal.status =
      "rejected";

    withdrawal.rejectedAt =
      nowISO();

    saveDB();

    res.json({
      ok: true,

      withdrawal,

      refunded:
        Number(
          withdrawal.amount || 0
        ),

      balance:
        user
          ? user.balance
          : null
    });
  }
);

// ============================================================
// ADMIN - MARK WITHDRAWAL PAID
// ============================================================

app.post(
  "/api/admin/withdrawals/:id/paid",
  adminAuth,
  (req, res) => {
    const withdrawal =
      db.withdrawals.find(
        (x) =>
          String(x.id) ===
          String(
            req.params.id
          )
      );

    if (!withdrawal) {
      return res.status(404).json({
        ok: false,
        error:
          "Withdrawal not found"
      });
    }

    if (
      withdrawal.status !==
      "approved"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Withdrawal must be approved first"
      });
    }

    const txid =
      cleanTxid(
        req.body?.txid
      );

    if (
      txid &&
      !isValidTxid(txid)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid payment TXID"
      });
    }

    withdrawal.status =
      "paid";

    withdrawal.paidAt =
      nowISO();

    withdrawal.paymentTxid =
      txid || null;

    saveDB();

    res.json({
      ok: true,
      withdrawal
    });
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "Endpoint not found"
    });
  }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "Server error:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Internal server error"
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Big Money Backend running on port ${PORT}`
    );

    console.log(
      "Deposit address:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "USDT contract:",
      USDT_CONTRACT
    );

    console.log(
      "Daily reward:",
      DAILY_REWARD_USDT,
      "USDT"
    );
  }
);

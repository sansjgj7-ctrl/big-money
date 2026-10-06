const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
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

/* =========================================================
   SUPABASE
========================================================= */

const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").trim();

const SUPABASE_SECRET_KEY =
  String(process.env.SUPABASE_SECRET_KEY || "").trim();

const SUPABASE_TABLE = "big_money_store";

/* =========================================================
   BIG MONEY RULES
========================================================= */

const QUALIFYING_DEPOSIT = 10;

const DAILY_REWARD_USDT = 5;

const DAILY_REWARD_INTERVAL_MS =
  24 * 60 * 60 * 1000;

const REFERRAL_REWARD_POINTS = 0;

const REQUIRED_REFERRALS = 5;

const POINT_USDT_RATE = 1;

const TEST_CREDIT_USDT = 10;

/* =========================================================
   EXPRESS
========================================================= */

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        origin === ALLOWED_ORIGIN ||
        origin === "https://telegram.org" ||
        origin === "https://web.telegram.org"
      ) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-Telegram-Init-Data"
    ]
  })
);

app.use(express.json({ limit: "100kb" }));

/* =========================================================
   DATABASE - SUPABASE PERSISTENT STORAGE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "big-money-data.json");

function emptyDatabase() {
  return {
    users: [],
    deposits: [],
    withdrawals: [],
    usedTransactions: [],
    pointConversions: []
  };
}

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        emptyDatabase(),
        null,
        2
      )
    );
  }
}

function normalizeDatabase(data) {
  if (!data || typeof data !== "object") {
    data = emptyDatabase();
  }

  if (!Array.isArray(data.users)) {
    data.users = [];
  }

  if (!Array.isArray(data.deposits)) {
    data.deposits = [];
  }

  if (!Array.isArray(data.withdrawals)) {
    data.withdrawals = [];
  }

  if (!Array.isArray(data.usedTransactions)) {
    data.usedTransactions = [];
  }

  if (!Array.isArray(data.pointConversions)) {
    data.pointConversions = [];
  }

  return data;
}

function loadLocalDatabase() {
  try {
    ensureDatabase();

    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );

    return normalizeDatabase(
      JSON.parse(raw)
    );
  } catch (error) {
    console.error(
      "Local database load error:",
      error
    );

    return emptyDatabase();
  }
}

function saveLocalDatabase(data) {
  try {
    ensureDatabase();

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        data,
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "Local database save error:",
      error
    );
  }
}

function supabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SECRET_KEY
  );
}

function supabaseHeaders() {
  return {
    apikey:
      SUPABASE_SECRET_KEY,

    Authorization:
      `Bearer ${SUPABASE_SECRET_KEY}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json"
  };
}

async function supabaseGetDatabase() {
  if (!supabaseConfigured()) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SECRET_KEY is missing"
    );
  }

  const url =
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
    `?id=eq.1&select=id,data,updated_at`;

  let response;

try {
  response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders()
  });
} catch (error) {
  throw new Error(
    `Supabase GET connection failed: ${error?.message || String(error)}`
  );
}

    });
} catch (error) {
  throw new Error(
    `Supabase SAVE connection failed: ${error?.message || String(error)}`
  );
}

  if (!response.ok) {
    throw new Error(
      `Supabase GET ${response.status}: ${text}`
    );
  }

  let result = [];

  try {
    result =
      text
        ? JSON.parse(text)
        : [];
  } catch {
    result = [];
  }

  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    return null;
  }

  return normalizeDatabase(
    result[0].data
  );
}

async function supabaseSaveDatabase(data) {
  if (!supabaseConfigured()) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SECRET_KEY is missing"
    );
  }

  const url =
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;

  let response;

try {
  response = await fetch(url, {
      method: "POST",

      headers: {
        ...supabaseHeaders(),

        Prefer:
          "resolution=merge-duplicates,return=minimal"
      },

      body:
        JSON.stringify({
          id: 1,

          data:
            normalizeDatabase(data),

          updated_at:
            new Date().toISOString()
        })
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase SAVE ${response.status}: ${text}`
    );
  }
}

let db =
  emptyDatabase();

let saveQueue =
  Promise.resolve();

function saveDatabase() {
  const snapshot =
    JSON.parse(
      JSON.stringify(
        normalizeDatabase(db)
      )
    );

  /*
     Keep a local backup too.
  */
  saveLocalDatabase(
    snapshot
  );

  if (!supabaseConfigured()) {
    console.warn(
      "Supabase is not configured. Using local database."
    );

    return saveQueue;
  }

  /*
     Queue saves so multiple balance/deposit changes
     cannot overwrite each other out of order.
  */
  saveQueue =
    saveQueue.then(
      async () => {
        try {
          await supabaseSaveDatabase(
            snapshot
          );

          console.log(
            "Database saved to Supabase."
          );
        } catch (error) {
          console.error(
            "Supabase save error:",
            error.message
          );
        }
      }
    );

  return saveQueue;
}

async function loadDatabase() {
  const localData =
    loadLocalDatabase();

  if (!supabaseConfigured()) {
    console.warn(
      "SUPABASE_URL / SUPABASE_SECRET_KEY not configured."
    );

    db =
      localData;

    return;
  }

  try {
    const remoteData =
      await supabaseGetDatabase();

    /*
       First startup after enabling Supabase:
       migrate existing local data.
    */
    if (!remoteData) {
      db =
        localData;

      await supabaseSaveDatabase(
        db
      );

      console.log(
        "Local database migrated to Supabase."
      );

      return;
    }

    /*
       Supabase becomes the main persistent database.
    */
    db =
      normalizeDatabase(
        remoteData
      );

    console.log(
      "Database loaded from Supabase."
    );

    console.log(
      `Users: ${db.users.length}`
    );

    console.log(
      `Deposits: ${db.deposits.length}`
    );

    console.log(
      `Withdrawals: ${db.withdrawals.length}`
    );
  } catch (error) {
    console.error(
      "Supabase database load error:",
      error.message
    );

    /*
       If Supabase is temporarily unavailable,
       keep using the local backup instead of
       destroying the account data.
    */
    db =
      localData;

    console.warn(
      "Using local backup database."
    );
  }
}

/* =========================================================
   HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function roundNumber(
  value,
  decimals = USDT_DECIMALS
) {
  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  const factor =
    Math.pow(
      10,
      decimals
    );

  return (
    Math.round(
      n * factor
    ) / factor
  );
}

function safeNumber(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function normalizeTelegramId(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function findUser(
  telegramUserId
) {
  const id =
    normalizeTelegramId(
      telegramUserId
    );

  return db.users.find(
    user =>
      normalizeTelegramId(
        user.telegramUserId
      ) === id
  );
}

/* =========================================================
   USER MIGRATION
========================================================= */

function migrateUser(user) {
  if (!user) {
    return user;
  }

  if (!Array.isArray(user.referrals)) {
    user.referrals = [];
  }

  if (!Array.isArray(user.dailyRewards)) {
    user.dailyRewards = [];
  }

  if (!Array.isArray(user.pointConversions)) {
    user.pointConversions = [];
  }

  if (!Array.isArray(user.transactions)) {
    user.transactions = [];
  }

  if (!Array.isArray(user.deposits)) {
    user.deposits = [];
  }

  if (!Array.isArray(user.withdrawals)) {
    user.withdrawals = [];
  }

  if (
    typeof user.balance !==
    "number"
  ) {
    user.balance =
      safeNumber(
        user.balance
      );
  }

  if (
    typeof user.points !==
    "number"
  ) {
    user.points =
      safeNumber(
        user.points
      );
  }

  if (
    typeof user.totalInvited !==
    "number"
  ) {
    user.totalInvited =
      user.referrals.length;
  }

  if (
    typeof user.successfulReferrals !==
    "number"
  ) {
    user.successfulReferrals =
      user.referrals.filter(
        x =>
          x &&
          x.successful
      ).length;
  }

  if (!("referredBy" in user)) {
    user.referredBy =
      null;
  }

  if (
    !("dailyRewardEligible" in user)
  ) {
    user.dailyRewardEligible =
      false;
  }

  if (!("qualifiedAt" in user)) {
    user.qualifiedAt =
      null;
  }

  if (
    !("lastQualifyingDeposit" in user)
  ) {
    user.lastQualifyingDeposit =
      0;
  }

  if (
    !("lastDailyRewardAt" in user)
  ) {
    user.lastDailyRewardAt =
      null;
  }

  if (!("createdAt" in user)) {
    user.createdAt =
      nowISO();
  }

  if (!("updatedAt" in user)) {
    user.updatedAt =
      nowISO();
  }

  return user;
}

/* =========================================================
   TELEGRAM WEBAPP AUTH
========================================================= */

function verifyTelegramInitData(
  initData
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  if (
    !initData ||
    typeof initData !==
      "string"
  ) {
    throw new Error(
      "Telegram initData is missing"
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
      "Telegram hash is missing"
    );
  }

  const authDate =
    Number(
      params.get(
        "auth_date"
      )
    );

  if (!authDate) {
    throw new Error(
      "Telegram auth_date is missing"
    );
  }

  const currentTime =
    Math.floor(
      Date.now() / 1000
    );

  if (
    currentTime - authDate >
      24 * 60 * 60 ||
    currentTime - authDate <
      -60
  ) {
    throw new Error(
      "Telegram initData expired"
    );
  }

  const dataCheckArray =
    [];

  for (
    const [
      key,
      value
    ] of params.entries()
  ) {
    if (key === "hash") {
      continue;
    }

    dataCheckArray.push(
      `${key}=${value}`
    );
  }

  dataCheckArray.sort();

  const dataCheckString =
    dataCheckArray.join(
      "\n"
    );

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
      .digest(
        "hex"
      );

  const receivedHash =
    String(hash);

  if (
    calculatedHash.length !==
    receivedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(
        calculatedHash
      ),
      Buffer.from(
        receivedHash
      )
    )
  ) {
    throw new Error(
      "Invalid Telegram signature"
    );
  }

  let telegramUser =
    null;

  const userRaw =
    params.get("user");

  if (userRaw) {
    try {
      telegramUser =
        JSON.parse(
          userRaw
        );
    } catch {
      throw new Error(
        "Invalid Telegram user data"
      );
    }
  }

  if (
    !telegramUser ||
    telegramUser.id ===
      undefined ||
    telegramUser.id ===
      null
  ) {
    throw new Error(
      "Telegram user is missing"
    );
  }

  return {
    telegramUser,

    startParam:
      params.get(
        "start_param"
      ) ||
      params.get(
        "startapp"
      ) ||
      ""
  };
}

/* =========================================================
   GET INIT DATA FROM REQUEST
========================================================= */

function getInitDataFromRequest(
  req
) {
  return (
    req.headers[
      "x-telegram-init-data"
    ] ||
    req.body?.initData ||
    req.query?.initData ||
    ""
  );
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function telegramAuth(
  req,
  res,
  next
) {
  try {
    const initData =
      getInitDataFromRequest(
        req
      );

    const result =
      verifyTelegramInitData(
        initData
      );

    req.telegramUser =
      result.telegramUser;

    req.startParam =
      result.startParam;

    next();
  } catch (error) {
    console.error(
      "Telegram auth error:",
      error.message
    );

    return res.status(401).json({
      ok: false,
      error:
        error.message
    });
  }
}

/* =========================================================
   REFERRAL
========================================================= */

function parseReferralId(
  startParam
) {
  if (!startParam) {
    return null;
  }

  const value =
    String(
      startParam
    ).trim();

  if (
    value.startsWith(
      "ref_"
    )
  ) {
    return (
      value
        .slice(4)
        .trim() ||
      null
    );
  }

  if (
    value.startsWith(
      "ref"
    )
  ) {
    const withoutPrefix =
      value
        .slice(3)
        .replace(
          /^[_-]/,
          ""
        )
        .trim();

    return (
      withoutPrefix ||
      null
    );
  }

  return null;
}

function registerReferral(
  newUser,
  startParam
) {
  if (!newUser) {
    return false;
  }

  if (newUser.referredBy) {
    return false;
  }

  const referrerId =
    parseReferralId(
      startParam
    );

  if (!referrerId) {
    return false;
  }

  if (
    normalizeTelegramId(
      referrerId
    ) ===
    normalizeTelegramId(
      newUser.telegramUserId
    )
  ) {
    console.log(
      "Self referral blocked:",
      newUser.telegramUserId
    );

    return false;
  }

  const referrer =
    findUser(
      referrerId
    );

  if (!referrer) {
    console.log(
      "Referrer not found:",
      referrerId
    );

    return false;
  }

  migrateUser(
    referrer
  );

  const existingReferral =
    referrer.referrals.find(
      item =>
        normalizeTelegramId(
          item.telegramUserId
        ) ===
        normalizeTelegramId(
          newUser.telegramUserId
        )
    );

  if (!existingReferral) {
    referrer.referrals.push({
      telegramUserId:
        newUser.telegramUserId,

      firstName:
        newUser.firstName ||
        "",

      username:
        newUser.username ||
        "",

      successful: false,

      successfulAt:
        null,

      createdAt:
        nowISO()
    });
  }

  newUser.referredBy =
    referrerId;

  referrer.totalInvited =
    referrer.referrals.length;

  referrer.updatedAt =
    nowISO();

  saveDatabase();

  console.log(
    `Referral registered: ${newUser.telegramUserId} -> ${referrerId}`
  );

  return true;
}

/* =========================================================
   SUCCESSFUL REFERRAL
========================================================= */

function applyReferralReward(
  depositedUser
) {
  if (!depositedUser) {
    return false;
  }

  if (
    !depositedUser.referredBy
  ) {
    return false;
  }

  const referrer =
    findUser(
      depositedUser.referredBy
    );

  if (!referrer) {
    console.log(
      "Referral referrer not found:",
      depositedUser.referredBy
    );

    return false;
  }

  migrateUser(
    referrer
  );

  let referral =
    referrer.referrals.find(
      item =>
        normalizeTelegramId(
          item.telegramUserId
        ) ===
        normalizeTelegramId(
          depositedUser.telegramUserId
        )
    );

  if (!referral) {
    referral = {
      telegramUserId:
        depositedUser.telegramUserId,

      firstName:
        depositedUser.firstName ||
        "",

      username:
        depositedUser.username ||
        "",

      successful:
        false,

      successfulAt:
        null,

      createdAt:
        nowISO()
    };

    referrer.referrals.push(
      referral
    );
  }

  if (referral.successful) {
    return false;
  }

  referral.successful =
    true;

  referral.successfulAt =
    nowISO();

  referrer.successfulReferrals =
    referrer.referrals.filter(
      item =>
        item.successful === true
    ).length;

  /*
     No referral points.
  */
  referrer.points =
    safeNumber(
      referrer.points
    );

  referrer.updatedAt =
    nowISO();

  saveDatabase();

  console.log(
    `Successful referral: ${depositedUser.telegramUserId} -> ${referrer.telegramUserId}`
  );

  return true;
}

/* =========================================================
   DAILY REWARD
========================================================= */

function getDailyRewardStatus(
  user
) {
  if (!user) {
    return {
      amount:
        DAILY_REWARD_USDT,

      eligible:
        false,

      canClaim:
        false,

      lastRewardAt:
        null,

      nextRewardAt:
        null,

      remainingSeconds:
        null
    };
  }

  migrateUser(
    user
  );

  if (
    !user.dailyRewardEligible
  ) {
    return {
      amount:
        DAILY_REWARD_USDT,

      eligible:
        false,

      canClaim:
        false,

      lastRewardAt:
        user.lastDailyRewardAt ||
        null,

      nextRewardAt:
        null,

      remainingSeconds:
        null
    };
  }

  if (
    !user.lastDailyRewardAt
  ) {
    return {
      amount:
        DAILY_REWARD_USDT,

      eligible:
        true,

      canClaim:
        true,

      lastRewardAt:
        null,

      nextRewardAt:
        null,

      remainingSeconds:
        0
    };
  }

  const last =
    new Date(
      user.lastDailyRewardAt
    ).getTime();

  if (!Number.isFinite(last)) {
    user.lastDailyRewardAt =
      null;

    return {
      amount:
        DAILY_REWARD_USDT,

      eligible:
        true,

      canClaim:
        true,

      lastRewardAt:
        null,

      nextRewardAt:
        null,

      remainingSeconds:
        0
    };
  }

  const next =
    last +
    DAILY_REWARD_INTERVAL_MS;

  const remaining =
    Math.max(
      0,
      next -
        Date.now()
    );

  return {
    amount:
      DAILY_REWARD_USDT,

    eligible:
      true,

    canClaim:
      remaining === 0,

    lastRewardAt:
      user.lastDailyRewardAt,

    nextRewardAt:
      new Date(
        next
      ).toISOString(),

    remainingSeconds:
      Math.ceil(
        remaining / 1000
      )
  };
}

/* =========================================================
   APPLY DAILY REWARD
========================================================= */

function applyDailyReward(
  user
) {
  if (!user) {
    return {
      awarded:
        false,

      amount:
        0,

      reason:
        "User not found",

      nextRewardAt:
        null,

      remainingSeconds:
        null
    };
  }

  migrateUser(
    user
  );

  if (
    !user.dailyRewardEligible
  ) {
    return {
      awarded:
        false,

      amount:
        0,

      reason:
        "You need a confirmed deposit of at least 10 USDT first.",

      nextRewardAt:
        null,

      remainingSeconds:
        null
    };
  }

  const now =
    Date.now();

  let last =
    0;

  if (
    user.lastDailyRewardAt
  ) {
    last =
      new Date(
        user.lastDailyRewardAt
      ).getTime();

    if (!Number.isFinite(last)) {
      last =
        0;

      user.lastDailyRewardAt =
        null;
    }
  }

  if (
    last > 0 &&
    now - last <
      DAILY_REWARD_INTERVAL_MS
  ) {
    const next =
      last +
      DAILY_REWARD_INTERVAL_MS;

    const remaining =
      Math.max(
        0,
        next -
          now
      );

    return {
      awarded:
        false,

      amount:
        0,

      reason:
        "Daily reward is available every 24 hours.",

      nextRewardAt:
        new Date(
          next
        ).toISOString(),

      remainingSeconds:
        Math.ceil(
          remaining / 1000
        )
    };
  }

  user.balance =
    roundNumber(
      safeNumber(
        user.balance
      ) +
        DAILY_REWARD_USDT
    );

  const rewardTime =
    new Date(
      now
    ).toISOString();

  user.lastDailyRewardAt =
    rewardTime;

  if (!Array.isArray(user.dailyRewards)) {
    user.dailyRewards =
      [];
  }

  user.dailyRewards.push(
    rewardTime
  );

  user.updatedAt =
    rewardTime;

  saveDatabase();

  const next =
    now +
    DAILY_REWARD_INTERVAL_MS;

  return {
    awarded:
      true,

    amount:
      DAILY_REWARD_USDT,

    reason:
      "Daily reward successfully added.",

    nextRewardAt:
      new Date(
        next
      ).toISOString(),

    remainingSeconds:
      24 * 60 * 60
  };
}

/* =========================================================
   USER
========================================================= */

function ensureUser(
  telegramUser
) {
  const telegramUserId =
    normalizeTelegramId(
      telegramUser.id
    );

  let user =
    findUser(
      telegramUserId
    );

  if (!user) {
    user = {
      telegramUserId,

      firstName:
        telegramUser.first_name ||
        "",

      lastName:
        telegramUser.last_name ||
        "",

      username:
        telegramUser.username ||
        "",

      languageCode:
        telegramUser.language_code ||
        "",

      balance:
        0,

      points:
        0,

      referrals:
        [],

      totalInvited:
        0,

      successfulReferrals:
        0,

      referredBy:
        null,

      referralRewardGiven:
        false,

      deposits:
        [],

      withdrawals:
        [],

      transactions:
        [],

      dailyRewards:
        [],

      dailyRewardEligible:
        false,

      qualifiedAt:
        null,

      lastQualifyingDeposit:
        0,

      lastDailyRewardAt:
        null,

      createdAt:
        nowISO(),

      updatedAt:
        nowISO()
    };

    db.users.push(
      user
    );

    saveDatabase();
  } else {
    migrateUser(
      user
    );

    user.firstName =
      telegramUser.first_name ||
      user.firstName ||
      "";

    user.lastName =
      telegramUser.last_name ||
      user.lastName ||
      "";

    user.username =
      telegramUser.username ||
      user.username ||
      "";

    user.languageCode =
      telegramUser.language_code ||
      user.languageCode ||
      "";

    user.updatedAt =
      nowISO();

    saveDatabase();
  }

  return user;
}

/* =========================================================
   ACCOUNT RESPONSE
========================================================= */

function accountResponse(
  user
) {
  migrateUser(
    user
  );

  const dailyReward =
    getDailyRewardStatus(
      user
    );

  const successfulReferrals =
    user.referrals.filter(
      x =>
        x &&
        x.successful === true
    ).length;

  user.successfulReferrals =
    successfulReferrals;

  const pendingWithdrawals =
    db.withdrawals.filter(
      withdrawal =>
        normalizeTelegramId(
          withdrawal.telegramUserId
        ) ===
          normalizeTelegramId(
            user.telegramUserId
          ) &&
        withdrawal.status ===
          "pending"
    );

  const availableBalance =
    roundNumber(
      safeNumber(
        user.balance
      )
    );

  return {
    ok:
      true,

    user: {
      telegramUserId:
        user.telegramUserId,

      firstName:
        user.firstName,

      lastName:
        user.lastName,

      username:
        user.username
    },

    balance:
      availableBalance,

    points:
      safeNumber(
        user.points
      ),

    referrals:
      user.referrals,

    totalInvited:
      user.referrals.length,

    successfulReferrals,

    withdrawalRequirement:
      REQUIRED_REFERRALS,

    withdrawalEligible:
      successfulReferrals >=
      REQUIRED_REFERRALS,

    referredBy:
      user.referredBy,

    dailyReward,

    pendingWithdrawals:
      pendingWithdrawals.length,

    deposits:
      user.deposits ||
      [],

    withdrawals:
      user.withdrawals ||
      [],

    transactions:
      user.transactions ||
      []
  };
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/",
  (req, res) => {
    res.json({
      ok:
        true,

      name:
        "Big Money API",

      status:
        "online",

      time:
        nowISO()
    });
  }
);

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok:
        true,

      status:
        "online",

      time:
        nowISO(),

      supabase:
        supabaseConfigured()
    });
  }
);

/* =========================================================
   CONFIG
========================================================= */

app.get(
  "/api/config",
  (req, res) => {
    res.json({
      ok:
        true,

      depositAddress:
        DEPOSIT_ADDRESS,

      usdtContract:
        USDT_CONTRACT,

      usdtDecimals:
        USDT_DECIMALS,

      minimumDeposit:
        5,

      qualifyingDeposit:
        QUALIFYING_DEPOSIT,

      dailyReward:
        DAILY_REWARD_USDT,

      dailyRewardIntervalHours:
        24,

      referralRewardPoints:
        REFERRAL_REWARD_POINTS,

      requiredReferrals:
        REQUIRED_REFERRALS,

      pointUsdtRate:
        POINT_USDT_RATE
    });
  }
);

/* =========================================================
   ACCOUNT
========================================================= */

app.post(
  "/api/account",
  telegramAuth,
  (req, res) => {
    try {
      const user =
        ensureUser(
          req.telegramUser
        );

      if (req.startParam) {
        registerReferral(
          user,
          req.startParam
        );
      }

      return res.json(
        accountResponse(
          user
        )
      );
    } catch (error) {
      console.error(
        "Account error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to load account"
      });
    }
  }
);

/* =========================================================
   SECURE ACCOUNT GET
========================================================= */

app.get(
  "/api/account/:telegramUserId",
  telegramAuth,
  (req, res) => {
    try {
      const requestedId =
        normalizeTelegramId(
          req.params.telegramUserId
        );

      const authenticatedId =
        normalizeTelegramId(
          req.telegramUser.id
        );

      if (
        requestedId !==
        authenticatedId
      ) {
        return res.status(403).json({
          ok:
            false,

          error:
            "Access denied."
        });
      }

      const user =
        ensureUser(
          req.telegramUser
        );

      if (req.startParam) {
        registerReferral(
          user,
          req.startParam
        );
      }

      return res.json(
        accountResponse(
          user
        )
      );
    } catch (error) {
      console.error(
        "Account GET error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to load account."
      });
    }
  }
);

/* =========================================================
   TRONGRID
========================================================= */

async function tronGet(
  url
) {
  const headers = {
    Accept:
      "application/json"
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
        method:
          "GET",

        headers
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(
        text
      );
  } catch {
    data = {
      raw:
        text
    };
  }

  if (!response.ok) {
    throw new Error(
      `TronGrid HTTP ${response.status}`
    );
  }

  return data;
}

/* =========================================================
   TXID VALIDATION
========================================================= */

function isValidTxid(
  txid
) {
  return /^[a-fA-F0-9]{64}$/.test(
    String(
      txid || ""
    ).trim()
  );
}

/* =========================================================
   TRON TRANSFER HELPERS
========================================================= */

function normalizeAddress(
  address
) {
  return String(
    address || ""
  )
    .trim()
    .toLowerCase();
}

function transferMatches(
  transfer,
  expectedRecipient
) {
  if (!transfer) {
    return false;
  }

  const contract =
    transfer.token_info?.address ||
    transfer.contract_address ||
    transfer.tokenAddress ||
    "";

  const to =
    transfer.to ||
    transfer.to_address ||
    transfer.toAddress ||
    "";

  const transactionId =
    transfer.transaction_id ||
    transfer.txID ||
    transfer.txid ||
    "";

  return (
    normalizeAddress(
      contract
    ) ===
      normalizeAddress(
        USDT_CONTRACT
      ) &&
    normalizeAddress(
      to
    ) ===
      normalizeAddress(
        expectedRecipient
      ) &&
    String(
      transactionId
    ).toLowerCase() !==
      ""
  );
}

function transferAmount(
  transfer
) {
  if (
    transfer.value !==
    undefined
  ) {
    return (
      Number(
        transfer.value
      ) /
      Math.pow(
        10,
        USDT_DECIMALS
      )
    );
  }

  if (
    transfer.amount !==
    undefined
  ) {
    return Number(
      transfer.amount
    );
  }

  return 0;
}

/* =========================================================
   FIND TRANSFER FROM TRC20 HISTORY
========================================================= */

async function findTransferFromHistory(
  txid,
  expectedRecipient
) {
  const url =
    `${TRONGRID_URL}/v1/accounts/` +
    `${encodeURIComponent(
      expectedRecipient
    )}` +
    `/transactions/trc20` +
    `?limit=200` +
    `&only_confirmed=true` +
    `&only_to=true` +
    `&contract_address=${encodeURIComponent(
      USDT_CONTRACT
    )}`;

  try {
    const result =
      await tronGet(
        url
      );

    const transfers =
      Array.isArray(
        result.data
      )
        ? result.data
        : [];

    const matches =
      transfers.filter(
        transfer =>
          String(
            transfer.transaction_id ||
              transfer.txID ||
              ""
          ).toLowerCase() ===
            String(
              txid
            ).toLowerCase() &&
          transferMatches(
            transfer,
            expectedRecipient
          )
      );

    if (!matches.length) {
      return null;
    }

    return matches[0];
  } catch (error) {
    console.error(
      "TRC20 history error:",
      error.message
    );

    return null;
  }
}

/* =========================================================
   FIND TRANSFER FROM EVENTS
========================================================= */

async function findTransferFromEvents(
  txid,
  expectedRecipient
) {
  const url =
    `${TRONGRID_URL}/v1/contracts/` +
    `${encodeURIComponent(
      USDT_CONTRACT
    )}` +
    `/events/Transfer` +
    `?limit=200` +
    `&only_confirmed=true`;

  try {
    const result =
      await tronGet(
        url
      );

    const events =
      Array.isArray(
        result.data
      )
        ? result.data
        : [];

    for (
      const event of events
    ) {
      const eventTx =
        event.transaction_id ||
        event.transactionId ||
        "";

      if (
        String(
          eventTx
        ).toLowerCase() !==
        String(
          txid
        ).toLowerCase()
      ) {
        continue;
      }

      const resultData =
        event.result ||
        {};

      const to =
        resultData.to ||
        resultData._to ||
        event.to ||
        "";

      const value =
        resultData.value ||
        resultData._value ||
        event.value ||
        "0";

      if (
        normalizeAddress(
          to
        ) !==
        normalizeAddress(
          expectedRecipient
        )
      ) {
        continue;
      }

      return {
        transaction_id:
          txid,

        to,

        value,

        token_info: {
          address:
            USDT_CONTRACT,

          symbol:
            "USDT",

          decimals:
            USDT_DECIMALS
        }
      };
    }
  } catch (error) {
    console.error(
      "TRC20 event error:",
      error.message
    );
  }

  return null;
}

/* =========================================================
   VERIFY SOLIDIFIED TRANSACTION
========================================================= */

async function verifyTransactionConfirmed(
  txid
) {
  const url =
    `${TRONGRID_URL}/wallet/gettransactionbyid?value=${encodeURIComponent(
      txid
    )}`;

  try {
    const tx =
      await tronGet(
        url
      );

    if (
      !tx ||
      !tx.txID
    ) {
      return {
        ok:
          false,

        reason:
          "Transaction not found"
      };
    }

    const contractRet =
      tx.ret?.[0]?.contractRet;

    if (
      contractRet &&
      contractRet !==
        "SUCCESS"
    ) {
      return {
        ok:
          false,

        reason:
          "Transaction failed"
      };
    }

    const infoUrl =
      `${TRONGRID_URL}/wallet/gettransactioninfobyid?value=${encodeURIComponent(
        txid
      )}`;

    const info =
      await tronGet(
        infoUrl
      );

    if (
      info &&
      info.receipt &&
      info.receipt.result &&
      info.receipt.result !==
        "SUCCESS"
    ) {
      return {
        ok:
          false,

        reason:
          "Transaction receipt failed"
      };
    }

    if (
      info &&
      info.blockNumber ===
        undefined &&
      info.block_timestamp ===
        undefined
    ) {
      return {
        ok:
          false,

        reason:
          "Transaction is not confirmed yet"
      };
    }

    return {
      ok:
        true,

      transaction:
        tx,

      info
    };
  } catch (error) {
    console.error(
      "Transaction confirmation error:",
      error.message
    );

    return {
      ok:
        false,

      reason:
        "Unable to verify transaction"
    };
  }
}

/* =========================================================
   DEPOSIT CHECK
========================================================= */

app.post(
  "/api/deposits/check",
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
        return res.status(400).json({
          ok:
            false,

          error:
            "Invalid TXID. TXID must contain 64 hexadecimal characters."
        });
      }

      const used =
        db.usedTransactions.find(
          item =>
            String(
              item.txid
            ).toLowerCase() ===
            txid.toLowerCase()
        );

      if (used) {
        return res.json({
          ok:
            true,

          found:
            true,

          alreadyUsed:
            true,

          message:
            "This transaction has already been used."
        });
      }

      const transfer =
        (await findTransferFromEvents(
          txid,
          DEPOSIT_ADDRESS
        )) ||
        (await findTransferFromHistory(
          txid,
          DEPOSIT_ADDRESS
        ));

      if (!transfer) {
        return res.json({
          ok:
            true,

          found:
            false,

          alreadyUsed:
            false,

          message:
            "Confirmed USDT transfer was not found yet."
        });
      }

      const amount =
        roundNumber(
          transferAmount(
            transfer
          )
        );

      return res.json({
        ok:
          true,

        found:
          true,

        alreadyUsed:
          false,

        txid,

        amount,

        recipient:
          DEPOSIT_ADDRESS,

        contract:
          USDT_CONTRACT
      });
    } catch (error) {
      console.error(
        "Deposit check error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Blockchain check failed"
      });
    }
  }
);

/* =========================================================
   VERIFY DEPOSIT
========================================================= */

app.post(
  "/api/deposits/verify",
  telegramAuth,
  async (
    req,
    res
  ) => {
    try {
      const user =
        ensureUser(
          req.telegramUser
        );

      if (req.startParam) {
        registerReferral(
          user,
          req.startParam
        );
      }

      const txid =
        String(
          req.body?.txid ||
            ""
        ).trim();

      const submittedAmount =
        Number(
          req.body?.amount
        );

      if (
        !isValidTxid(
          txid
        )
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "TXID must be exactly 64 hexadecimal characters."
        });
      }

      if (
        !Number.isFinite(
          submittedAmount
        ) ||
        submittedAmount <=
          0
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Invalid deposit amount."
        });
      }

      const alreadyUsed =
        db.usedTransactions.find(
          item =>
            String(
              item.txid
            ).toLowerCase() ===
            txid.toLowerCase()
        );

      if (alreadyUsed) {
        return res.status(400).json({
          ok:
            false,

          error:
            "This transaction has already been used."
        });
      }

      const confirmation =
        await verifyTransactionConfirmed(
          txid
        );

      if (!confirmation.ok) {
        return res.status(400).json({
          ok:
            false,

          error:
            confirmation.reason ||
            "Transaction is not confirmed yet."
        });
      }

      const transfer =
        (await findTransferFromEvents(
          txid,
          DEPOSIT_ADDRESS
        )) ||
        (await findTransferFromHistory(
          txid,
          DEPOSIT_ADDRESS
        ));

      if (!transfer) {
        return res.status(400).json({
          ok:
            false,

          error:
            "No confirmed USDT TRC20 transfer to the Big Money deposit address was found."
        });
      }

      const blockchainAmount =
        roundNumber(
          transferAmount(
            transfer
          )
        );

      if (
        !Number.isFinite(
          blockchainAmount
        ) ||
        blockchainAmount <=
          0
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Invalid blockchain amount."
        });
      }

      const amountDifference =
        Math.abs(
          blockchainAmount -
            submittedAmount
        );

      if (
        amountDifference >
        0.000001
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            `Amount mismatch. Blockchain amount is ${blockchainAmount} USDT.`
        });
      }

      const amount =
        blockchainAmount;

      db.usedTransactions.push({
        txid,

        telegramUserId:
          user.telegramUserId,

        amount,

        createdAt:
          nowISO()
      });

      user.balance =
        roundNumber(
          safeNumber(
            user.balance
          ) +
            amount
        );

      const deposit = {
        id:
          crypto.randomUUID
            ? crypto.randomUUID()
            : crypto.randomBytes(
                16
              ).toString(
                "hex"
              ),

        telegramUserId:
          user.telegramUserId,

        txid,

        amount,

        recipient:
          DEPOSIT_ADDRESS,

        contract:
          USDT_CONTRACT,

        status:
          "confirmed",

        createdAt:
          nowISO()
      };

      db.deposits.push(
        deposit
      );

      if (
        !Array.isArray(
          user.deposits
        )
      ) {
        user.deposits =
          [];
      }

      user.deposits.push(
        deposit
      );

      if (
        !Array.isArray(
          user.transactions
        )
      ) {
        user.transactions =
          [];
      }

      user.transactions.unshift({
        type:
          "deposit",

        amount,

        txid,

        status:
          "confirmed",

        createdAt:
          nowISO()
      });

      /*
         QUALIFYING DEPOSIT >= 10 USDT
      */
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

        if (!user.qualifiedAt) {
          user.qualifiedAt =
            nowISO();
        }

        user.lastQualifyingDeposit =
          amount;

        /*
           Mark referral successful once.
           No referral points are added.
        */
        const referralSuccessful =
          applyReferralReward(
            user
          );

        /*
           First qualifying deposit can immediately
           receive the 5 USDT daily reward.
        */
        const dailyReward =
          applyDailyReward(
            user
          );

        user.updatedAt =
          nowISO();

        saveDatabase();

        return res.json({
          ok:
            true,

          verified:
            true,

          amount,

          balance:
            user.balance,

          qualifyingDeposit:
            true,

          becameEligible:
            !wasEligible,

          referralSuccessful,

          dailyReward
        });
      }

      user.updatedAt =
        nowISO();

      saveDatabase();

      return res.json({
        ok:
          true,

        verified:
          true,

        amount,

        balance:
          user.balance,

        qualifyingDeposit:
          false,

        referralSuccessful:
          false,

        dailyReward: {
          awarded:
            false,

          amount:
            0,

          reason:
            `A deposit of at least ${QUALIFYING_DEPOSIT} USDT is required for the daily reward and successful referral qualification.`
        }
      });
    } catch (error) {
      console.error(
        "Deposit verify error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Deposit verification failed."
      });
    }
  }
);

/* =========================================================
   DAILY REWARD CLAIM
========================================================= */

async function handleDailyRewardClaim(
  req,
  res
) {
  try {
    const user =
      ensureUser(
        req.telegramUser
      );

    const result =
      applyDailyReward(
        user
      );

    const status =
      getDailyRewardStatus(
        user
      );

    return res.json({
      ok:
        true,

      awarded:
        result.awarded,

      amount:
        result.amount,

      reason:
        result.reason ||
        "",

      nextRewardAt:
        result.nextRewardAt ||
        status.nextRewardAt,

      remainingSeconds:
        result.remainingSeconds ??
        status.remainingSeconds,

      canClaim:
        status.canClaim,

      balance:
        roundNumber(
          user.balance
        )
    });
  } catch (error) {
    console.error(
      "Daily reward error:",
      error
    );

    return res.status(500).json({
      ok:
        false,

      error:
        "Daily reward failed."
    });
  }
}

app.post(
  "/api/daily-reward/claim",
  telegramAuth,
  handleDailyRewardClaim
);

app.post(
  "/api/daily-reward",
  telegramAuth,
  handleDailyRewardClaim
);

/* =========================================================
   REFERRALS
========================================================= */

app.get(
  "/api/referrals",
  telegramAuth,
  (
    req,
    res
  ) => {
    try {
      const user =
        ensureUser(
          req.telegramUser
        );

      if (req.startParam) {
        registerReferral(
          user,
          req.startParam
        );
      }

      const successful =
        user.referrals.filter(
          item =>
            item.successful ===
            true
        ).length;

      return res.json({
        ok:
          true,

        totalInvited:
          user.referrals.length,

        successfulReferrals:
          successful,

        requiredReferrals:
          REQUIRED_REFERRALS,

        withdrawalEligible:
          successful >=
          REQUIRED_REFERRALS,

        referralLink:
          `https://t.me/bigmoney2026bot?startapp=ref_${user.telegramUserId}`,

        referrals:
          user.referrals
      });
    } catch (error) {
      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to load referrals."
      });
    }
  }
);

/* =========================================================
   WITHDRAWAL
========================================================= */

app.post(
  "/api/withdraw",
  telegramAuth,
  (
    req,
    res
  ) => {
    try {
      const user =
        ensureUser(
          req.telegramUser
        );

      const address =
        String(
          req.body?.address ||
            ""
        ).trim();

      const amount =
        Number(
          req.body?.amount
        );

      if (!address) {
        return res.status(400).json({
          ok:
            false,

          error:
            "TRON withdrawal address is required."
        });
      }

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <=
          0
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Invalid withdrawal amount."
        });
      }

      const successful =
        user.referrals.filter(
          item =>
            item.successful ===
            true
        ).length;

      user.successfulReferrals =
        successful;

      if (
        successful <
        REQUIRED_REFERRALS
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            `You need ${REQUIRED_REFERRALS} successful referrals before withdrawal.`
        });
      }

      if (
        amount >
        safeNumber(
          user.balance
        )
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Insufficient balance."
        });
      }

      user.balance =
        roundNumber(
          user.balance -
            amount
        );

      const withdrawal = {
        id:
          crypto.randomUUID
            ? crypto.randomUUID()
            : crypto.randomBytes(
                16
              ).toString(
                "hex"
              ),

        telegramUserId:
          user.telegramUserId,

        address,

        amount:
          roundNumber(
            amount
          ),

        status:
          "pending",

        createdAt:
          nowISO(),

        reviewedAt:
          null,

        paidAt:
          null,

        txid:
          null
      };

      db.withdrawals.push(
        withdrawal
      );

      if (
        !Array.isArray(
          user.withdrawals
        )
      ) {
        user.withdrawals =
          [];
      }

      user.withdrawals.unshift(
        withdrawal
      );

      if (
        !Array.isArray(
          user.transactions
        )
      ) {
        user.transactions =
          [];
      }

      user.transactions.unshift({
        type:
          "withdrawal",

        amount:
          roundNumber(
            amount
          ),

        address,

        status:
          "pending",

        createdAt:
          nowISO()
      });

      user.updatedAt =
        nowISO();

      saveDatabase();

      return res.json({
        ok:
          true,

        message:
          "Withdrawal request submitted for admin review.",

        withdrawal,

        balance:
          user.balance
      });
    } catch (error) {
      console.error(
        "Withdrawal error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Withdrawal request failed."
      });
    }
  }
);

/* =========================================================
   POINT CONVERSION
========================================================= */

app.post(
  "/api/points/convert",
  telegramAuth,
  (
    req,
    res
  ) => {
    try {
      const user =
        ensureUser(
          req.telegramUser
        );

      const points =
        Number(
          req.body?.points
        );

      if (
        !Number.isFinite(
          points
        ) ||
        points <=
          0
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Invalid points amount."
        });
      }

      if (
        points >
        safeNumber(
          user.points
        )
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Insufficient points."
        });
      }

      const usdt =
        roundNumber(
          points *
            POINT_USDT_RATE
        );

      user.points =
        roundNumber(
          user.points -
            points,
          6
        );

      user.balance =
        roundNumber(
          user.balance +
            usdt
        );

      const conversion = {
        id:
          crypto.randomUUID
            ? crypto.randomUUID()
            : crypto.randomBytes(
                16
              ).toString(
                "hex"
              ),

        telegramUserId:
          user.telegramUserId,

        points,

        usdt,

        createdAt:
          nowISO()
      };

      db.pointConversions.push(
        conversion
      );

      if (
        !Array.isArray(
          user.transactions
        )
      ) {
        user.transactions =
          [];
      }

      user.transactions.unshift({
        type:
          "point_conversion",

        points,

        amount:
          usdt,

        status:
          "completed",

        createdAt:
          nowISO()
      });

      user.updatedAt =
        nowISO();

      saveDatabase();

      return res.json({
        ok:
          true,

        points,

        usdt,

        balance:
          user.balance,

        remainingPoints:
          user.points
      });
    } catch (error) {
      console.error(
        "Point conversion error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Point conversion failed."
      });
    }
  }
);

/* =========================================================
   ADMIN AUTH
========================================================= */

function isAdmin(
  telegramUserId
) {
  return ADMIN_TELEGRAM_IDS.includes(
    normalizeTelegramId(
      telegramUserId
    )
  );
}

function adminOnly(
  req,
  res,
  next
) {
  if (
    !req.telegramUser ||
    !isAdmin(
      req.telegramUser.id
    )
  ) {
    return res.status(403).json({
      ok:
        false,

      error:
        "Admin access required."
    });
  }

  next();
}

/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
  "/api/admin/users",
  telegramAuth,
  adminOnly,
  (
    req,
    res
  ) => {
    try {
      return res.json({
        ok:
          true,

        users:
          db.users.map(
            user => ({
              telegramUserId:
                user.telegramUserId,

              firstName:
                user.firstName,

              username:
                user.username,

              balance:
                safeNumber(
                  user.balance
                ),

              points:
                safeNumber(
                  user.points
                ),

              totalInvited:
                user.referrals?.length ||
                0,

              successfulReferrals:
                user.referrals?.filter(
                  x =>
                    x.successful ===
                    true
                ).length ||
                0,

              dailyRewardEligible:
                Boolean(
                  user.dailyRewardEligible
                ),

              createdAt:
                user.createdAt
            })
          )
      });
    } catch (error) {
      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to load users."
      });
    }
  }
);

/* =========================================================
   ADMIN TEST CREDIT
========================================================= */

app.post(
  "/api/admin/test-credit",
  telegramAuth,
  adminOnly,
  (
    req,
    res
  ) => {
    try {
      const targetTelegramUserId =
        normalizeTelegramId(
          req.body?.telegramUserId ||
          req.body?.targetTelegramUserId ||
          ""
        );

      if (
        !targetTelegramUserId
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Target Telegram user ID is required."
        });
      }

      const user =
        findUser(
          targetTelegramUserId
        );

      if (!user) {
        return res.status(404).json({
          ok:
            false,

          error:
            "Target user not found."
        });
      }

      migrateUser(
        user
      );

      user.balance =
        roundNumber(
          safeNumber(
            user.balance
          ) +
            TEST_CREDIT_USDT
        );

      if (
        !Array.isArray(
          user.transactions
        )
      ) {
        user.transactions =
          [];
      }

      user.transactions.unshift({
        type:
          "admin_test_credit",

        amount:
          TEST_CREDIT_USDT,

        status:
          "completed",

        createdAt:
          nowISO()
      });

      user.updatedAt =
        nowISO();

      saveDatabase();

      return res.json({
        ok:
          true,

        message:
          `${TEST_CREDIT_USDT} USDT test credit added.`,

        telegramUserId:
          user.telegramUserId,

        amount:
          TEST_CREDIT_USDT,

        balance:
          user.balance,

        dailyRewardEligible:
          user.dailyRewardEligible,

        successfulReferrals:
          user.successfulReferrals
      });
    } catch (error) {
      console.error(
        "Admin test credit error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Test credit failed."
      });
    }
  }
);

/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  telegramAuth,
  adminOnly,
  (
    req,
    res
  ) => {
    try {
      return res.json({
        ok:
          true,

        withdrawals:
          db.withdrawals
      });
    } catch (error) {
      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to load withdrawals."
      });
    }
  }
);

/* =========================================================
   ADMIN APPROVE WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/approve",
  telegramAuth,
  adminOnly,
  (
    req,
    res
  ) => {
    try {
      const withdrawalId =
        String(
          req.body?.withdrawalId ||
          ""
        ).trim();

      const withdrawal =
        db.withdrawals.find(
          item =>
            String(
              item.id
            ) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok:
            false,

          error:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Withdrawal is not pending."
        });
      }

      withdrawal.status =
        "approved";

      withdrawal.reviewedAt =
        nowISO();

      const user =
        findUser(
          withdrawal.telegramUserId
        );

      if (user) {
        const userWithdrawal =
          user.withdrawals?.find(
            item =>
              String(
                item.id
              ) ===
              withdrawalId
          );

        if (userWithdrawal) {
          userWithdrawal.status =
            "approved";

          userWithdrawal.reviewedAt =
            withdrawal.reviewedAt;
        }

        user.updatedAt =
          nowISO();
      }

      saveDatabase();

      return res.json({
        ok:
          true,

        withdrawal
      });
    } catch (error) {
      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to approve withdrawal."
      });
    }
  }
);

/* =========================================================
   ADMIN REJECT WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/reject",
  telegramAuth,
  adminOnly,
  (
    req,
    res
  ) => {
    try {
      const withdrawalId =
        String(
          req.body?.withdrawalId ||
          ""
        ).trim();

      const withdrawal =
        db.withdrawals.find(
          item =>
            String(
              item.id
            ) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok:
            false,

          error:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Withdrawal is not pending."
        });
      }

      withdrawal.status =
        "rejected";

      withdrawal.reviewedAt =
        nowISO();

      const user =
        findUser(
          withdrawal.telegramUserId
        );

      if (user) {
        user.balance =
          roundNumber(
            safeNumber(
              user.balance
            ) +
              safeNumber(
                withdrawal.amount
              )
          );

        const userWithdrawal =
          user.withdrawals?.find(
            item =>
              String(
                item.id
              ) ===
              withdrawalId
          );

        if (userWithdrawal) {
          userWithdrawal.status =
            "rejected";

          userWithdrawal.reviewedAt =
            withdrawal.reviewedAt;
        }

        if (
          !Array.isArray(
            user.transactions
          )
        ) {
          user.transactions =
            [];
        }

        user.transactions.unshift({
          type:
            "withdrawal_refund",

          amount:
            withdrawal.amount,

          status:
            "completed",

          createdAt:
            nowISO()
        });

        user.updatedAt =
          nowISO();
      }

      saveDatabase();

      return res.json({
        ok:
          true,

        withdrawal,

        refunded:
          withdrawal.amount,

        balance:
          user?.balance
      });
    } catch (error) {
      console.error(
        "Reject withdrawal error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to reject withdrawal."
      });
    }
  }
);

/* =========================================================
   ADMIN MARK WITHDRAWAL PAID
========================================================= */

app.post(
  "/api/admin/withdrawals/paid",
  telegramAuth,
  adminOnly,
  (
    req,
    res
  ) => {
    try {
      const withdrawalId =
        String(
          req.body?.withdrawalId ||
          ""
        ).trim();

      const txid =
        String(
          req.body?.txid ||
          ""
        ).trim();

      if (!txid) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Payment TXID is required."
        });
      }

      const withdrawal =
        db.withdrawals.find(
          item =>
            String(
              item.id
            ) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok:
            false,

          error:
            "Withdrawal not found."
        });
      }

      if (
        withdrawal.status !==
        "approved"
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Withdrawal must be approved before marking it paid."
        });
      }

      withdrawal.status =
        "paid";

      withdrawal.txid =
        txid;

      withdrawal.paidAt =
        nowISO();

      const user =
        findUser(
          withdrawal.telegramUserId
        );

      if (user) {
        const userWithdrawal =
          user.withdrawals?.find(
            item =>
              String(
                item.id
              ) ===
              withdrawalId
          );

        if (userWithdrawal) {
          userWithdrawal.status =
            "paid";

          userWithdrawal.txid =
            txid;

          userWithdrawal.paidAt =
            withdrawal.paidAt;
        }

        if (
          !Array.isArray(
            user.transactions
          )
        ) {
          user.transactions =
            [];
        }

        user.transactions.unshift({
          type:
            "withdrawal_paid",

          amount:
            withdrawal.amount,

          txid,

          status:
            "paid",

          createdAt:
            nowISO()
        });

        user.updatedAt =
          nowISO();
      }

      saveDatabase();

      return res.json({
        ok:
          true,

        withdrawal
      });
    } catch (error) {
      console.error(
        "Mark paid error:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Failed to mark withdrawal as paid."
      });
    }
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled error:",
      error
    );

    res.status(500).json({
      ok:
        false,

      error:
        "Internal server error."
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    console.log(
      "Loading Big Money database..."
    );

    await loadDatabase();

    /*
       Migrate older users to the latest structure.
    */
    for (
      const user of db.users
    ) {
      migrateUser(
        user
      );
    }

    /*
       Save migrated data to Supabase.
    */
    await saveDatabase();

    app.listen(
      PORT,
      () => {
        console.log(
          `Big Money API running on port ${PORT}`
        );

        console.log(
          `Deposit address: ${DEPOSIT_ADDRESS}`
        );

        console.log(
          `USDT contract: ${USDT_CONTRACT}`
        );

        console.log(
          `Daily reward: ${DAILY_REWARD_USDT} USDT every 24 hours`
        );

        console.log(
          `Required successful referrals: ${REQUIRED_REFERRALS}`
        );

        console.log(
          `Supabase persistence: ${
            supabaseConfigured()
              ? "ENABLED"
              : "DISABLED"
          }`
        );
      }
    );
  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
}

startServer();


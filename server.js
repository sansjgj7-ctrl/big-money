const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const TronWeb = require("tronweb");

const app = express();

const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());


/* =========================================================
   CONFIG
========================================================= */

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL =
  "https://api.trongrid.io";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";

const WITHDRAWAL_PRIVATE_KEY =
  process.env.WITHDRAWAL_PRIVATE_KEY || "";

const TRONGRID_API_KEY =
  process.env.TRONGRID_API_KEY || "";


/* =========================================================
   REWARD SETTINGS
========================================================= */

/*
  Referral reward:
  Every successful referral = 3 points
*/

const REFERRAL_POINTS = 3;


/*
  Referred user must deposit at least 10 USDT
*/

const REFERRAL_MIN_DEPOSIT_BASE =
  10000000;


/*
  Daily deposit reward:
  0.50 points
*/

const DAILY_DEPOSIT_REWARD_POINTS =
  0.50;


/*
  Daily reward requires at least 10 USDT
*/

const DAILY_REWARD_MIN_DEPOSIT_BASE =
  10000000;


/*
  Daily reward day is calculated
  using Afghanistan/Kabul time.
*/

const DAILY_REWARD_TIMEZONE =
  "Asia/Kabul";


/* =========================================================
   DATABASE
========================================================= */

const DB_FILE =
  path.join(__dirname, "data.json");

let db = {
  users: {},
  pendingDeposits: {},
  withdrawals: {},
  usedTransactions: {}
};


function loadDB() {

  try {

    if (fs.existsSync(DB_FILE)) {

      const raw =
        fs.readFileSync(
          DB_FILE,
          "utf8"
        );

      const parsed =
        JSON.parse(raw);

      db = {

        users:
          parsed.users || {},

        pendingDeposits:
          parsed.pendingDeposits || {},

        withdrawals:
          parsed.withdrawals || {},

        usedTransactions:
          parsed.usedTransactions || {}

      };

    }

  } catch (error) {

    console.error(
      "Database load error:",
      error
    );

  }

}


function saveDB() {

  try {

    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        db,
        null,
        2
      )
    );

  } catch (error) {

    console.error(
      "Database save error:",
      error
    );

  }

}


loadDB();


/* =========================================================
   BASIC HELPERS
========================================================= */

function nowISO() {

  return new Date().toISOString();

}


function makeId(prefix) {

  return (
    prefix +
    "_" +
    Date.now() +
    "_" +
    crypto
      .randomBytes(4)
      .toString("hex")
  );

}


function getTodayKey() {

  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        DAILY_REWARD_TIMEZONE,

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit"
    }
  ).format(
    new Date()
  );

}


function getUser(telegramUserId) {

  const id =
    String(
      telegramUserId
    );


  if (!db.users[id]) {

    db.users[id] = {

      telegramUserId:
        id,

      username:
        "",

      firstName:
        "",

      balanceBaseUnits:
        0,

      reservedBaseUnits:
        0,

      referralPoints:
        0,

      /*
        User who invited this user.
      */

      referredBy:
        null,

      /*
        Referral reward for this user
        has already been given to inviter.
      */

      referralRewarded:
        false,

      /*
        Last day on which this user
        received daily deposit reward.
      */

      lastDailyRewardDate:
        null,

      createdAt:
        nowISO(),

      updatedAt:
        nowISO()

    };

  } else {

    /*
      Backward compatibility for old users
      already stored in data.json.
    */

    if (
      typeof db.users[id].referralPoints !==
      "number"
    ) {

      db.users[id].referralPoints =
        Number(
          db.users[id].referralPoints || 0
        );

    }


    if (
      !Object.prototype.hasOwnProperty.call(
        db.users[id],
        "referredBy"
      )
    ) {

      db.users[id].referredBy =
        null;

    }


    if (
      !Object.prototype.hasOwnProperty.call(
        db.users[id],
        "referralRewarded"
      )
    ) {

      db.users[id].referralRewarded =
        false;

    }


    if (
      !Object.prototype.hasOwnProperty.call(
        db.users[id],
        "lastDailyRewardDate"
      )
    ) {

      db.users[id].lastDailyRewardDate =
        null;

    }

  }


  return db.users[id];

}


function availableBaseUnits(user) {

  return Math.max(

    0,

    Number(
      user.balanceBaseUnits || 0
    ) -

    Number(
      user.reservedBaseUnits || 0
    )

  );

}


function baseToUSDT(value) {

  return (
    Number(value || 0) /
    1000000
  );

}


function usdtToBase(value) {

  const n =
    Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {

    return null;

  }

  return Math.round(
    n * 1000000
  );

}


function normalizeAddress(address) {

  return String(
    address || ""
  ).trim();

}


function isValidTronAddress(address) {

  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/
    .test(address);

}


/* =========================================================
   TELEGRAM AUTH
========================================================= */

function validateTelegramInitData(
  initData
) {

  if (!TELEGRAM_BOT_TOKEN) {

    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );

  }


  if (
    !initData ||
    typeof initData !== "string"
  ) {

    throw new Error(
      "Telegram authentication required"
    );

  }


  const params =
    new URLSearchParams(
      initData
    );


  const receivedHash =
    params.get("hash");


  if (!receivedHash) {

    throw new Error(
      "Invalid Telegram authentication data"
    );

  }


  const pairs = [];


  for (
    const [key, value]
    of params.entries()
  ) {

    if (key === "hash") {

      continue;

    }


    pairs.push(
      `${key}=${value}`
    );

  }


  pairs.sort();


  const dataCheckString =
    pairs.join("\n");


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


  if (
    receivedHash.length !==
    calculatedHash.length
  ) {

    throw new Error(
      "Invalid Telegram authentication hash"
    );

  }


  const valid =
    crypto.timingSafeEqual(

      Buffer.from(
        receivedHash,
        "utf8"
      ),

      Buffer.from(
        calculatedHash,
        "utf8"
      )

    );


  if (!valid) {

    throw new Error(
      "Invalid Telegram authentication hash"
    );

  }


  const authDate =
    Number(
      params.get("auth_date") || 0
    );


  if (!authDate) {

    throw new Error(
      "Telegram authentication date missing"
    );

  }


  const age =
    Math.floor(
      Date.now() / 1000
    ) -
    authDate;


  if (
    age > 86400 ||
    age < -300
  ) {

    throw new Error(
      "Telegram authentication expired"
    );

  }


  const userRaw =
    params.get("user");


  if (!userRaw) {

    throw new Error(
      "Telegram user information missing"
    );

  }


  let telegramUser;


  try {

    telegramUser =
      JSON.parse(
        userRaw
      );

  } catch {

    throw new Error(
      "Invalid Telegram user information"
    );

  }


  if (!telegramUser.id) {

    throw new Error(
      "Telegram user ID missing"
    );

  }


  /*
    Telegram Mini App referral parameter.

    Example:

    startapp=ref_123456789

    Telegram sends this inside signed initData
    as start_param.
  */

  const startParam =
    String(
      params.get("start_param") ||
      ""
    );


  return {

    telegramUser,

    startParam

  };

}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireTelegram(
  req,
  res,
  next
) {

  try {

    const initData =
      req.headers[
        "x-telegram-init-data"
      ];


    const auth =
      validateTelegramInitData(
        initData
      );


    const telegramUser =
      auth.telegramUser;


    const startParam =
      auth.startParam;


    req.telegramUser =
      telegramUser;


    const telegramId =
      String(
        telegramUser.id
      );


    const isNewUser =
      !db.users[telegramId];


    const user =
      getUser(
        telegramId
      );


    user.username =
      telegramUser.username ||
      user.username ||
      "";


    user.firstName =
      telegramUser.first_name ||
      user.firstName ||
      "";


    /*
      Register referral only when
      the user is first created.

      Example:

      ref_123456789
    */

    if (
      isNewUser &&
      !user.referredBy &&
      startParam.startsWith("ref_")
    ) {

      const inviterId =
        startParam
          .substring(4)
          .trim();


      /*
        Self-referral is not allowed.
      */

      if (
        inviterId &&
        inviterId !== telegramId &&
        db.users[inviterId]
      ) {

        user.referredBy =
          inviterId;

        console.log(
          "Referral registered:",
          telegramId,
          "<-",
          inviterId
        );

      }

    }


    user.updatedAt =
      nowISO();


    saveDB();


    next();

  } catch (error) {

    return res
      .status(401)
      .json({

        ok: false,

        error:
          error.message ||
          "Telegram authentication failed"

      });

  }

}


function requireAdmin(
  req,
  res,
  next
) {

  const telegramUser =
    req.telegramUser;


  if (!telegramUser) {

    return res
      .status(401)
      .json({

        ok: false,

        error:
          "Telegram authentication required"

      });

  }


  const id =
    String(
      telegramUser.id
    );


  if (
    !ADMIN_TELEGRAM_IDS.includes(id)
  ) {

    return res
      .status(403)
      .json({

        ok: false,

        error:
          "Admin access required"

      });

  }


  next();

}


/* =========================================================
   PROCESS DEPOSIT REWARDS
========================================================= */

function processDepositRewards(
  user,
  depositAmountBaseUnits
) {

  const amount =
    Number(
      depositAmountBaseUnits || 0
    );


  const rewards = {

    dailyReward:
      0,

    referralReward:
      0,

    referralUserId:
      null

  };


  /*
    ---------------------------------------------------------
    DAILY REWARD
    ---------------------------------------------------------

    Minimum deposit:
    10 USDT

    Reward:
    0.50 points

    Only once per day.
  */

  if (
    amount >=
    DAILY_REWARD_MIN_DEPOSIT_BASE
  ) {

    const today =
      getTodayKey();


    if (
      user.lastDailyRewardDate !==
      today
    ) {

      user.referralPoints =
        Number(
          user.referralPoints || 0
        ) +
        DAILY_DEPOSIT_REWARD_POINTS;


      user.lastDailyRewardDate =
        today;


      rewards.dailyReward =
        DAILY_DEPOSIT_REWARD_POINTS;


      console.log(
        "Daily reward:",
        user.telegramUserId,
        DAILY_DEPOSIT_REWARD_POINTS,
        today
      );

    }

  }


  /*
    ---------------------------------------------------------
    REFERRAL REWARD
    ---------------------------------------------------------

    Minimum referred-user deposit:
    10 USDT

    Inviter gets:
    3 points

    Only once for each referred user.
  */

  if (
    amount >=
    REFERRAL_MIN_DEPOSIT_BASE
  ) {

    if (
      user.referredBy &&
      !user.referralRewarded
    ) {

      const inviter =
        db.users[
          String(
            user.referredBy
          )
        ];


      if (
        inviter &&
        String(
          inviter.telegramUserId
        ) !==
        String(
          user.telegramUserId
        )
      ) {

        inviter.referralPoints =
          Number(
            inviter.referralPoints || 0
          ) +
          REFERRAL_POINTS;


        inviter.updatedAt =
          nowISO();


        user.referralRewarded =
          true;


        rewards.referralReward =
          REFERRAL_POINTS;


        rewards.referralUserId =
          String(
            inviter.telegramUserId
          );


        console.log(
          "Referral reward:",
          inviter.telegramUserId,
          "+",
          REFERRAL_POINTS,
          "because of",
          user.telegramUserId
        );

      }

    }

  }


  return rewards;

}


/* =========================================================
   CONFIRM DEPOSIT
========================================================= */

function confirmDeposit(

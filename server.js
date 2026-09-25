const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

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

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

const ADMIN_TELEGRAM_IDS =
  String(
    process.env.ADMIN_TELEGRAM_IDS || ""
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const ADMIN_TEST_KEY =
  process.env.ADMIN_TEST_KEY || "";

/* =========================================================
   REWARDS
========================================================= */

const REFERRAL_POINTS = 3;
const REFERRAL_MIN_DEPOSIT = 10;

const DAILY_REWARD_POINTS = 0.5;
const DAILY_REWARD_MIN_DEPOSIT = 10;

const DAILY_REWARD_TIMEZONE =
  "Asia/Kabul";

/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR =
  path.join(__dirname, "data");

const DATA_FILE =
  path.join(
    DATA_DIR,
    "big-money-data.json"
  );

function emptyStore() {
  return {
    users: {},
    deposits: {},
    withdrawals: {},
    usedTransactions: {},
    testCredits: {}
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      { recursive: true }
    );
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        emptyStore(),
        null,
        2
      )
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const store =
      JSON.parse(
        fs.readFileSync(
          DATA_FILE,
          "utf8"
        )
      );

    if (!store.users)
      store.users = {};

    if (!store.deposits)
      store.deposits = {};

    if (!store.withdrawals)
      store.withdrawals = {};

    if (!store.usedTransactions)
      store.usedTransactions = {};

    if (!store.testCredits)
      store.testCredits = {};

    return store;

  } catch (error) {
    console.error(
      "Database read error:",
      error
    );

    return emptyStore();
  }
}

function writeStore(store) {
  ensureStore();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      store,
      null,
      2
    )
  );
}

/* =========================================================
   HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function getTodayKabul() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        DAILY_REWARD_TIMEZONE,

      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}

function cleanTxid(value) {
  return String(
    value || ""
  ).trim();
}

function isValidTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(
    txid
  );
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    address
  );
}

/* =========================================================
   USER
========================================================= */

function getUser(
  store,
  telegramUserId,
  extra = {}
) {
  const id =
    String(telegramUserId);

  if (!store.users[id]) {
    store.users[id] = {
      telegramUserId: id,

      username:
        extra.username || "",

      firstName:
        extra.firstName || "",

      balance: 0,

      points: 0,

      referredBy: null,

      referralRewarded: false,

      lastDailyRewardDate: null,

      createdAt: Date.now(),

      updatedAt: Date.now()
    };
  }

  const user =
    store.users[id];

  if (
    typeof user.balance !==
    "number"
  ) {
    user.balance =
      Number(
        user.balance || 0
      );
  }

  if (
    typeof user.points !==
    "number"
  ) {
    user.points =
      Number(
        user.points || 0
      );
  }

  if (
    typeof user.referralRewarded !==
    "boolean"
  ) {
    user.referralRewarded =
      false;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      user,
      "referredBy"
    )
  ) {
    user.referredBy =
      null;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      user,
      "lastDailyRewardDate"
    )
  ) {
    user.lastDailyRewardDate =
      null;
  }

  if (extra.username) {
    user.username =
      extra.username;
  }

  if (extra.firstName) {
    user.firstName =
      extra.firstName;
  }

  user.updatedAt =
    Date.now();

  return user;
}

/* =========================================================
   TELEGRAM INIT DATA VALIDATION
========================================================= */

function validateTelegramInitData(
  initData
) {
  if (!TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      error:
        "TELEGRAM_BOT_TOKEN is not configured"
    };
  }

  if (!initData) {
    return {
      ok: false,
      error:
        "Telegram initData is missing"
    };
  }

  try {
    const params =
      new URLSearchParams(
        initData
      );

    const hash =
      params.get("hash");

    if (!hash) {
      return {
        ok: false,
        error:
          "Telegram hash is missing"
      };
    }

    if (
      !/^[a-fA-F0-9]{64}$/.test(
        hash
      )
    ) {
      return {
        ok: false,
        error:
          "Invalid Telegram hash"
      };
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

    if (
      !crypto.timingSafeEqual(
        Buffer.from(
          calculatedHash,
          "utf8"
        ),
        Buffer.from(
          hash,
          "utf8"
        )
      )
    ) {
      return {
        ok: false,
        error:
          "Invalid Telegram initData"
      };
    }

    const authDate =
      Number(
        params.get(
          "auth_date"
        )
      );

    if (!authDate) {
      return {
        ok: false,
        error:
          "auth_date is missing"
      };
    }

    const now =
      Math.floor(
        Date.now() / 1000
      );

    if (
      now - authDate >
      86400
    ) {
      return {
        ok: false,
        error:
          "Telegram initData expired"
      };
    }

    if (
      authDate - now >
      300
    ) {
      return {
        ok: false,
        error:
          "Invalid Telegram auth date"
      };
    }

    let telegramUser =
      null;

    const userRaw =
      params.get("user");

    if (userRaw) {
      telegramUser =
        JSON.parse(
          userRaw
        );
    }

    return {
      ok: true,

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

  } catch (error) {
    console.error(
      "Telegram validation error:",
      error
    );

    return {
      ok: false,
      error:
        "Could not validate Telegram data"
    };
  }
}

/* =========================================================
   TELEGRAM AUTH MIDDLEWARE
========================================================= */

function requireTelegram(
  req,
  res,
  next
) {
  const initData =
    req.headers[
      "x-telegram-init-data"
    ] ||
    req.body?.initData ||
    req.query?.initData;

  const result =
    validateTelegramInitData(
      initData
    );

  if (!result.ok) {
    return res.status(401).json({
      ok: false,
      error: result.error
    });
  }

  if (
    !result.telegramUser?.id
  ) {
    return res.status(401).json({
      ok: false,
      error:
        "Telegram user not found"
    });
  }

  req.telegramUser =
    result.telegramUser;

  req.telegramStartParam =
    result.startParam || "";

  next();
}

/* =========================================================
   ADMIN
========================================================= */

function isAdmin(
  telegramUserId
) {
  return ADMIN_TELEGRAM_IDS.includes(
    String(telegramUserId)
  );
}

function requireAdmin(
  req,
  res,
  next
) {
  const telegramUserId =
    req.telegramUser?.id;

  if (!telegramUserId) {
    return res.status(401).json({
      ok: false,
      error:
        "Telegram user is required"
    });
  }

  if (
    !isAdmin(
      telegramUserId
    )
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "Admin access required"
    });
  }

  next();
}

/* =========================================================
   REFERRAL REGISTRATION
========================================================= */

function registerReferral(
  store,
  user,
  startParam
) {
  if (!startParam)
    return false;

  if (
    !String(startParam)
      .startsWith("ref_")
  ) {
    return false;
  }

  const inviterId =
    String(startParam)
      .slice(4)
      .trim();

  if (!inviterId)
    return false;

  if (
    String(inviterId) ===
    String(user.telegramUserId)
  ) {
    return false;
  }

  if (user.referredBy) {
    return false;
  }

  if (
    !store.users[
      inviterId
    ]
  ) {
    return false;
  }

  user.referredBy =
    String(inviterId);

  user.updatedAt =
    Date.now();

  return true;
}

/* =========================================================
   REFERRAL INFO
========================================================= */

function getReferralInfo(
  store,
  telegramUserId
) {
  const referredUsers =
    Object.values(
      store.users
    ).filter(
      (u) =>
        String(
          u.referredBy
        ) ===
        String(
          telegramUserId
        )
    );

  const successfulReferrals =
    referredUsers.filter(
      (u) =>
        Boolean(
          u.referralRewarded
        )
    );

  const referralLink =
    "https://t.me/" +
    TELEGRAM_BOT_USERNAME +
    "?startapp=ref_" +
    String(
      telegramUserId
    );

  return {
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
  };
}

/* =========================================================
   REWARD PROCESSING
========================================================= */

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

  /* -------------------------
     DAILY REWARD
  ------------------------- */

  if (
    depositAmount >=
    DAILY_REWARD_MIN_DEPOSIT
  ) {
    const today =
      getTodayKabul();

    if (
      user.lastDailyRewardDate !==
      today
    ) {
      user.points =
        Number(
          user.points || 0
        ) +
        DAILY_REWARD_POINTS;

      user.lastDailyRewardDate =
        today;

      result.dailyReward =
        DAILY_REWARD_POINTS;
    }
  }

  /* -------------------------
     REFERRAL REWARD
  ------------------------- */

  if (
    depositAmount >=
      REFERRAL_MIN_DEPOSIT &&
    user.referredBy &&
    !user.referralRewarded &&
    String(user.referredBy) !==
      String(user.telegramUserId)
  ) {
    const inviter =
      store.users[
        String(
          user.referredBy
        )
      ];

    if (inviter) {
      inviter.points =
        Number(
          inviter.points || 0
        ) +
        REFERRAL_POINTS;

      inviter.updatedAt =
        Date.now();

      user.referralRewarded =
        true;

      result.referralReward =
        REFERRAL_POINTS;

      result.referralUserId =
        String(
          user.referredBy
        );
    }
  }

  return result;
}

/* =========================================================
   TRON / USDT
========================================================= */

async function getUsdtTransfers() {
  const url =
    TRONGRID_URL +
    "/v1/accounts/" +
    DEPOSIT_ADDRESS +
    "/transactions/trc20" +
    "?limit=50&contract_address=" +
    USDT_CONTRACT;

  const headers = {};

  if (
    process.env.TRONGRID_API_KEY
  ) {
    headers[
      "TRON-PRO-API-KEY"
    ] =
      process.env.TRONGRID_API_KEY;
  }

  const response =
    await fetch(
      url,
      {
        headers
      }
    );

  if (!response.ok) {
    const text =
      await response
        .text()
        .catch(
          () => ""
        );

    throw new Error(
      "TronGrid request failed: " +
      response.status +
      " " +
      text
    );
  }

  return await response.json();
}

function normalizeTransfer(
  tx
) {
  return {
    transactionId:
      tx.transaction_id ||
      null,

    from:
      tx.from ||
      null,

    to:
      tx.to ||
      null,

    amountUSDT:
      Number(
        tx.value || 0
      ) /
      1000000,

    confirmed:
      Boolean(
        tx.block_timestamp
      ),

    timestamp:
      tx.block_timestamp ||
      null,

    tokenContract:
      tx.token_info?.address ||
      tx.contract_address ||
      USDT_CONTRACT
  };
}

async function findTransfer(
  txid
) {
  const data =
    await getUsdtTransfers();

  const transfers =
    (data.data || [])
      .map(
        normalizeTransfer
      );

  return (
    transfers.find(
      (tx) =>
        String(
          tx.transactionId ||
          ""
        ).toLowerCase() ===
        txid.toLowerCase()
    ) || null
  );
}

/* =========================================================
   TELEGRAM MESSAGE
========================================================= */

async function sendTelegramMessage(
  chatId,
  text
) {
  if (
    !TELEGRAM_BOT_TOKEN
  ) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response =
    await fetch(
      "https://api.telegram.org/bot" +
        TELEGRAM_BOT_TOKEN +
        "/sendMessage",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          chat_id:
            String(chatId),

          text: text
        })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.ok
  ) {
    throw new Error(
      data?.description ||
      "Could not send Telegram message"
    );
  }

  return data;
}

/* =========================================================
   HOME
========================================================= */

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
        "withdrawal-referral-txid"
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
      ok: true,

      network:
        "TRON",

      token:
        "USDT",

      standard:
        "TRC20",

      depositAddress:
        DEPOSIT_ADDRESS,

      rewards: {
        referralPoints:
          REFERRAL_POINTS,

        referralMinimumDeposit:
          REFERRAL_MIN_DEPOSIT,

        dailyRewardPoints:
          DAILY_REWARD_POINTS,

        dailyRewardMinimumDeposit:
          DAILY_REWARD_MIN_DEPOSIT
      }
    });
  }
);

/* =========================================================
   ACCOUNT
========================================================= */

app.get(
  "/api/account/:telegramUserId",
  requireTelegram,
  (req, res) => {
    const telegramUserId =
      String(
        req.params.telegramUserId ||
        ""
      ).trim();

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId is required"
      });
    }

    if (
      String(
        req.telegramUser.id
      ) !==
      telegramUserId
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Telegram user does not match account"
      });
    }

    const store =
      readStore();

    const user =
      getUser(
        store,
        telegramUserId,
        {
          username:
            req.telegramUser
              .username ||
            "",

          firstName:
            req.telegramUser
              .first_name ||
            ""
        }
      );

    const referralChanged =
      registerReferral(
        store,
        user,
        req.telegramStartParam
      );

    const referral =
      getReferralInfo(
        store,
        telegramUserId
      );

    const deposits =
      Object.values(
        store.deposits
      )
        .filter(
          (d) =>
            String(
              d.telegramUserId
            ) ===
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
            String(
              w.telegramUserId
            ) ===
            telegramUserId
        )
        .sort(
          (a, b) =>
            (b.createdAt || 0) -
            (a.createdAt || 0)
        )
        .slice(0, 50);

    /*
      Save user information and
      referral registration.
    */

    writeStore(store);

    res.json({
      ok: true,

      user: {
        telegramUserId,

        username:
          user.username || "",

        firstName:
          user.firstName || "",

        balance:
          Number(
            user.balance || 0
          ),

        points:
          Number(
            user.points || 0
          ),

        referredBy:
          user.referredBy ||
          null,

        referralRewarded:
          Boolean(
            user.referralRewarded
          ),

        lastDailyRewardDate:
          user.lastDailyRewardDate ||
          null
      },

      referral,

      deposits,

      withdrawals
    });
  }
);

/* =========================================================
   REFERRAL
========================================================= */

app.get(
  "/api/referral/:telegramUserId",
  requireTelegram,
  (req, res) => {
    const telegramUserId =
      String(
        req.params.telegramUserId ||
        ""
      ).trim();

    if (!telegramUserId) {
      return res.status(400).json({
        ok: false,
        error:
          "telegramUserId is required"
      });
    }

    if (
      String(
        req.telegramUser.id
      ) !==
      telegramUserId
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Telegram user does not match account"
      });
    }

    const store =
      readStore();

    const user =
      getUser(
        store,
        telegramUserId,
        {
          username:
            req.telegramUser
              .username ||
            "",

          firstName:
            req.telegramUser
              .first_name ||
            ""
        }
      );

    registerReferral(
      store,
      user,
      req.telegramStartParam
    );

    writeStore(store);

    res.json({
      ok: true,

      ...getReferralInfo(
        store,
        telegramUserId
      )
    });
  }
);

/* =========================================================
   DEPOSIT CHECK
========================================================= */

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
          (data.data || [])
            .map(
              normalizeTransfer
            )
      });

    } catch (error) {
      console.error(
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Could not check TRON transfers"
      });
    }
  }
);

/* =========================================================
   DEPOSIT REQUEST
========================================================= */

app.post(
  "/api/deposits/request",
  requireTelegram,
  (req, res) => {
    const telegramUserId =
      String(
        req.telegramUser.id
      );

    const amount =
      Number(
        req.body?.amount
      );

    if (
      !Number.isFinite(
        amount
      ) ||
      amount <= 0 ||
      amount > 100000000
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "A valid amount is required"
      });
    }

    const store =
      readStore();

    getUser(
      store,
      telegramUserId,
      {
        username:
          req.telegramUser
            .username ||
          "",

        firstName:
          req.telegramUser
            .first_name ||
          ""
      }
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

/* =========================================================
   DEPOSIT VERIFY TXID
========================================================= */

app.post(
  "/api/deposits/verify",
  requireTelegram,
  async (req, res) => {
    const telegramUserId =
      String(
        req.telegramUser.id
      );

    const txid =
      cleanTxid(
        req.body?.txid
      );

    if (
      !isValidTxid(txid)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid TRON transaction ID"
      });
    }

    const store =
      readStore();

    const alreadyUsed =
      Object.values(
        store.deposits
      ).find(
        (d) =>
          d.txid &&
          String(
            d.txid
          ).toLowerCase() ===
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
        await findTransfer(
          txid
        );

      if (!transfer) {
        return res.status(404).json({
          ok: false,
          error:
            "Transaction was not found in recent USDT TRC20 transfers"
        });
      }

      if (
        !transfer.confirmed
      ) {
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
          telegramUserId,
          {
            username:
              req.telegramUser
                .username ||
              "",

            firstName:
              req.telegramUser
                .first_name ||
              ""
          }
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
        id:
          depositId,

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
        Number(
          user.balance || 0
        ) +
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

        credited:
          true,

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

/* =========================================================
   ADMIN TEST CREDIT
========================================================= */

app.post(
  "/api/admin/test-credit",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    if (!ADMIN_TEST_KEY) {
      return res.status(500).json({
        ok: false,
        error:
          "ADMIN_TEST_KEY is not configured on the server"
      });
    }

    const suppliedKey =
      String(
        req.headers[
          "x-admin-test-key"
        ] ||
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
        req.telegramUser.id
      );

    const store =
      readStore();

    const user =
      getUser(
        store,
        telegramUserId,
        {
          username:
            req.telegramUser
              .username ||
            "",

          firstName:
            req.telegramUser
              .first_name ||
            ""
        }
      );

    const TEST_AMOUNT =
      10;

    user.balance =
      Number(
        user.balance || 0
      ) +
      TEST_AMOUNT;

    const testId =
      "test_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8);

    store.testCredits[
      testId
    ] = {
      id:
        testId,

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

      test:
        true,

      credited:
        TEST_AMOUNT,

      balance:
        Number(
          user.balance || 0
        ),

      points:
        Number(
          user.points || 0
        ),

      message:
        "10 USDT test balance added successfully"
    });
  }
);

/* =========================================================
   WITHDRAWAL REQUEST
========================================================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  (req, res) => {
    const telegramUserId =
      String(
        req.telegramUser.id
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

    if (
      !address ||
      !Number.isFinite(
        amount
      ) ||
      amount <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "address and valid amount are required"
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
        telegramUserId,
        {
          username:
            req.telegramUser
              .username ||
            "",

          firstName:
            req.telegramUser
              .first_name ||
            ""
        }
      );

    if (
      amount >
      Number(
        user.balance || 0
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Insufficient balance"
      });
    }

    /*
      Reserve balance.
    */

    user.balance =
      Number(
        user.balance || 0
      ) -
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

      paymentTxid:
        null,

      createdAt:
        Date.now(),

      updatedAt:
        Date.now()
    };

    writeStore(store);

    /*
      Send notification to admin accounts.
    */

    for (
      const adminId of
      ADMIN_TELEGRAM_IDS
    ) {
      try {
        await sendTelegramMessage(
          adminId,

          "💰 New Withdrawal Request\n\n" +
          "User ID: " +
          telegramUserId +
          "\n\n" +
          "Amount: " +
          Number(
            amount
          ).toFixed(2) +
          " USDT\n\n" +
          "Address:\n" +
          address +
          "\n\n" +
          "Withdrawal ID:\n" +
          id
        );
      } catch (error) {
        console.error(
          "Admin withdrawal notification error:",
          error
        );
      }
    }

    res.json({
      ok: true,

      withdrawal:
        store.withdrawals[id],

      balance:
        user.balance
    });
  }
);

/* =========================================================
   ADMIN: WITHDRAWALS LIST
========================================================= */

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

/* =========================================================
   ADMIN: APPROVE WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:withdrawalId/approve",
  requireTelegram,
  requireAdmin,
  async (req, res) => {
    const withdrawalId =
      String(
        req.params.withdrawalId ||
        ""
      ).trim();

    const txid =
      String(
        req.body?.txid ||
        ""
      ).trim();

    if (!withdrawalId) {
      return res.status(400).json({
        ok: false,
        error:
          "Withdrawal ID is required"
      });
    }

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

    const store =
      readStore();

    const withdrawal =
      store.withdrawals[
        withdrawalId
      ];

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
      return res.status(409).json({
        ok: false,
        error:
          "This withdrawal has already been processed"
      });
    }

    withdrawal.status =
      "approved";

    withdrawal.approvedAt =
      Date.now();

    withdrawal.approvedBy =
      String(
        req.telegramUser.id
      );

    withdrawal.paymentTxid =
      txid || null;

    withdrawal.updatedAt =
      Date.now();

    writeStore(store);

    let notificationSent =
      false;

    try {
      await sendTelegramMessage(
        withdrawal.telegramUserId,

        "✅ Withdrawal Approved\n\n" +
        "Amount: " +
        Number(
          withdrawal.amount || 0
        ).toFixed(2) +
        " USDT\n\n" +
        "Your withdrawal request has been approved." +
        (
          txid
            ? "\n\nPayment TXID:\n" +
              txid
            : "\n\nPayment TXID will be added after the transfer."
        )
      );

      notificationSent =
        true;

    } catch (error) {
      console.error(
        "Telegram approval notification error:",
        error
      );
    }

    return res.json({
      ok: true,

      withdrawal,

      notificationSent
    });
  }
);

/* =========================================================
   ADMIN: REJECT WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:withdrawalId/reject",
  requireTelegram,
  requireAdmin,
  async (req, res) => {
    const withdrawalId =
      String(
        req.params.withdrawalId ||
        ""
      ).trim();

    const reason =
      String(
        req.body?.reason ||
        ""
      ).trim();

    if (!withdrawalId) {
      return res.status(400).json({
        ok: false,
        error:
          "Withdrawal ID is required"
      });
    }

    const store =
      readStore();

    const withdrawal =
      store.withdrawals[
        withdrawalId
      ];

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
      return res.status(409).json({
        ok: false,
        error:
          "This withdrawal has already been processed"
      });
    }

    const user =
      getUser(
        store,
        withdrawal.telegramUserId
      );

    /*
      Return reserved amount
      to user's balance.
    */

    user.balance =
      Number(
        user.balance || 0
      ) +
      Number(
        withdrawal.amount || 0
      );

    withdrawal.status =
      "rejected";

    withdrawal.rejectedAt =
      Date.now();

    withdrawal.rejectedBy =
      String(
        req.telegramUser.id
      );

    withdrawal.rejectionReason =
      reason ||
      "Withdrawal rejected";

    withdrawal.updatedAt =
      Date.now();

    writeStore(store);

    let notificationSent =
      false;

    try {
      await sendTelegramMessage(
        withdrawal.telegramUserId,

        "❌ Withdrawal Rejected\n\n" +
        "Amount: " +
        Number(
          withdrawal.amount || 0
        ).toFixed(2) +
        " USDT\n\n" +
        "The amount has been returned to your Big Money balance.\n\n" +
        "Reason: " +
        (
          reason ||
          "Withdrawal rejected by administrator."
        )
      );

      notificationSent =
        true;

    } catch (error) {
      console.error(
        "Telegram rejection notification error:",
        error
      );
    }

    return res.json({
      ok: true,

      withdrawal,

      returnedToBalance:
        Number(
          withdrawal.amount || 0
        ),

      balance:
        Number(
          user.balance || 0
        ),

      notificationSent
    });
  }
);

/* =========================================================
   ADMIN: ADD PAYMENT TXID
========================================================= */

app.post(
  "/api/admin/withdrawals/:withdrawalId/txid",
  requireTelegram,
  requireAdmin,
  async (req, res) => {
    const withdrawalId =
      String(
        req.params.withdrawalId ||
        ""
      ).trim();

    const txid =
      String(
        req.body?.txid ||
        ""
      ).trim();

    if (!withdrawalId) {
      return res.status(400).json({
        ok: false,
        error:
          "Withdrawal ID is required"
      });
    }

    if (
      !isValidTxid(txid)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid TRON transaction ID"
      });
    }

    const store =
      readStore();

    const withdrawal =
      store.withdrawals[
        withdrawalId
      ];

    if (!withdrawal) {
      return res.status(404).json({
        ok: false,
        error:
          "Withdrawal not found"
      });
    }

    withdrawal.paymentTxid =
      txid;

    withdrawal.txidAddedAt =
      Date.now();

    withdrawal.txidAddedBy =
      String(
        req.telegramUser.id
      );

    withdrawal.updatedAt =
      Date.now();

    writeStore(store);

    let notificationSent =
      false;

    try {
      await sendTelegramMessage(
        withdrawal.telegramUserId,

        "💸 Withdrawal Payment Sent\n\n" +
        "Amount: " +
        Number(
          withdrawal.amount || 0
        ).toFixed(2) +
        " USDT\n\n" +
        "Payment TXID:\n" +
        txid
      );

      notificationSent =
        true;

    } catch (error) {
      console.error(
        "Telegram TXID notification error:",
        error
      );
    }

    return res.json({
      ok: true,

      withdrawal,

      notificationSent
    });
  }
);

/* =========================================================
   ADMIN: USERS
========================================================= */

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

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================="
    );

    console.log(
      "Big Money Backend running on port " +
      PORT
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
      "Admin IDs configured:",
      ADMIN_TELEGRAM_IDS.length
    );

    console.log(
      "Telegram bot:",
      TELEGRAM_BOT_USERNAME
    );

    console.log(
      "Test credit:",
      ADMIN_TEST_KEY
        ? "enabled"
        : "disabled"
    );

    console.log(
      "================================="
    );
  }
);

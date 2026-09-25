const express = require("express");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 3000;

const DEPOSIT_ADDRESS =
  process.env.DEPOSIT_ADDRESS ||
  "TAmkXMpkcqSZmG9oRvtXfBvpLWr53wXEdx";

const USDT_CONTRACT =
  process.env.USDT_CONTRACT ||
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRONGRID_URL = "https://api.trongrid.io";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "bigmoney2026bot";

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const ADMIN_TEST_KEY =
  process.env.ADMIN_TEST_KEY || "";

/* =========================
   REWARDS
========================= */

const REFERRAL_POINTS = 3;
const REFERRAL_MIN_DEPOSIT = 10;

const DAILY_REWARD_POINTS = 0.5;
const DAILY_REWARD_MIN_DEPOSIT = 10;

const DAILY_REWARD_TIMEZONE = "Asia/Kabul";

/* =========================
   DATABASE
========================= */

const DB_FILE = "./database.json";

function ensureStore() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          users: [],
          deposits: [],
          withdrawals: [],
          usedTransactions: [],
          testCredits: []
        },
        null,
        2
      )
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    data.users = Array.isArray(data.users)
      ? data.users
      : [];

    data.deposits = Array.isArray(data.deposits)
      ? data.deposits
      : [];

    data.withdrawals = Array.isArray(data.withdrawals)
      ? data.withdrawals
      : [];

    data.usedTransactions =
      Array.isArray(data.usedTransactions)
        ? data.usedTransactions
        : [];

    data.testCredits =
      Array.isArray(data.testCredits)
        ? data.testCredits
        : [];

    return data;
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
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(store, null, 2)
  );
}

/* =========================
   HELPERS
========================= */

function getTodayKabul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_REWARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function cleanTxid(txid) {
  return String(txid || "").trim();
}

function isValidTxid(txid) {
  return /^[a-fA-F0-9]{64}$/.test(txid);
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    String(address || "").trim()
  );
}

function getOrCreateUser(store, telegramUserId, username = "") {
  const id = String(telegramUserId);

  let user = store.users.find(
    u => String(u.telegramUserId) === id
  );

  if (!user) {
    user = {
      telegramUserId: id,
      username: username || "",
      balance: 0,
      points: 0,
      referredBy: null,
      referralRewarded: false,
      lastDailyRewardDate: null,
      createdAt: new Date().toISOString()
    };

    store.users.push(user);
  } else if (username) {
    user.username = username;
  }

  if (typeof user.balance !== "number") {
    user.balance = Number(user.balance || 0);
  }

  if (typeof user.points !== "number") {
    user.points = Number(user.points || 0);
  }

  return user;
}

/* =========================
   TELEGRAM AUTH
========================= */

function validateTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      message: "TELEGRAM_BOT_TOKEN تنظیم نشده است."
    };
  }

  if (!initData) {
    return {
      ok: false,
      message: "Telegram init data موجود نیست."
    };
  }

  try {
    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
      return {
        ok: false,
        message: "Telegram hash موجود نیست."
      };
    }

    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
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
      calculatedHash.length !== receivedHash.length ||
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(receivedHash)
      )
    ) {
      return {
        ok: false,
        message: "Telegram authentication نامعتبر است."
      };
    }

    const authDate = Number(params.get("auth_date"));

    if (
      !Number.isFinite(authDate) ||
      Math.floor(Date.now() / 1000) - authDate > 86400
    ) {
      return {
        ok: false,
        message: "Telegram session منقضی شده است."
      };
    }

    const userString = params.get("user");

    if (!userString) {
      return {
        ok: false,
        message: "Telegram user موجود نیست."
      };
    }

    const telegramUser = JSON.parse(userString);

    if (!telegramUser.id) {
      return {
        ok: false,
        message: "Telegram user ID موجود نیست."
      };
    }

    return {
      ok: true,
      telegramUserId: String(telegramUser.id),
      username:
        telegramUser.username ||
        telegramUser.first_name ||
        "",
      startParam:
        params.get("start_param") ||
        ""
    };
  } catch (error) {
    console.error("Telegram auth error:", error);

    return {
      ok: false,
      message: "خطا در Telegram authentication."
    };
  }
}

function requireTelegram(req, res, next) {
  const initData =
    req.headers["x-telegram-init-data"];

  const result =
    validateTelegramInitData(initData);

  if (!result.ok) {
    return res.status(401).json({
      ok: false,
      message: result.message
    });
  }

  req.telegramUserId = result.telegramUserId;
  req.telegramUsername = result.username;
  req.telegramStartParam = result.startParam;

  next();
}

/* =========================
   ADMIN AUTH
========================= */

function isAdmin(telegramUserId) {
  return ADMIN_TELEGRAM_IDS.includes(
    String(telegramUserId)
  );
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.telegramUserId)) {
    return res.status(403).json({
      ok: false,
      message: "دسترسی ادمین ندارید."
    });
  }

  next();
}

/* =========================
   REFERRALS
========================= */

function registerReferral(
  store,
  telegramUserId,
  startParam
) {
  if (!startParam) return;

  const match = String(startParam).match(
    /^ref_(\d+)$/
  );

  if (!match) return;

  const referrerId = String(match[1]);
  const userId = String(telegramUserId);

  if (referrerId === userId) {
    return;
  }

  const user = getOrCreateUser(
    store,
    userId
  );

  if (user.referredBy) {
    return;
  }

  const referrer = store.users.find(
    u =>
      String(u.telegramUserId) ===
      referrerId
  );

  if (!referrer) {
    return;
  }

  user.referredBy = referrerId;
}

function getReferralInfo(store, telegramUserId) {
  const userId = String(telegramUserId);

  const user = store.users.find(
    u =>
      String(u.telegramUserId) === userId
  );

  if (!user) {
    return {
      referralLink:
        `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${userId}`,
      invited: 0,
      successful: 0,
      points: 0
    };
  }

  const invitedUsers =
    store.users.filter(
      u =>
        String(u.referredBy) === userId
    );

  const successfulUsers =
    invitedUsers.filter(
      u => u.referralRewarded === true
    );

  return {
    referralLink:
      `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${userId}`,
    invited: invitedUsers.length,
    successful: successfulUsers.length,
    points:
      successfulUsers.length *
      REFERRAL_POINTS
  };
}

/* =========================
   DEPOSIT REWARDS
========================= */

function processDepositRewards(
  store,
  user,
  depositAmount
) {
  const amount = Number(depositAmount);

  if (amount < REFERRAL_MIN_DEPOSIT) {
    return;
  }

  /* Referral reward */

  if (
    user.referredBy &&
    !user.referralRewarded
  ) {
    const referrer =
      store.users.find(
        u =>
          String(u.telegramUserId) ===
          String(user.referredBy)
      );

    if (referrer) {
      referrer.points =
        Number(referrer.points || 0) +
        REFERRAL_POINTS;

      user.referralRewarded = true;
    }
  }

  /* Daily reward */

  if (amount >= DAILY_REWARD_MIN_DEPOSIT) {
    const today = getTodayKabul();

    if (
      user.lastDailyRewardDate !== today
    ) {
      user.points =
        Number(user.points || 0) +
        DAILY_REWARD_POINTS;

      user.lastDailyRewardDate = today;
    }
  }
}

/* =========================
   TRONGRID
========================= */

async function getUsdtTransfers() {
  const url =
    `${TRONGRID_URL}/v1/accounts/` +
    `${DEPOSIT_ADDRESS}/transactions/trc20` +
    `?limit=50` +
    `&contract_address=${USDT_CONTRACT}` +
    `&only_confirmed=true`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `TronGrid error: ${response.status}`
    );
  }

  const data = await response.json();

  return Array.isArray(data.data)
    ? data.data
    : [];
}

function normalizeTransfer(tx) {
  return {
    txid:
      tx.transaction_id ||
      tx.transactionId ||
      "",

    from:
      tx.from ||
      "",

    to:
      tx.to ||
      "",

    amount:
      Number(tx.value || 0) /
      1000000,

    token:
      tx.token_info?.symbol ||
      "",

    contract:
      tx.token_info?.address ||
      "",

    confirmed: true,

    timestamp:
      tx.block_timestamp ||
      Date.now()
  };
}

async function findTransfer(txid) {
  const transfers =
    await getUsdtTransfers();

  for (const item of transfers) {
    const transfer =
      normalizeTransfer(item);

    if (
      transfer.txid.toLowerCase() ===
      txid.toLowerCase()
    ) {
      return transfer;
    }
  }

  return null;
}

/* =========================
   TELEGRAM MESSAGE
========================= */

async function sendTelegramMessage(
  chatId,
  text
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN تنظیم نشده است."
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  const data =
    await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      data.description ||
      "Telegram sendMessage failed"
    );
  }

  return data;
}

/* =========================
   BASIC ROUTES
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Big Money API is running"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    depositAddress:
      DEPOSIT_ADDRESS,
    usdtContract:
      USDT_CONTRACT,
    telegramBotUsername:
      TELEGRAM_BOT_USERNAME,
    referralPoints:
      REFERRAL_POINTS,
    referralMinDeposit:
      REFERRAL_MIN_DEPOSIT,
    dailyRewardPoints:
      DAILY_REWARD_POINTS,
    dailyRewardMinDeposit:
      DAILY_REWARD_MIN_DEPOSIT
  });
});

/* =========================
   ACCOUNT
========================= */

app.get(
  "/api/account/:telegramUserId",
  requireTelegram,
  (req, res) => {
    try {
      const requestedId =
        String(req.params.telegramUserId);

      if (
        requestedId !==
        String(req.telegramUserId)
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Telegram user ID mismatch."
        });
      }

      const store = readStore();

      registerReferral(
        store,
        req.telegramUserId,
        req.telegramStartParam
      );

      const user =
        getOrCreateUser(
          store,
          req.telegramUserId,
          req.telegramUsername
        );

      writeStore(store);

      res.json({
        ok: true,
        user: {
          telegramUserId:
            user.telegramUserId,
          username:
            user.username,
          balance:
            Number(user.balance || 0),
          points:
            Number(user.points || 0),
          referredBy:
            user.referredBy,
          referralRewarded:
            user.referralRewarded,
          lastDailyRewardDate:
            user.lastDailyRewardDate
        }
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در دریافت حساب."
      });
    }
  }
);

/* =========================
   REFERRAL
========================= */

app.get(
  "/api/referral/:telegramUserId",
  requireTelegram,
  (req, res) => {
    try {
      const requestedId =
        String(req.params.telegramUserId);

      if (
        requestedId !==
        String(req.telegramUserId)
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Telegram user ID mismatch."
        });
      }

      const store = readStore();

      registerReferral(
        store,
        req.telegramUserId,
        req.telegramStartParam
      );

      const user =
        getOrCreateUser(
          store,
          req.telegramUserId,
          req.telegramUsername
        );

      writeStore(store);

      const referral =
        getReferralInfo(
          store,
          req.telegramUserId
        );

      res.json({
        ok: true,
        referral
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در دریافت اطلاعات دعوت."
      });
    }
  }
);

/* =========================
   DEPOSIT CHECK
========================= */

app.get(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {
    try {
      const txid =
        cleanTxid(req.query.txid);

      if (!isValidTxid(txid)) {
        return res.status(400).json({
          ok: false,
          message:
            "TXID نامعتبر است."
        });
      }

      const transfer =
        await findTransfer(txid);

      if (!transfer) {
        return res.json({
          ok: true,
          found: false
        });
      }

      res.json({
        ok: true,
        found: true,
        transfer
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در بررسی تراکنش."
      });
    }
  }
);

/* =========================
   DEPOSIT REQUEST
========================= */

app.post(
  "/api/deposits/request",
  requireTelegram,
  (req, res) => {
    try {
      const amount =
        Number(req.body?.amount || 0);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "مبلغ نامعتبر است."
        });
      }

      const store = readStore();

      const user =
        getOrCreateUser(
          store,
          req.telegramUserId,
          req.telegramUsername
        );

      const deposit = {
        id:
          "DEP_" +
          Date.now() +
          "_" +
          Math.random()
            .toString(36)
            .slice(2, 8),

        telegramUserId:
          String(req.telegramUserId),

        amount,

        status: "waiting",

        createdAt:
          new Date().toISOString()
      };

      store.deposits.push(deposit);

      writeStore(store);

      res.json({
        ok: true,
        deposit
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در ایجاد درخواست واریز."
      });
    }
  }
);

/* =========================
   DEPOSIT VERIFY
========================= */

app.post(
  "/api/deposits/verify",
  requireTelegram,
  async (req, res) => {
    try {
      const txid =
        cleanTxid(req.body?.txid);

      if (!isValidTxid(txid)) {
        return res.status(400).json({
          ok: false,
          message:
            "TXID نامعتبر است."
        });
      }

      const store = readStore();

      if (
        store.usedTransactions.some(
          x =>
            String(x).toLowerCase() ===
            txid.toLowerCase()
        )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "این TXID قبلاً استفاده شده است."
        });
      }

      const transfer =
        await findTransfer(txid);

      if (!transfer) {
        return res.status(400).json({
          ok: false,
          message:
            "تراکنش پیدا نشد یا هنوز تأیید نشده است."
        });
      }

      if (
        String(transfer.to).toLowerCase() !==
        DEPOSIT_ADDRESS.toLowerCase()
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "این تراکنش به آدرس واریز Big Money ارسال نشده است."
        });
      }

      if (
        String(transfer.contract).toLowerCase() !==
        USDT_CONTRACT.toLowerCase()
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "این تراکنش USDT TRC20 معتبر نیست."
        });
      }

      if (
        Number(transfer.amount) <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "مبلغ تراکنش نامعتبر است."
        });
      }

      const user =
        getOrCreateUser(
          store,
          req.telegramUserId,
          req.telegramUsername
        );

      user.balance =
        Number(user.balance || 0) +
        Number(transfer.amount);

      processDepositRewards(
        store,
        user,
        Number(transfer.amount)
      );

      store.usedTransactions.push(
        txid
      );

      store.deposits.push({
        id:
          "DEP_" +
          Date.now() +
          "_" +
          Math.random()
            .toString(36)
            .slice(2, 8),

        telegramUserId:
          String(req.telegramUserId),

        txid,

        amount:
          Number(transfer.amount),

        from:
          transfer.from,

        to:
          transfer.to,

        contract:
          transfer.contract,

        status:
          "confirmed",

        createdAt:
          new Date().toISOString()
      });

      writeStore(store);

      res.json({
        ok: true,
        message:
          "واریز با موفقیت تأیید شد.",
        amount:
          Number(transfer.amount),
        balance:
          Number(user.balance || 0),
        points:
          Number(user.points || 0)
      });
    } catch (error) {
      console.error(
        "Deposit verify error:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "خطا در تأیید واریز."
      });
    }
  }
);

/* =========================
   ADMIN TEST CREDIT
========================= */

app.post(
  "/api/admin/test-credit",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    try {
      const key =
        String(
          req.body?.key || ""
        );

      if (
        !ADMIN_TEST_KEY ||
        key !== ADMIN_TEST_KEY
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "کلید تست نامعتبر است."
        });
      }

      const store = readStore();

      const user =
        getOrCreateUser(
          store,
          req.telegramUserId,
          req.telegramUsername
        );

      user.balance =
        Number(user.balance || 0) +
        10;

      store.testCredits.push({
        telegramUserId:
          String(req.telegramUserId),

        amount: 10,

        createdAt:
          new Date().toISOString()
      });

      writeStore(store);

      res.json({
        ok: true,
        message:
          "10 USDT تست به حساب اضافه شد.",
        balance:
          Number(user.balance || 0)
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در اعتبار تست."
      });
    }
  }
);

/* =========================
   WITHDRAWAL REQUEST
========================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {
    try {
      const amount =
        Number(req.body?.amount || 0);

      const address =
        String(
          req.body?.address || ""
        ).trim();

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "مبلغ برداشت نامعتبر است."
        });
      }

      if (
        !isValidTronAddress(address)
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "آدرس TRON نامعتبر است."
        });
      }

      const store = readStore();

      const user =
        getOrCreateUser(
          store,
          req.telegramUserId,
          req.telegramUsername
        );

      const balance =
        Number(user.balance || 0);

      if (balance < amount) {
        return res.status(400).json({
          ok: false,
          message:
            "موجودی کافی نیست."
        });
      }

      /* Reserve balance */

      user.balance =
        balance - amount;

      const withdrawal = {
        id:
          "WD_" +
          Date.now() +
          "_" +
          Math.random()
            .toString(36)
            .slice(2, 8),

        telegramUserId:
          String(req.telegramUserId),

        amount,

        address,

        status:
          "pending",

        reason:
          "",

        paymentTxid:
          "",

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString()
      };

      store.withdrawals.push(
        withdrawal
      );

      writeStore(store);

      /* Notify admins */

      const message =
        "💰 New Withdrawal Request\n\n" +
        "👤 User ID: " +
        req.telegramUserId +
        "\n\n" +
        "💵 Amount: " +
        amount +
        " USDT\n\n" +
        "📍 Address:\n" +
        address +
        "\n\n" +
        "🆔 Withdrawal ID:\n" +
        withdrawal.id +
        "\n\n" +
        "⏳ Status: Pending";

      for (
        const adminId
        of ADMIN_TELEGRAM_IDS
      ) {
        try {
          await sendTelegramMessage(
            adminId,
            message
          );
        } catch (error) {
          console.error(
            "Admin Telegram message error:",
            error.message
          );
        }
      }

      res.json({
        ok: true,
        message:
          "درخواست برداشت با موفقیت ثبت شد.",
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
          "خطا در ثبت درخواست برداشت."
      });
    }
  }
);

/* =========================
   ADMIN WITHDRAWALS
========================= */

app.get(
  "/api/admin/withdrawals",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    try {
      const store = readStore();

      const withdrawals =
        [...store.withdrawals]
          .reverse();

      res.json({
        ok: true,
        withdrawals
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در دریافت برداشت‌ها."
      });
    }
  }
);

/* =========================
   ADMIN APPROVE WITHDRAWAL
========================= */

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

      const paymentTxid =
        cleanTxid(
          req.body?.paymentTxid
        );

      const store = readStore();

      const withdrawal =
        store.withdrawals.find(
          w =>
            String(w.id) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "درخواست برداشت پیدا نشد."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "این درخواست قبلاً بررسی شده است."
        });
      }

      withdrawal.status =
        "approved";

      withdrawal.updatedAt =
        new Date().toISOString();

      if (paymentTxid) {
        if (!isValidTxid(paymentTxid)) {
          return res.status(400).json({
            ok: false,
            message:
              "Payment TXID نامعتبر است."
          });
        }

        withdrawal.paymentTxid =
          paymentTxid;
      }

      writeStore(store);

      try {
        await sendTelegramMessage(
          withdrawal.telegramUserId,
          "✅ Withdrawal Approved\n\n" +
          "💵 Amount: " +
          withdrawal.amount +
          " USDT\n\n" +
          "📍 Address:\n" +
          withdrawal.address +
          "\n\n" +
          (
            withdrawal.paymentTxid
              ? "🔗 Payment TXID:\n" +
                withdrawal.paymentTxid
              : "⏳ Payment TXID هنوز ثبت نشده است."
          )
        );
      } catch (error) {
        console.error(
          "User approval message error:",
          error.message
        );
      }

      res.json({
        ok: true,
        message:
          "درخواست برداشت تأیید شد.",
        withdrawal
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در تأیید برداشت."
      });
    }
  }
);

/* =========================
   ADMIN REJECT WITHDRAWAL
========================= */

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
          "درخواست برداشت رد شد."
        ).trim();

      const store = readStore();

      const withdrawal =
        store.withdrawals.find(
          w =>
            String(w.id) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "درخواست برداشت پیدا نشد."
        });
      }

      if (
        withdrawal.status !==
        "pending"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "این درخواست قبلاً بررسی شده است."
        });
      }

      const user =
        getOrCreateUser(
          store,
          withdrawal.telegramUserId
        );

      /* Return reserved balance */

      user.balance =
        Number(user.balance || 0) +
        Number(withdrawal.amount || 0);

      withdrawal.status =
        "rejected";

      withdrawal.reason =
        reason;

      withdrawal.updatedAt =
        new Date().toISOString();

      writeStore(store);

      try {
        await sendTelegramMessage(
          withdrawal.telegramUserId,
          "❌ Withdrawal Rejected\n\n" +
          "💵 Amount: " +
          withdrawal.amount +
          " USDT\n\n" +
          "📝 Reason:\n" +
          reason +
          "\n\n" +
          "💰 مبلغ به موجودی شما برگشت داده شد."
        );
      } catch (error) {
        console.error(
          "User rejection message error:",
          error.message
        );
      }

      res.json({
        ok: true,
        message:
          "درخواست برداشت رد شد و مبلغ برگشت داده شد.",
        withdrawal
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در رد برداشت."
      });
    }
  }
);

/* =========================
   ADMIN ADD PAYMENT TXID
========================= */

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
          req.body?.paymentTxid
        );

      if (
        !isValidTxid(paymentTxid)
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Payment TXID نامعتبر است."
        });
      }

      const store = readStore();

      const withdrawal =
        store.withdrawals.find(
          w =>
            String(w.id) ===
            withdrawalId
        );

      if (!withdrawal) {
        return res.status(404).json({
          ok: false,
          message:
            "درخواست برداشت پیدا نشد."
        });
      }

      withdrawal.paymentTxid =
        paymentTxid;

      withdrawal.updatedAt =
        new Date().toISOString();

      writeStore(store);

      try {
        await sendTelegramMessage(
          withdrawal.telegramUserId,
          "💸 Payment Sent\n\n" +
          "💵 Amount: " +
          withdrawal.amount +
          " USDT\n\n" +
          "🔗 Payment TXID:\n" +
          paymentTxid
        );
      } catch (error) {
        console.error(
          "User payment message error:",
          error.message
        );
      }

      res.json({
        ok: true,
        message:
          "Payment TXID ثبت شد.",
        withdrawal
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در ثبت Payment TXID."
      });
    }
  }
);

/* =========================
   ADMIN USERS
========================= */

app.get(
  "/api/admin/users",
  requireTelegram,
  requireAdmin,
  (req, res) => {
    try {
      const store = readStore();

      res.json({
        ok: true,
        users:
          store.users.map(user => ({
            telegramUserId:
              user.telegramUserId,
            username:
              user.username,
            balance:
              Number(user.balance || 0),
            points:
              Number(user.points || 0),
            referredBy:
              user.referredBy,
            referralRewarded:
              user.referralRewarded,
            lastDailyRewardDate:
              user.lastDailyRewardDate,
            createdAt:
              user.createdAt
          }))
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message:
          "خطا در دریافت کاربران."
      });
    }
  }
);

/* =========================
   START SERVER
========================= */

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
});

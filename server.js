// ============================================================
// BIG MONEY - Telegram Mini App Backend
// USDT TRC20
// Automatic deposits + Admin-approved withdrawals
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { TronWeb } = require("tronweb");

const app = express();

app.use(express.json({ limit: "1mb" }));

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const PORT = process.env.PORT || 3000;

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
  process.env.TELEGRAM_BOT_USERNAME || "";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "*";

const TELEGRAM_AUTH_MAX_AGE =
  Number(process.env.TELEGRAM_AUTH_MAX_AGE || 86400);

const ADMIN_TELEGRAM_IDS =
  String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const WITHDRAWAL_SOURCE_ADDRESS =
  process.env.WITHDRAWAL_SOURCE_ADDRESS || "";

const WITHDRAWAL_PRIVATE_KEY =
  process.env.WITHDRAWAL_PRIVATE_KEY || "";

const USDT_DECIMALS = 6;

const MIN_WITHDRAWAL =
  Number(process.env.MIN_WITHDRAWAL || 1);

const REFERRAL_POINTS =
  Number(process.env.REFERRAL_POINTS || 3);

const AUTO_SCAN_MS =
  Number(process.env.AUTO_SCAN_MS || 15000);

const WITHDRAWAL_FEE_LIMIT =
  Number(process.env.WITHDRAWAL_FEE_LIMIT || 100000000);


// ------------------------------------------------------------
// CORS
// ------------------------------------------------------------

if (ALLOWED_ORIGIN === "*") {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: ALLOWED_ORIGIN
    })
  );
}


// ------------------------------------------------------------
// JSON DATABASE
// ------------------------------------------------------------

const DB_FILE = path.join(__dirname, "data.json");

const EMPTY_DB = {
  users: {},
  deposits: [],
  pendingDeposits: [],
  withdrawals: [],
  referrals: []
};

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(
        DB_FILE,
        JSON.stringify(EMPTY_DB, null, 2)
      );
      return JSON.parse(JSON.stringify(EMPTY_DB));
    }

    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    return {
      ...EMPTY_DB,
      ...data,
      users: data.users || {},
      deposits: data.deposits || [],
      pendingDeposits: data.pendingDeposits || [],
      withdrawals: data.withdrawals || [],
      referrals: data.referrals || []
    };
  } catch (error) {
    console.error("DB LOAD ERROR:", error);
    return JSON.parse(JSON.stringify(EMPTY_DB));
  }
}

let db = loadDB();

let dbLock = Promise.resolve();

function withStoreLock(fn) {
  const next = dbLock.then(async () => {
    const result = await fn();
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2)
    );
    return result;
  });

  dbLock = next.catch(() => {});
  return next;
}


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function now() {
  return Date.now();
}

function makeId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(4).toString("hex")
  );
}

function isValidTronAddress(address) {
  if (!address || typeof address !== "string") {
    return false;
  }

  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    address.trim()
  );
}

function toBaseUnits(amount) {
  const value = String(amount);

  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("Invalid amount");
  }

  const [whole, decimal = ""] = value.split(".");

  const padded =
    (decimal + "000000").slice(0, 6);

  return (
    BigInt(whole) * 1000000n +
    BigInt(padded)
  ).toString();
}

function fromBaseUnits(value) {
  const n = BigInt(String(value));

  const whole = n / 1000000n;
  const decimal =
    (n % 1000000n)
      .toString()
      .padStart(6, "0");

  return (
    whole.toString() +
    "." +
    decimal
  ).replace(/\.?0+$/, "");
}

function addNumbers(a, b) {
  return (
    BigInt(String(a || "0")) +
    BigInt(String(b || "0"))
  ).toString();
}

function subtractNumbers(a, b) {
  return (
    BigInt(String(a || "0")) -
    BigInt(String(b || "0"))
  ).toString();
}


// ------------------------------------------------------------
// TELEGRAM AUTH
// ------------------------------------------------------------

function validateTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!initData) {
    throw new Error("Telegram initData missing");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram hash missing");
  }

  const authDate = Number(
    params.get("auth_date") || 0
  );

  if (!authDate) {
    throw new Error("Telegram auth_date missing");
  }

  if (
    Math.floor(Date.now() / 1000) -
      authDate >
    TELEGRAM_AUTH_MAX_AGE
  ) {
    throw new Error("Telegram initData expired");
  }

  const dataCheckArray = [];

  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;

    dataCheckArray.push(
      `${key}=${value}`
    );
  }

  dataCheckArray.sort();

  const dataCheckString =
    dataCheckArray.join("\n");

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

  const a = Buffer.from(
    calculatedHash,
    "hex"
  );

  const b = Buffer.from(
    receivedHash,
    "hex"
  );

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    throw new Error(
      "Invalid Telegram signature"
    );
  }

  let user = null;

  try {
    user = JSON.parse(
      params.get("user") || "{}"
    );
  } catch {
    throw new Error("Invalid Telegram user");
  }

  if (!user || !user.id) {
    throw new Error("Telegram user missing");
  }

  return user;
}

function requireTelegram(req, res, next) {
  try {
    const initData =
      req.headers["x-telegram-init-data"];

    const user =
      validateTelegramInitData(initData);

    req.telegramUser = user;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: error.message
    });
  }
}

function requireAdmin(req, res, next) {
  try {
    const initData =
      req.headers["x-telegram-init-data"];

    const user =
      validateTelegramInitData(initData);

    const telegramId =
      String(user.id);

    if (
      !ADMIN_TELEGRAM_IDS.includes(
        telegramId
      )
    ) {
      return res.status(403).json({
        ok: false,
        error: "Admin access required"
      });
    }

    req.telegramUser = user;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: error.message
    });
  }
}


// ------------------------------------------------------------
// USER
// ------------------------------------------------------------

function getOrCreateUser(telegramUser) {
  const id =
    String(telegramUser.id);

  if (!db.users[id]) {
    db.users[id] = {
      id,
      telegramId: id,
      username:
        telegramUser.username || "",
      firstName:
        telegramUser.first_name || "",
      lastName:
        telegramUser.last_name || "",
      balanceBaseUnits: "0",
      reservedBaseUnits: "0",
      referralPoints: 0,
      createdAt: now(),
      updatedAt: now()
    };
  } else {
    db.users[id].username =
      telegramUser.username ||
      db.users[id].username ||
      "";

    db.users[id].firstName =
      telegramUser.first_name ||
      db.users[id].firstName ||
      "";

    db.users[id].lastName =
      telegramUser.last_name ||
      db.users[id].lastName ||
      "";

    if (!db.users[id].balanceBaseUnits) {
      db.users[id].balanceBaseUnits = "0";
    }

    if (!db.users[id].reservedBaseUnits) {
      db.users[id].reservedBaseUnits = "0";
    }

    db.users[id].updatedAt = now();
  }

  return db.users[id];
}


// ------------------------------------------------------------
// TRONGRID
// ------------------------------------------------------------

async function tronFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] =
      TRONGRID_API_KEY;
  }

  const response = await fetch(
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
    data = JSON.parse(text);
  } catch {
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


// ------------------------------------------------------------
// DEPOSIT SCAN
// ------------------------------------------------------------

async function getIncomingUSDTTransfers(
  minTimestamp = 0
) {
  const url =
    `${TRONGRID_URL}/v1/accounts/` +
    `${encodeURIComponent(DEPOSIT_ADDRESS)}` +
    `/transactions/trc20` +
    `?only_confirmed=true` +
    `&limit=200` +
    `&order_by=block_timestamp,desc` +
    `&contract_address=${encodeURIComponent(
      USDT_CONTRACT
    )}` +
    `&only_to=true` +
    (
      minTimestamp
        ? `&min_timestamp=${minTimestamp}`
        : ""
    );

  const data =
    await tronFetch(url);

  return Array.isArray(data.data)
    ? data.data
    : [];
}

async function verifyTransferSuccess(txid) {
  try {
    const url =
      `${TRONGRID_URL}/v1/transactions/` +
      `${encodeURIComponent(txid)}`;

    const data =
      await tronFetch(url);

    if (
      data &&
      Array.isArray(data.data) &&
      data.data.length > 0
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function findPendingDepositByPaymentAmount(
  paymentBaseUnits
) {
  return db.pendingDeposits.find(
    x =>
      x.status === "pending" &&
      String(x.paymentBaseUnits) ===
        String(paymentBaseUnits)
  );
}

async function processIncomingTransfer(
  transfer
) {
  if (!transfer) return false;

  if (
    String(transfer.to || "").toLowerCase() !==
    String(DEPOSIT_ADDRESS).toLowerCase()
  ) {
    return false;
  }

  if (
    String(
      transfer.token_info?.address || ""
    ).toLowerCase() !==
    String(USDT_CONTRACT).toLowerCase()
  ) {
    return false;
  }

  if (
    String(transfer.type || "")
      .toLowerCase() !== "trc20"
  ) {
    return false;
  }

  const txid =
    transfer.transaction_id;

  if (!txid) return false;

  const existing =
    db.deposits.find(
      x =>
        String(x.txid).toLowerCase() ===
        String(txid).toLowerCase()
    );

  if (existing) {
    return false;
  }

  const paymentBaseUnits =
    String(transfer.value || "0");

  const pending =
    findPendingDepositByPaymentAmount(
      paymentBaseUnits
    );

  if (!pending) {
    return false;
  }

  const success =
    await verifyTransferSuccess(txid);

  if (!success) {
    return false;
  }

  const user =
    db.users[
      String(pending.telegramUserId)
    ];

  if (!user) {
    return false;
  }

  user.balanceBaseUnits =
    addNumbers(
      user.balanceBaseUnits,
      pending.requestedBaseUnits
    );

  user.updatedAt = now();

  pending.status = "confirmed";
  pending.txid = txid;
  pending.confirmedAt = now();
  pending.from =
    transfer.from || "";

  db.deposits.push({
    id: makeId("dep"),
    telegramUserId:
      String(pending.telegramUserId),
    txid,
    from:
      transfer.from || "",
    to:
      transfer.to || DEPOSIT_ADDRESS,
    requestedAmount:
      fromBaseUnits(
        pending.requestedBaseUnits
      ),
    receivedAmount:
      fromBaseUnits(
        paymentBaseUnits
      ),
    requestedBaseUnits:
      pending.requestedBaseUnits,
    receivedBaseUnits:
      paymentBaseUnits,
    status: "confirmed",
    createdAt: now(),
    confirmedAt: now()
  });

  console.log(
    "AUTO DEPOSIT CONFIRMED:",
    txid,
    "USER:",
    pending.telegramUserId
  );

  return true;
}

async function autoScanDeposits() {
  try {
    const pending =
      db.pendingDeposits.filter(
        x => x.status === "pending"
      );

    if (pending.length === 0) {
      return;
    }

    const oldest =
      Math.min(
        ...pending.map(
          x => x.createdAt
        )
      );

    const transfers =
      await getIncomingUSDTTransfers(
        oldest - 60000
      );

    for (const transfer of transfers) {
      try {
        await withStoreLock(
          async () => {
            await processIncomingTransfer(
              transfer
            );
          }
        );
      } catch (error) {
        console.error(
          "DEPOSIT PROCESS ERROR:",
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      "AUTO DEPOSIT SCAN ERROR:",
      error.message
    );
  }
}


// ------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Big Money API",
    network: "TRON",
    token: "USDT TRC20"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    depositAddress:
      DEPOSIT_ADDRESS,
    usdtContract:
      USDT_CONTRACT,
    minWithdrawal:
      MIN_WITHDRAWAL
  });
});


// ------------------------------------------------------------
// ACCOUNT
// ------------------------------------------------------------

app.get(
  "/api/account",
  requireTelegram,
  async (req, res) => {
    try {
      const result =
        await withStoreLock(
          async () => {
            const user =
              getOrCreateUser(
                req.telegramUser
              );

            return {
              telegramUserId:
                user.telegramId,
              username:
                user.username,
              balance:
                fromBaseUnits(
                  user.balanceBaseUnits
                ),
              reservedBalance:
                fromBaseUnits(
                  user.reservedBaseUnits
                ),
              availableBalance:
                fromBaseUnits(
                  subtractNumbers(
                    user.balanceBaseUnits,
                    user.reservedBaseUnits
                  )
                ),
              referralPoints:
                user.referralPoints || 0
            };
          }
        );

      res.json({
        ok: true,
        account: result
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE DEPOSIT REQUEST
// ------------------------------------------------------------

app.post(
  "/api/deposits/request",
  requireTelegram,
  async (req, res) => {
    try {
      const amount =
        Number(req.body.amount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error: "Invalid amount"
        });
      }

      const requestedBaseUnits =
        toBaseUnits(
          amount.toFixed(6)
        );

      // Add unique micro-USDT amount
      // so the blockchain payment can
      // be automatically linked to the user.
      const uniqueExtra =
        1 +
        Math.floor(
          Math.random() * 999
        );

      const paymentBaseUnits =
        (
          BigInt(
            requestedBaseUnits
          ) +
          BigInt(uniqueExtra)
        ).toString();

      const deposit =
        await withStoreLock(
          async () => {
            const user =
              getOrCreateUser(
                req.telegramUser
              );

            const item = {
              id: makeId("pd"),
              telegramUserId:
                user.telegramId,
              requestedAmount:
                fromBaseUnits(
                  requestedBaseUnits
                ),
              requestedBaseUnits,
              paymentAmount:
                fromBaseUnits(
                  paymentBaseUnits
                ),
              paymentBaseUnits,
              address:
                DEPOSIT_ADDRESS,
              status: "pending",
              createdAt: now()
            };

            db.pendingDeposits.push(
              item
            );

            return item;
          }
        );

      res.json({
        ok: true,
        deposit
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// CHECK DEPOSIT
// ------------------------------------------------------------

app.post(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {
    try {
      const userId =
        String(req.telegramUser.id);

      const depositId =
        req.body.depositId;

      const pending =
        db.pendingDeposits.find(
          x =>
            x.id === depositId &&
            String(
              x.telegramUserId
            ) === userId &&
            x.status === "pending"
        );

      if (!pending) {
        return res.json({
          ok: true,
          status: "not_found"
        });
      }

      const transfers =
        await getIncomingUSDTTransfers(
          pending.createdAt - 60000
        );

      let confirmed = false;

      for (const transfer of transfers) {
        if (
          String(
            transfer.value
          ) ===
          String(
            pending.paymentBaseUnits
          )
        ) {
          confirmed =
            await withStoreLock(
              async () =>
                processIncomingTransfer(
                  transfer
                )
            );

          if (confirmed) break;
        }
      }

      if (confirmed) {
        return res.json({
          ok: true,
          status: "confirmed"
        });
      }

      res.json({
        ok: true,
        status: "pending",
        paymentAmount:
          pending.paymentAmount,
        address:
          pending.address
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// WITHDRAWAL REQUEST
// ------------------------------------------------------------

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  async (req, res) => {
    try {
      const amount =
        Number(req.body.amount);

      const address =
        String(
          req.body.address || ""
        ).trim();

      if (
        !Number.isFinite(amount) ||
        amount < MIN_WITHDRAWAL
      ) {
        return res.status(400).json({
          ok: false,
          error:
            `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT`
        });
      }

      if (!isValidTronAddress(address)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid TRON address"
        });
      }

      const amountBaseUnits =
        toBaseUnits(
          amount.toFixed(6)
        );

      const result =
        await withStoreLock(
          async () => {
            const user =
              getOrCreateUser(
                req.telegramUser
              );

            const available =
              BigInt(
                user.balanceBaseUnits
              ) -
              BigInt(
                user.reservedBaseUnits
              );

            const requested =
              BigInt(
                amountBaseUnits
              );

            if (
              requested > available
            ) {
              throw new Error(
                "Insufficient balance"
              );
            }

            // Reserve the amount.
            user.reservedBaseUnits =
              addNumbers(
                user.reservedBaseUnits,
                amountBaseUnits
              );

            user.updatedAt = now();

            const withdrawal = {
              id: makeId("wd"),
              telegramUserId:
                user.telegramId,
              username:
                user.username || "",
              amount:
                fromBaseUnits(
                  amountBaseUnits
                ),
              amountBaseUnits,
              address,
              status: "pending",
              createdAt: now(),
              approvedAt: null,
              rejectedAt: null,
              sentAt: null,
              txid: null,
              adminTelegramId: null,
              adminNote: null
            };

            db.withdrawals.push(
              withdrawal
            );

            return withdrawal;
          }
        );

      console.log(
        "NEW WITHDRAWAL REQUEST:",
        result.id,
        result.amount,
        result.address
      );

      res.json({
        ok: true,
        withdrawal: {
          id: result.id,
          amount: result.amount,
          address: result.address,
          status: result.status
        }
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// USER WITHDRAWAL HISTORY
// ------------------------------------------------------------

app.get(
  "/api/withdrawals",
  requireTelegram,
  async (req, res) => {
    try {
      const userId =
        String(req.telegramUser.id);

      const withdrawals =
        db.withdrawals
          .filter(
            x =>
              String(
                x.telegramUserId
              ) === userId
          )
          .sort(
            (a, b) =>
              b.createdAt -
              a.createdAt
          );

      res.json({
        ok: true,
        withdrawals
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN - GET PENDING WITHDRAWALS
// ------------------------------------------------------------

app.get(
  "/api/admin/withdrawals",
  requireAdmin,
  async (req, res) => {
    try {
      const list =
        db.withdrawals
          .filter(
            x =>
              x.status ===
              "pending"
          )
          .sort(
            (a, b) =>
              a.createdAt -
              b.createdAt
          );

      res.json({
        ok: true,
        withdrawals: list
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// CREATE TRC20 TRANSFER
// ------------------------------------------------------------

async function sendUSDT(
  toAddress,
  amountBaseUnits
) {
  if (!WITHDRAWAL_PRIVATE_KEY) {
    throw new Error(
      "WITHDRAWAL_PRIVATE_KEY is missing"
    );
  }

  if (!WITHDRAWAL_SOURCE_ADDRESS) {
    throw new Error(
      "WITHDRAWAL_SOURCE_ADDRESS is missing"
    );
  }

  if (
    !isValidTronAddress(
      WITHDRAWAL_SOURCE_ADDRESS
    )
  ) {
    throw new Error(
      "Invalid withdrawal source address"
    );
  }

  if (
    !isValidTronAddress(
      toAddress
    )
  ) {
    throw new Error(
      "Invalid destination address"
    );
  }

  const tronWeb =
    new TronWeb({
      fullHost:
        TRONGRID_URL,
      headers:
        TRONGRID_API_KEY
          ? {
              "TRON-PRO-API-KEY":
                TRONGRID_API_KEY
            }
          : {},
      privateKey:
        WITHDRAWAL_PRIVATE_KEY
    });

  const functionSelector =
    "transfer(address,uint256)";

  const parameters = [
    {
      type: "address",
      value: toAddress
    },
    {
      type: "uint256",
      value:
        String(amountBaseUnits)
    }
  ];

  const options = {
    feeLimit:
      WITHDRAWAL_FEE_LIMIT,
    callValue: 0
  };

  const transaction =
    await tronWeb.transactionBuilder
      .triggerSmartContract(
        USDT_CONTRACT,
        functionSelector,
        options,
        parameters,
        WITHDRAWAL_SOURCE_ADDRESS
      );

  if (
    !transaction ||
    !transaction.transaction
  ) {
    throw new Error(
      "Could not create USDT transaction"
    );
  }

  const signedTx =
    await tronWeb.trx.sign(
      transaction.transaction
    );

  const result =
    await tronWeb.trx.sendRawTransaction(
      signedTx
    );

  if (
    !result ||
    result.result !== true
  ) {
    throw new Error(
      "TRON transaction was not accepted"
    );
  }

  return (
    result.txid ||
    result.transaction?.txID ||
    transaction.transaction.txID
  );
}


// ------------------------------------------------------------
// ADMIN - APPROVE AND SEND
// ------------------------------------------------------------

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireAdmin,
  async (req, res) => {
    const withdrawalId =
      req.params.id;

    try {
      // First reserve the request for approval.
      const withdrawal =
        await withStoreLock(
          async () => {
            const item =
              db.withdrawals.find(
                x =>
                  x.id ===
                  withdrawalId
              );

            if (!item) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              item.status !==
              "pending"
            ) {
              throw new Error(
                `Withdrawal is already ${item.status}`
              );
            }

            item.status =
              "processing";

            item.approvedAt = now();

            item.adminTelegramId =
              String(
                req.telegramUser.id
              );

            return {
              ...item
            };
          }
        );

      console.log(
        "ADMIN APPROVED WITHDRAWAL:",
        withdrawal.id
      );

      let txid;

      try {
        txid =
          await sendUSDT(
            withdrawal.address,
            withdrawal.amountBaseUnits
          );
      } catch (sendError) {
        // Sending failed.
        // Return the request to pending
        // and keep the balance reserved.
        await withStoreLock(
          async () => {
            const item =
              db.withdrawals.find(
                x =>
                  x.id ===
                  withdrawal.id
              );

            if (item) {
              item.status =
                "pending";

              item.approvedAt =
                null;

              item.adminTelegramId =
                null;

              item.adminNote =
                "Send failed: " +
                sendError.message;
            }
          }
        );

        console.error(
          "WITHDRAWAL SEND ERROR:",
          sendError
        );

        return res.status(500).json({
          ok: false,
          error:
            "USDT could not be sent. Request returned to pending.",
          details:
            sendError.message
        });
      }

      // Only after TRON accepts the transaction
      // do we consume the reserved balance.
      await withStoreLock(
        async () => {
          const item =
            db.withdrawals.find(
              x =>
                x.id ===
                withdrawal.id
            );

          if (!item) {
            return;
          }

          const user =
            db.users[
              String(
                item.telegramUserId
              )
            ];

          if (!user) {
            throw new Error(
              "User not found"
            );
          }

          user.balanceBaseUnits =
            subtractNumbers(
              user.balanceBaseUnits,
              item.amountBaseUnits
            );

          user.reservedBaseUnits =
            subtractNumbers(
              user.reservedBaseUnits,
              item.amountBaseUnits
            );

          user.updatedAt = now();

          item.status =
            "sent";

          item.sentAt = now();

          item.txid = txid;
        }
      );

      console.log(
        "WITHDRAWAL SENT:",
        withdrawal.id,
        txid
      );

      res.json({
        ok: true,
        status: "sent",
        withdrawalId,
        txid
      });
    } catch (error) {
      console.error(
        "ADMIN APPROVE ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN - REJECT
// ------------------------------------------------------------

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId =
        req.params.id;

      const note =
        String(
          req.body.note || ""
        ).trim();

      const result =
        await withStoreLock(
          async () => {
            const withdrawal =
              db.withdrawals.find(
                x =>
                  x.id ===
                  withdrawalId
              );

            if (!withdrawal) {
              throw new Error(
                "Withdrawal not found"
              );
            }

            if (
              withdrawal.status !==
              "pending"
            ) {
              throw new Error(
                `Withdrawal is already ${withdrawal.status}`
              );
            }

            const user =
              db.users[
                String(
                  withdrawal.telegramUserId
                )
              ];

            if (!user) {
              throw new Error(
                "User not found"
              );
            }

            // Return reserved balance.
            user.reservedBaseUnits =
              subtractNumbers(
                user.reservedBaseUnits,
                withdrawal.amountBaseUnits
              );

            user.updatedAt = now();

            withdrawal.status =
              "rejected";

            withdrawal.rejectedAt =
              now();

            withdrawal.adminTelegramId =
              String(
                req.telegramUser.id
              );

            withdrawal.adminNote =
              note ||
              "Rejected by admin";

            return withdrawal;
          }
        );

      console.log(
        "WITHDRAWAL REJECTED:",
        result.id
      );

      res.json({
        ok: true,
        status: "rejected",
        withdrawal: result
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN - CHECK WALLET CONFIG
// ------------------------------------------------------------

app.get(
  "/api/admin/status",
  requireAdmin,
  async (req, res) => {
    res.json({
      ok: true,
      withdrawalWalletConfigured:
        Boolean(
          WITHDRAWAL_SOURCE_ADDRESS &&
          WITHDRAWAL_PRIVATE_KEY
        ),
      withdrawalSourceAddress:
        WITHDRAWAL_SOURCE_ADDRESS || "",
      usdtContract:
        USDT_CONTRACT
    });
  }
);


// ------------------------------------------------------------
// REFERRAL
// ------------------------------------------------------------

app.post(
  "/api/referral/claim",
  requireTelegram,
  async (req, res) => {
    try {
      const result =
        await withStoreLock(
          async () => {
            const user =
              getOrCreateUser(
                req.telegramUser
              );

            const referrerId =
              String(
                req.body.referrerId ||
                ""
              );

            if (
              !referrerId ||
              referrerId ===
                user.telegramId
            ) {
              return {
                ok: false,
                error:
                  "Invalid referrer"
              };
            }

            const existing =
              db.referrals.find(
                x =>
                  String(
                    x.userId
                  ) ===
                  user.telegramId
              );

            if (existing) {
              return {
                ok: false,
                error:
                  "Referral already claimed"
              };
            }

            const referrer =
              db.users[
                referrerId
              ];

            if (!referrer) {
              return {
                ok: false,
                error:
                  "Referrer not found"
              };
            }

            db.referrals.push({
              id: makeId("ref"),
              userId:
                user.telegramId,
              referrerId,
              createdAt: now()
            });

            referrer.referralPoints =
              Number(
                referrer.referralPoints ||
                  0
              ) +
              REFERRAL_POINTS;

            return {
              ok: true
            };
          }
        );

      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

app.listen(
  PORT,
  () => {
    console.log(
      "===================================="
    );

    console.log(
      "BIG MONEY SERVER STARTED"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "DEPOSIT ADDRESS:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "USDT CONTRACT:",
      USDT_CONTRACT
    );

    console.log(
      "AUTO DEPOSIT SCAN:",
      AUTO_SCAN_MS,
      "ms"
    );

    console.log(
      "WITHDRAWAL SOURCE:",
      WITHDRAWAL_SOURCE_ADDRESS ||
        "NOT CONFIGURED"
    );

    console.log(
      "WITHDRAWAL PRIVATE KEY:",
      WITHDRAWAL_PRIVATE_KEY
        ? "CONFIGURED"
        : "NOT CONFIGURED"
    );

    console.log(
      "ADMIN IDS:",
      ADMIN_TELEGRAM_IDS.join(", ") ||
        "NONE"
    );

    console.log(
      "===================================="
    );
  }
);


// ------------------------------------------------------------
// AUTO DEPOSIT SCANNER
// ------------------------------------------------------------

setInterval(
  autoScanDeposits,
  AUTO_SCAN_MS
);

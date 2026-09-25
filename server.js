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
        fs.readFileSync(DB_FILE, "utf8");

      const parsed =
        JSON.parse(raw);

      db = {
        users: parsed.users || {},
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


function getUser(telegramUserId) {

  const id =
    String(telegramUserId);

  if (!db.users[id]) {

    db.users[id] = {

      telegramUserId: id,

      username: "",

      firstName: "",

      balanceBaseUnits: 0,

      reservedBaseUnits: 0,

      referralPoints: 0,

      createdAt: nowISO(),

      updatedAt: nowISO()

    };

  }

  return db.users[id];

}


function availableBaseUnits(user) {

  return Math.max(
    0,
    Number(user.balanceBaseUnits || 0) -
    Number(user.reservedBaseUnits || 0)
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
      JSON.parse(userRaw);

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

  return telegramUser;

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

    const telegramUser =
      validateTelegramInitData(
        initData
      );

    req.telegramUser =
      telegramUser;

    const user =
      getUser(
        telegramUser.id
      );

    user.username =
      telegramUser.username ||
      user.username ||
      "";

    user.firstName =
      telegramUser.first_name ||
      user.firstName ||
      "";

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
   ROOT
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

      status:
        "online"

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
        DEPOSIT_ADDRESS

    });

  }
);


/* =========================================================
   ACCOUNT
========================================================= */

app.get(
  "/api/account",
  requireTelegram,
  (req, res) => {

    const user =
      getUser(
        req.telegramUser.id
      );

    res.json({

      ok: true,

      account: {

        telegramUserId:
          user.telegramUserId,

        username:
          user.username ||
          user.firstName ||
          "User",

        availableBalance:
          baseToUSDT(
            availableBaseUnits(user)
          ),

        reservedBalance:
          baseToUSDT(
            user.reservedBaseUnits
          ),

        totalBalance:
          baseToUSDT(
            user.balanceBaseUnits
          ),

        referralPoints:
          Number(
            user.referralPoints || 0
          )

      }

    });

  }
);


/* =========================================================
   CREATE DEPOSIT REQUEST
========================================================= */

app.post(
  "/api/deposits/request",
  requireTelegram,
  (req, res) => {

    const amountBase =
      usdtToBase(
        req.body?.amount
      );

    if (
      amountBase === null
    ) {

      return res
        .status(400)
        .json({

          ok: false,

          error:
            "Invalid deposit amount"

        });

    }

    /*
      We add a unique micro-USDT amount
      between 1 and 999 micro units.

      Example:

      User requests:
      1 USDT

      Actual payment:
      1.000347 USDT
    */

    let paymentBase;

    let uniquePart;

    let attempts = 0;

    do {

      uniquePart =
        crypto.randomInt(
          1,
          1000
        );

      paymentBase =
        amountBase +
        uniquePart;

      attempts++;

    } while (

      Object.values(
        db.pendingDeposits
      ).some(
        x =>
          x.status === "pending" &&
          Number(
            x.paymentBaseUnits
          ) === paymentBase
      ) &&
      attempts < 100

    );


    const id =
      makeId("dep");

    const deposit = {

      id,

      telegramUserId:
        String(
          req.telegramUser.id
        ),

      requestedBaseUnits:
        amountBase,

      paymentBaseUnits:
        paymentBase,

      requestedAmount:
        baseToUSDT(
          amountBase
        ),

      paymentAmount:
        baseToUSDT(
          paymentBase
        ).toFixed(6),

      address:
        DEPOSIT_ADDRESS,

      status:
        "pending",

      txid:
        null,

      createdAt:
        nowISO(),

      confirmedAt:
        null

    };


    db.pendingDeposits[id] =
      deposit;

    saveDB();


    res.json({

      ok: true,

      deposit

    });

  }
);


/* =========================================================
   CHECK DEPOSIT
========================================================= */

app.post(
  "/api/deposits/check",
  requireTelegram,
  async (req, res) => {

    try {

      const depositId =
        String(
          req.body?.depositId ||
          ""
        );

      const deposit =
        db.pendingDeposits[
          depositId
        ];

      if (!deposit) {

        return res
          .status(404)
          .json({

            ok: false,

            error:
              "Deposit request not found"

          });

      }

      if (
        String(
          deposit.telegramUserId
        ) !==
        String(
          req.telegramUser.id
        )
      ) {

        return res
          .status(403)
          .json({

            ok: false,

            error:
              "This deposit does not belong to you"

          });

      }


      if (
        deposit.status ===
        "confirmed"
      ) {

        return res.json({

          ok: true,

          status:
            "confirmed",

          deposit

        });

      }


      const found =
        await findMatchingDeposit(
          deposit
        );


      if (!found) {

        return res.json({

          ok: true,

          status:
            "pending",

          deposit

        });

      }


      const user =
        getUser(
          req.telegramUser.id
        );


      /*
        Prevent the same blockchain
        transaction from being credited twice.
      */

      if (
        db.usedTransactions[
          found.transactionId
        ]
      ) {

        return res.json({

          ok: true,

          status:
            "pending",

          deposit

        });

      }


      user.balanceBaseUnits +=
        Number(
          deposit.requestedBaseUnits
        );


      user.updatedAt =
        nowISO();


      deposit.status =
        "confirmed";

      deposit.txid =
        found.transactionId;

      deposit.confirmedAt =
        nowISO();

      deposit.blockTimestamp =
        found.blockTimestamp;


      db.usedTransactions[
        found.transactionId
      ] = {

        depositId:
          deposit.id,

        telegramUserId:
          deposit.telegramUserId,

        amountBaseUnits:
          deposit.requestedBaseUnits,

        createdAt:
          nowISO()

      };


      saveDB();


      res.json({

        ok: true,

        status:
          "confirmed",

        txid:
          found.transactionId,

        amount:
          baseToUSDT(
            deposit.requestedBaseUnits
          ),

        deposit

      });

    } catch (error) {

      console.error(
        "Deposit check error:",
        error
      );

      res
        .status(500)
        .json({

          ok: false,

          error:
            "Deposit check failed"

        });

    }

  }
);


/* =========================================================
   FIND MATCHING TRON DEPOSIT
========================================================= */

async function findMatchingDeposit(
  deposit
) {

  const url =
    TRONGRID_URL +
    "/v1/accounts/" +
    encodeURIComponent(
      DEPOSIT_ADDRESS
    ) +
    "/transactions/trc20" +
    "?limit=200" +
    "&order_by=block_timestamp,desc" +
    "&only_confirmed=true" +
    "&only_to=true" +
    "&contract_address=" +
    encodeURIComponent(
      USDT_CONTRACT
    );


  const headers = {};

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
        headers
      }
    );


  if (!response.ok) {

    throw new Error(
      "TRON API request failed: " +
      response.status
    );

  }


  const data =
    await response.json();


  const transfers =
    data.data || [];


  const target =
    Number(
      deposit.paymentBaseUnits
    );


  for (
    const tx
    of transfers
  ) {

    const to =
      String(
        tx.to || ""
      ).toLowerCase();


    if (
      to !==
      DEPOSIT_ADDRESS.toLowerCase()
    ) {

      continue;

    }


    const contract =
      String(
        tx.token_info?.address ||
        tx.contract_address ||
        ""
      ).toLowerCase();


    /*
      If TronGrid returns token contract,
      verify it is the USDT contract.
    */

    if (
      contract &&
      contract !==
        USDT_CONTRACT.toLowerCase()
    ) {

      continue;

    }


    const rawValue =
      Number(
        tx.value || 0
      );


    if (
      rawValue !== target
    ) {

      continue;

    }


    const transactionId =
      String(
        tx.transaction_id ||
        ""
      );


    if (!transactionId) {

      continue;

    }


    if (
      db.usedTransactions[
        transactionId
      ]
    ) {

      continue;

    }


    const txTime =
      Number(
        tx.block_timestamp ||
        0
      );


    const depositTime =
      new Date(
        deposit.createdAt
      ).getTime();


    /*
      Ignore blockchain transactions
      that happened before this deposit
      request was created.
    */

    if (
      txTime &&
      txTime <
        depositTime - 60000
    ) {

      continue;

    }


    return {

      transactionId,

      blockTimestamp:
        tx.block_timestamp,

      from:
        tx.from,

      to:
        tx.to,

      rawValue

    };

  }


  return null;

}


/* =========================================================
   AUTOMATIC DEPOSIT SCANNER
========================================================= */

let depositScanRunning =
  false;


async function scanPendingDeposits() {

  if (
    depositScanRunning
  ) {

    return;

  }


  depositScanRunning =
    true;


  try {

    const pending =
      Object.values(
        db.pendingDeposits
      )
      .filter(
        x =>
          x.status ===
          "pending"
      );


    for (
      const deposit
      of pending
    ) {

      try {

        const found =
          await findMatchingDeposit(
            deposit
          );


        if (!found) {

          continue;

        }


        const user =
          getUser(
            deposit.telegramUserId
          );


        if (
          db.usedTransactions[
            found.transactionId
          ]
        ) {

          continue;

        }


        user.balanceBaseUnits +=
          Number(
            deposit.requestedBaseUnits
          );


        user.updatedAt =
          nowISO();


        deposit.status =
          "confirmed";

        deposit.txid =
          found.transactionId;

        deposit.confirmedAt =
          nowISO();


        db.usedTransactions[
          found.transactionId
        ] = {

          depositId:
            deposit.id,

          telegramUserId:
            deposit.telegramUserId,

          amountBaseUnits:
            deposit.requestedBaseUnits,

          createdAt:
            nowISO()

        };


        saveDB();


        console.log(
          "Deposit confirmed:",
          deposit.id,
          found.transactionId,
          baseToUSDT(
            deposit.requestedBaseUnits
          )
        );

      } catch (error) {

        console.error(
          "Deposit scan item error:",
          error.message
        );

      }

    }

  } catch (error) {

    console.error(
      "Deposit scanner error:",
      error

    );

  } finally {

    depositScanRunning =
      false;

  }

}


setInterval(
  scanPendingDeposits,
  15000
);


/* =========================================================
   WITHDRAWAL REQUEST
========================================================= */

app.post(
  "/api/withdrawals/request",
  requireTelegram,
  (req, res) => {

    const address =
      normalizeAddress(
        req.body?.address
      );

    const amountBase =
      usdtToBase(
        req.body?.amount
      );


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
            "Invalid TRON address"

        });

    }


    if (
      amountBase === null
    ) {

      return res
        .status(400)
        .json({

          ok: false,

          error:
            "Invalid withdrawal amount"

        });

    }


    const user =
      getUser(
        req.telegramUser.id
      );


    const available =
      availableBaseUnits(
        user
      );


    if (
      amountBase >
      available
    ) {

      return res
        .status(400)
        .json({

          ok: false,

          error:
            "Insufficient available balance"

        });

    }


    /*
      Reserve the amount immediately.
      It is NOT sent to blockchain yet.
    */

    user.reservedBaseUnits +=
      amountBase;


    user.updatedAt =
      nowISO();


    const id =
      makeId("wd");


    const withdrawal = {

      id,

      telegramUserId:
        String(
          req.telegramUser.id
        ),

      username:
        req.telegramUser.username ||
        req.telegramUser.first_name ||
        "User",

      address,

      amountBaseUnits:
        amountBase,

      amount:
        baseToUSDT(
          amountBase
        ),

      status:
        "pending",

      txid:
        null,

      adminNote:
        "",

      createdAt:
        nowISO(),

      approvedAt:
        null,

      rejectedAt:
        null

    };


    db.withdrawals[id] =
      withdrawal;


    saveDB();


    res.json({

      ok: true,

      withdrawal: {

        id:
          withdrawal.id,

        amount:
          withdrawal.amount,

        address:
          withdrawal.address,

        status:
          withdrawal.status,

        createdAt:
          withdrawal.createdAt

      }

    });

  }
);


/* =========================================================
   USER WITHDRAWAL HISTORY
========================================================= */

app.get(
  "/api/withdrawals",
  requireTelegram,
  (req, res) => {

    const id =
      String(
        req.telegramUser.id
      );


    const withdrawals =
      Object.values(
        db.withdrawals
      )
      .filter(
        x =>
          String(
            x.telegramUserId
          ) === id
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      )
      .map(
        x => ({

          id:
            x.id,

          address:
            x.address,

          amount:
            x.amount,

          status:
            x.status,

          txid:
            x.txid,

          adminNote:
            x.adminNote,

          createdAt:
            x.createdAt

        })
      );


    res.json({

      ok: true,

      withdrawals

    });

  }
);


/* =========================================================
   ADMIN STATUS
========================================================= */

app.get(
  "/api/admin/status",
  requireTelegram,
  requireAdmin,
  (req, res) => {

    res.json({

      ok: true,

      admin: true

    });

  }
);


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

app.get(
  "/api/admin/withdrawals",
  requireTelegram,
  requireAdmin,
  (req, res) => {

    const withdrawals =
      Object.values(
        db.withdrawals
      )
      .filter(
        x =>
          x.status ===
          "pending"
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt) -
          new Date(b.createdAt)
      )
      .map(
        x => ({

          id:
            x.id,

          telegramUserId:
            x.telegramUserId,

          username:
            x.username,

          address:
            x.address,

          amount:
            x.amount,

          status:
            x.status,

          createdAt:
            x.createdAt

        })
      );


    res.json({

      ok: true,

      withdrawals

    });

  }
);


/* =========================================================
   APPROVE WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  requireTelegram,
  requireAdmin,
  async (req, res) => {

    const id =
      String(
        req.params.id
      );


    const withdrawal =
      db.withdrawals[id];


    if (!withdrawal) {

      return res
        .status(404)
        .json({

          ok: false,

          error:
            "Withdrawal request not found"

        });

    }


    if (
      withdrawal.status !==
      "pending"
    ) {

      return res
        .status(400)
        .json({

          ok: false,

          error:
            "Withdrawal is no longer pending"

        });

    }


    if (
      !WITHDRAWAL_SOURCE_ADDRESS ||
      !WITHDRAWAL_PRIVATE_KEY
    ) {

      return res
        .status(500)
        .json({

          ok: false,

          error:
            "Withdrawal wallet is not configured"

        });

    }


    withdrawal.status =
      "processing";


    saveDB();


    try {

      const txid =
        await sendUSDT(
          withdrawal.address,
          withdrawal.amountBaseUnits
        );


      const user =
        getUser(
          withdrawal.telegramUserId
        );


      /*
        Remove the reserved amount
        and permanently subtract it
        from the user's balance.
      */

      user.balanceBaseUnits =
        Math.max(
          0,
          Number(
            user.balanceBaseUnits
          ) -
          Number(
            withdrawal.amountBaseUnits
          )
        );


      user.reservedBaseUnits =
        Math.max(
          0,
          Number(
            user.reservedBaseUnits
          ) -
          Number(
            withdrawal.amountBaseUnits
          )
        );


      user.updatedAt =
        nowISO();


      withdrawal.status =
        "sent";

      withdrawal.txid =
        txid;

      withdrawal.approvedAt =
        nowISO();


      saveDB();


      res.json({

        ok: true,

        status:
          "sent",

        txid

      });

    } catch (error) {

      console.error(
        "Withdrawal send error:",
        error
      );


      /*
        Sending failed.
        Keep the amount reserved,
        and return the request to pending
        so Admin can try again.
      */

      withdrawal.status =
        "pending";


      saveDB();


      res
        .status(500)
        .json({

          ok: false,

          error:
            "USDT sending failed: " +
            (
              error.message ||
              "Unknown error"
            )

        });

    }

  }
);


/* =========================================================
   REJECT WITHDRAWAL
========================================================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  requireTelegram,
  requireAdmin,
  (req, res) => {

    const id =
      String(
        req.params.id
      );


    const withdrawal =
      db.withdrawals[id];


    if (!withdrawal) {

      return res
        .status(404)
        .json({

          ok: false,

          error:
            "Withdrawal request not found"

        });

    }


    if (
      withdrawal.status !==
      "pending"
    ) {

      return res
        .status(400)
        .json({

          ok: false,

          error:
            "Withdrawal is no longer pending"

        });

    }


    const user =
      getUser(
        withdrawal.telegramUserId
      );


    /*
      Return reserved amount
      to available balance.
    */

    user.reservedBaseUnits =
      Math.max(
        0,
        Number(
          user.reservedBaseUnits
        ) -
        Number(
          withdrawal.amountBaseUnits
        )
      );


    user.updatedAt =
      nowISO();


    withdrawal.status =
      "rejected";


    withdrawal.adminNote =
      String(
        req.body?.note ||
        "Rejected by administrator"
      )
      .slice(
        0,
        500
      );


    withdrawal.rejectedAt =
      nowISO();


    saveDB();


    res.json({

      ok: true,

      status:
        "rejected"

    });

  }
);


/* =========================================================
   SEND USDT
========================================================= */

async function sendUSDT(
  toAddress,
  amountBaseUnits
) {

  if (
    !WITHDRAWAL_SOURCE_ADDRESS
  ) {

    throw new Error(
      "WITHDRAWAL_SOURCE_ADDRESS is missing"
    );

  }


  if (
    !WITHDRAWAL_PRIVATE_KEY
  ) {

    throw new Error(
      "WITHDRAWAL_PRIVATE_KEY is missing"
    );

  }


  if (
    !isValidTronAddress(
      toAddress
    )
  ) {

    throw new Error(
      "Invalid destination TRON address"
    );

  }


  const tronWeb =
    new TronWeb({

      fullHost:
        TRONGRID_URL,

      privateKey:
        WITHDRAWAL_PRIVATE_KEY

    });


  const amount =
    String(
      Math.round(
        Number(
          amountBaseUnits
        )
      )
    );


  if (
    Number(amount) <= 0
  ) {

    throw new Error(
      "Invalid USDT amount"
    );

  }


  const functionSelector =
    "transfer(address,uint256)";


  const parameters = [

    {
      type:
        "address",

      value:
        toAddress

    },

    {
      type:
        "uint256",

      value:
        amount

    }

  ];


  const options = {

    feeLimit:
      100000000

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
      "Could not build USDT transaction"
    );

  }


  const signed =
    await tronWeb.trx.sign(
      transaction.transaction,
      WITHDRAWAL_PRIVATE_KEY
    );


  if (
    !signed
  ) {

    throw new Error(
      "Could not sign transaction"
    );

  }


  const result =
    await tronWeb.trx.sendRawTransaction(
      signed
    );


  if (
    !result ||
    !result.result
  ) {

    throw new Error(
      result?.message
        ? Buffer.from(
            result.message,
            "hex"
          ).toString()
        : "TRON transaction was not accepted"
    );

  }


  return (
    result.txid ||
    signed.txID
  );

}


/* =========================================================
   OPTIONAL: ADMIN DEPOSIT LIST
========================================================= */

app.get(
  "/api/admin/deposits",
  requireTelegram,
  requireAdmin,
  (req, res) => {

    const deposits =
      Object.values(
        db.pendingDeposits
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );


    res.json({

      ok: true,

      deposits

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
      "======================================"
    );

    console.log(
      "Big Money Backend"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Network: TRON TRC20"
    );

    console.log(
      "Deposit address:",
      DEPOSIT_ADDRESS
    );

    console.log(
      "Telegram auth:",
      TELEGRAM_BOT_TOKEN
        ? "configured"
        : "MISSING"
    );

    console.log(
      "TronGrid API key:",
      TRONGRID_API_KEY
        ? "configured"
        : "MISSING"
    );

    console.log(
      "Admin IDs:",
      ADMIN_TELEGRAM_IDS.length
    );

    console.log(
      "Withdrawal wallet:",
      WITHDRAWAL_SOURCE_ADDRESS
        ? "configured"
        : "MISSING"
    );

    console.log(
      "Withdrawal private key:",
      WITHDRAWAL_PRIVATE_KEY
        ? "configured"
        : "MISSING"
    );

    console.log(
      "======================================"
    );

  }
);

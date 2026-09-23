# Big Money Backend

Starter backend for the Big Money Telegram Mini App.

Render settings:
- Runtime: Node
- Build Command: npm install
- Start Command: npm start

Environment variables:
- DEPOSIT_ADDRESS = public TRON deposit address
- TRONGRID_API_KEY = TronGrid API key, if required
- USDT_CONTRACT = TRC20 USDT contract

This starter scans incoming TRC20 transfers and records deposit/withdrawal requests.

It intentionally does NOT:
- store a private key
- sign transactions
- broadcast withdrawals
- automatically credit balances

Never put a mnemonic, private key, wallet password, or BotFather token in GitHub.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

let DB_PATH = null;
let state = null;

function defaultState() {
  return {
    transactions: [],
    // categories: primary -> [secondary...]
    categories: {
      "工资": ["月薪", "奖金"],
      "餐饮": ["日常购物", "外出就餐"],
      "交通": ["公交/地铁", "打车"],
      "其它": ["杂项"]
    },
    changeLogs: [] // 全局变更日志（例如删除记录快照）
  };
}

function load() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    state = JSON.parse(raw);
    // ensure structure compatibility
    if (!state.changeLogs) state.changeLogs = [];
    if (!state.transactions) state.transactions = [];
    if (!state.categories) state.categories = {};
  } catch (e) {
    state = defaultState();
    save();
  }
}

function save() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function init(userDataPath) {
  DB_PATH = path.join(userDataPath, 'bookkeeping_data.json');
  load();
}

function getState() {
  return JSON.parse(JSON.stringify(state));
}

function addTransaction(tx) {
  const newTx = {
    id: randomUUID(),
    type: tx.type,
    amount: Number(tx.amount),
    date: tx.date,
    primaryCategory: tx.primaryCategory,
    secondaryCategory: tx.secondaryCategory,
    notes: tx.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: null,
    history: [] // 每条记录的历史
  };
  // initial history entry
  newTx.history.push({
    eventId: randomUUID(),
    action: 'created',
    timestamp: newTx.createdAt,
    snapshot: JSON.parse(JSON.stringify(newTx))
  });
  state.transactions.unshift(newTx);
  save();
  return newTx;
}

function updateTransaction(id, fields) {
  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const t = state.transactions[idx];
  const allowed = ['type','amount','date','primaryCategory','secondaryCategory','notes'];
  const before = {};
  const after = {};
  let changed = false;
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      const newVal = (k === 'amount') ? Number(fields[k]) : fields[k];
      const oldVal = t[k];
      // treat undefined vs '' carefully
      const oldStr = (oldVal === undefined || oldVal === null) ? '' : String(oldVal);
      const newStr = (newVal === undefined || newVal === null) ? '' : String(newVal);
      if (oldStr !== newStr) {
        before[k] = oldVal;
        after[k] = newVal;
        changed = true;
        // apply change
        if (k === 'amount') t[k] = Number(newVal);
        else t[k] = newVal;
      }
    }
  }
  if (!changed) return t; // nothing changed
  t.updatedAt = new Date().toISOString();
  // append history entry
  t.history.push({
    eventId: randomUUID(),
    action: 'updated',
    timestamp: t.updatedAt,
    changedFields: Object.keys(after),
    before,
    after
  });
  save();
  return JSON.parse(JSON.stringify(t));
}

function deleteTransaction(id) {
  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx === -1) return false;
  const t = state.transactions[idx];
  const snapshot = JSON.parse(JSON.stringify(t));
  const deletedAt = new Date().toISOString();
  // push a global change log for deletion (so删除也有记录)
  state.changeLogs.push({
    logId: randomUUID(),
    action: 'deleted',
    timestamp: deletedAt,
    transactionId: id,
    snapshot
  });
  // remove transaction
  state.transactions.splice(idx, 1);
  save();
  return true;
}

function getCategories() {
  return JSON.parse(JSON.stringify(state.categories));
}

function addCategory(primary, secondary) {
  if (!primary) return false;
  if (!state.categories[primary]) state.categories[primary] = [];
  if (secondary && !state.categories[primary].includes(secondary)) {
    state.categories[primary].push(secondary);
    save();
  } else if (!secondary) {
    save();
  }
  return true;
}

function getTransactionHistory(id) {
  // find transaction and return its history (newest first)
  const t = state.transactions.find(x => x.id === id);
  if (!t) {
    // If not found, maybe it was deleted — include any deletion logs
    const logs = state.changeLogs.filter(l => l.transactionId === id).map(l => ({
      eventId: l.logId,
      action: l.action,
      timestamp: l.timestamp,
      snapshot: l.snapshot
    }));
    return logs.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
  }
  // return transaction.history (copy) in reverse chronological order
  const h = (t.history || []).slice().reverse();
  return JSON.parse(JSON.stringify(h));
}

module.exports = {
  init,
  getState,
  addTransaction,
  getCategories,
  addCategory,
  updateTransaction,
  deleteTransaction,
  getTransactionHistory
};
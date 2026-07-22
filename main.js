// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./db'); // 确认 db.js 导出下面使用的函数

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  // 可选：打开 DevTools 调试（开发时用）
  try { win.webContents.openDevTools({ mode: 'detach' }); } catch(e){}

  win.loadFile('index.html').catch(err => console.error('loadFile error:', err));
}

app.whenReady().then(async () => {
  try {
    await db.init(app.getPath('userData')); // 如果 db.init 存在
    console.log('db.init OK');
  } catch (e) {
    console.error('db.init error', e);
  }

  // 注册 IPC handlers：与 preload.exposeInMainWorld 中的方法一一对应
  ipcMain.handle('get-state', async () => {
    return await (db.getState ? db.getState() : { transactions: [], categories: {} });
  });

  ipcMain.handle('get-categories', async () => {
    return await (db.getCategories ? db.getCategories() : (db.getState ? (await db.getState()).categories : {}));
  });

  ipcMain.handle('add-transaction', async (event, tx) => {
    if (db.addTransaction) return await db.addTransaction(tx);
    throw new Error('addTransaction not implemented in db');
  });

  ipcMain.handle('update-transaction', async (event, id, fields) => {
    if (db.updateTransaction) return await db.updateTransaction(id, fields);
    throw new Error('updateTransaction not implemented in db');
  });

  ipcMain.handle('delete-transaction', async (event, id) => {
    if (db.deleteTransaction) return await db.deleteTransaction(id);
    throw new Error('deleteTransaction not implemented in db');
  });

  ipcMain.handle('add-category', async (event, primary, secondary) => {
    if (db.addCategory) return await db.addCategory(primary, secondary);
    throw new Error('addCategory not implemented in db');
  });

  ipcMain.handle('get-transaction-history', async (event, id) => {
    if (db.getTransactionHistory) return await db.getTransactionHistory(id);
    return [];
  });

  ipcMain.handle('export-csv', async () => {
    if (db.exportCSV) return await db.exportCSV();
    return { ok: false, reason: 'not implemented' };
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 给渲染进程
contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  getCategories: () => ipcRenderer.invoke('get-categories'),
  addTransaction: (tx) => ipcRenderer.invoke('add-transaction', tx),
  updateTransaction: (id, fields) => ipcRenderer.invoke('update-transaction', id, fields),
  deleteTransaction: (id) => ipcRenderer.invoke('delete-transaction', id),
  addCategory: (primary, secondary) => ipcRenderer.invoke('add-category', primary, secondary),
  getTransactionHistory: (id) => ipcRenderer.invoke('get-transaction-history', id),
  exportCSV: () => ipcRenderer.invoke('export-csv')
});

// 将未捕获错误/Promise rejection 发回主进程（主进程可以把这些日志打印到终端）
window.addEventListener('error', (e) => {
  try { ipcRenderer.send('renderer-log', `window.error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`); } catch (_) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try { ipcRenderer.send('renderer-log', `unhandledrejection: ${String(e.reason)}`); } catch (_) {}
});
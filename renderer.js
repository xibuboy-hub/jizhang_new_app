// renderer.js — Updated: button blur + stopPropagation + global keydown debug + robust focus
// Added startFocusPolling to repeatedly attempt focusing the amount input for a short period.
;(function(){
  'use strict';

  const api = (typeof window !== 'undefined' && window.api) ? window.api : null;

  let state = { transactions: [], categories: {} };
  let editingId = null;
  let filter = { type:'all', from:'', to:'', primary:'all', secondary:'all' };

  const DEFAULT_CATEGORIES = {
    "工资":["月薪","奖金"],
    "餐饮":["日常购物","外出就餐"],
    "交通":["公交/地铁","打车"],
    "其它":["杂项"]
  };

  function createOption(value, text) {
    const opt = document.createElement('option');
    opt.value = value == null ? '' : String(value);
    opt.textContent = text !== undefined ? String(text) : (value == null ? '' : String(value));
    return opt;
  }
  function setText(id, txt){
    const e = document.getElementById(id);
    if (e) e.innerText = (typeof txt === 'number') ? txt.toFixed(2) : String(txt);
  }

  function normalizeCategories(rawCats, transactions = []) {
    if (!rawCats || (typeof rawCats === 'object' && Object.keys(rawCats).length === 0)) {
      const inferred = inferCategoriesFromTransactions(transactions);
      if (Object.keys(inferred).length) return inferred;
      return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }
    if (typeof rawCats === 'string') {
      try { return normalizeCategories(JSON.parse(rawCats), transactions); } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)); }
    }
    if (Array.isArray(rawCats)) {
      const out = {};
      for (const it of rawCats) {
        if (typeof it === 'string') out[it] = [];
        else if (it && it.primary) out[it.primary] = Array.isArray(it.secondaries) ? it.secondaries.slice() : [];
      }
      if (Object.keys(out).length) return out;
    }
    if (typeof rawCats === 'object') {
      const out = {};
      for (const k of Object.keys(rawCats)) {
        const v = rawCats[k];
        out[k] = Array.isArray(v) ? v.slice() : (v ? [String(v)] : []);
      }
      return out;
    }
    return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }
  function inferCategoriesFromTransactions(txs) {
    const map = {};
    for (const t of txs || []) {
      const p = t.primaryCategory || '其它';
      const s = t.secondaryCategory || '杂项';
      if (!map[p]) map[p] = new Set();
      map[p].add(s);
    }
    const out = {};
    for (const k of Object.keys(map)) out[k] = Array.from(map[k]);
    return out;
  }

  /* ---------- overlay / focus helpers ---------- */
  function isElementCovered(el) {
    try {
      if (!el || !el.getBoundingClientRect) return true;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width/2);
      const cy = Math.round(r.top + r.height/2);
      let top = document.elementFromPoint(cx, cy);
      if (!top) return true;
      if (top.nodeType === Node.TEXT_NODE) top = top.parentElement;
      while (top) {
        if (top === el) return false;
        top = top.parentElement;
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  function dumpOverlapsOver(el) {
    if (!el) return [];
    const r = el.getBoundingClientRect();
    const all = Array.from(document.querySelectorAll('body *'));
    const hits = [];
    for (const n of all) {
      if (n === el) continue;
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      const nr = n.getBoundingClientRect();
      const intersect = !(nr.right < r.left || nr.left > r.right || nr.bottom < r.top || nr.top > r.bottom);
      if (intersect) {
        hits.push({
          tag: n.tagName,
          id: n.id || null,
          class: n.className || null,
          z: s.zIndex || 'auto',
          pointerEvents: s.pointerEvents,
          display: s.display,
          visibility: s.visibility,
          opacity: s.opacity
        });
      }
    }
    return hits;
  }

  /* ---------- Robust focus logic ---------- */
  function focusWhenStable(selector = '#amount', opts = {}) {
    const timeoutMs = opts.timeoutMs || 5000;
    const stableMs = opts.stableMs || 140;
    const el = document.querySelector(selector);
    if (!el) { console.warn('focusWhenStable: element not found', selector); return; }
    try { el.readOnly = false; el.disabled = false; el.removeAttribute && el.removeAttribute('readonly'); el.removeAttribute && el.removeAttribute('disabled'); } catch(e){}
    let lastMutation = Date.now();
    let done = false;
    let observer;
    const tryFocusIfStable = () => {
      if (done) return;
      const now = Date.now();
      if (now - lastMutation < stableMs) return;
      const disabled = !!el.disabled;
      const readonly = !!el.readOnly;
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const covered = isElementCovered(el);
      if (!disabled && !readonly && visible && !covered) {
        try { el.focus(); el.select && el.select(); console.info('focusWhenStable: focused', {elapsed: now - startTime}); } catch(e){ console.warn('focusWhenStable: focus failed', e); }
        done = true; observer && observer.disconnect(); clearTimeout(timeoutTimer);
      } else {
        if (covered && (now - startTime) % 500 < 40) {
          const overlaps = dumpOverlapsOver(el);
          console.warn('focusWhenStable: input appears covered; overlaps=', overlaps);
        }
      }
    };
    const startTime = Date.now();
    const timeoutTimer = setTimeout(()=>{ if(!done){ console.warn('focusWhenStable: timeout'); done=true; observer&&observer.disconnect(); } }, timeoutMs);
    tryFocusIfStable();
    if (done) return;
    observer = new MutationObserver((mutationsList)=>{ lastMutation = Date.now(); setTimeout(tryFocusIfStable, stableMs + 10); });
    try {
      observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['style','class','hidden','aria-hidden'] });
    } catch(e) {
      console.warn('focusWhenStable: observer failed, fallback polling', e);
      const poll = setInterval(()=>{ tryFocusIfStable(); if(done || Date.now()-startTime>timeoutMs) clearInterval(poll); }, Math.max(80, stableMs));
    }
  }
  function ensureAmountEditableAndFocus(opts = {}) {
    const el = document.getElementById('amount');
    if (el) {
      try { el.readOnly = false; el.disabled = false; el.removeAttribute && el.removeAttribute('readonly'); el.removeAttribute && el.removeAttribute('disabled'); el.focus(); el.select && el.select(); } catch(e){}
    }
    focusWhenStable('#amount', opts);
  }

  // startFocusPolling: repeatedly attempt to focus the amount input for a short duration.
  function startFocusPolling(duration = 4000, interval = 80) {
    const getEl = () => document.getElementById('amount');
    const start = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const a = getEl();
      if (!a) {
        if (now - start > duration) clearInterval(timer);
        return;
      }
      try {
        // quick checks for visibility and editability
        const visible = !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length);
        if (!a.disabled && !a.readOnly && visible) {
          a.focus();
          a.select && a.select();
          console.info('startFocusPolling: focused amount input');
          clearInterval(timer);
          return;
        }
      } catch (e) {
        // ignore and continue
      }
      if (now - start > duration) {
        clearInterval(timer);
        console.warn('startFocusPolling: timeout without success');
      }
    }, interval);
    return timer;
  }

  /* ---------- rendering helpers ---------- */
  async function renderCategories() {
    const primSel = document.getElementById('primary-category');
    const secSel = document.getElementById('secondary-category');
    if (!primSel || !secSel) return;
    primSel.innerHTML = '';
    const keys = Object.keys(state.categories || {});
    if (keys.length === 0) primSel.appendChild(createOption('','(无)'));
    else for (const p of keys) primSel.appendChild(createOption(p));
    populateSecondary();
  }
  async function renderFilterCategories() {
    const primSel = document.getElementById('filter-primary');
    const secSel = document.getElementById('filter-secondary');
    if (!primSel || !secSel) return;
    primSel.innerHTML = '';
    primSel.appendChild(createOption('all','全部'));
    const primaryKeys = Object.keys(state.categories || {});
    for (const p of primaryKeys) primSel.appendChild(createOption(p));
    if (filter.primary !== 'all' && primaryKeys.includes(filter.primary)) primSel.value = filter.primary;
    else { primSel.value = 'all'; filter.primary = 'all'; }
    populateFilterSecondary();
  }
  function populateSecondary() {
    const prim = (document.getElementById('primary-category')||{}).value;
    const secSel = document.getElementById('secondary-category');
    if (!secSel) return;
    secSel.innerHTML = '';
    const secs = (state.categories && state.categories[prim]) || [];
    if (!secs || secs.length === 0) secSel.appendChild(createOption('','(无)'));
    else for (const s of secs) secSel.appendChild(createOption(s));
  }
  function populateFilterSecondary() {
    const prim = (document.getElementById('filter-primary')||{}).value;
    const secSel = document.getElementById('filter-secondary');
    if (!secSel) return;
    secSel.innerHTML = '';
    if (!prim || prim === 'all') { secSel.appendChild(createOption('all','全部')); return; }
    const secs = (state.categories && state.categories[prim]) || [];
    secSel.appendChild(createOption('all','全部'));
    for (const s of secs) secSel.appendChild(createOption(s));
  }

  function renderPreview(txs) {
    const income = txs.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0);
    const expense = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);
    setText('preview-count', txs.length);
    setText('preview-income', income);
    setText('preview-expense', expense);
    setText('preview-balance', income - expense);
  }

  function renderList(txs) {
    const list = document.getElementById('tx-list');
    if (!list) return;
    list.innerHTML = '';
    for (const t of txs) {
      const item = document.createElement('div'); item.className='tx-item';
      const left = document.createElement('div'); left.className='tx-left';
      const amt = document.createElement('div'); amt.className='tx-amount'; amt.innerText = (t.type==='income'?'+':'-')+Number(t.amount||0).toFixed(2);
      const meta = document.createElement('div'); meta.className='tx-meta'; meta.innerText = `${t.date} · ${t.primaryCategory||'(无)'} / ${t.secondaryCategory||'(无)'} · ${t.notes||''}`;
      left.appendChild(amt); left.appendChild(meta);
      const right = document.createElement('div'); right.innerText = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';

      const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='8px';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.innerText = '编辑';
      editBtn.className = 'btn-edit';
      editBtn.addEventListener('click', (evt) => {
        try { evt.preventDefault(); evt.stopPropagation(); evt.currentTarget && evt.currentTarget.blur(); } catch(e){}
        console.log('EDIT click -> activeElement before startEdit:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
        startEdit(t.id);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.innerText = '删除';
      delBtn.className = 'btn-del';
      delBtn.addEventListener('click', (evt) => {
        try { evt.preventDefault(); evt.stopPropagation(); evt.currentTarget && evt.currentTarget.blur(); } catch(e){}
        console.log('DELETE click -> activeElement before onDelete:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
        onDelete(t.id);
      });

      actions.appendChild(editBtn); actions.appendChild(delBtn);
      const rightWrapper = document.createElement('div'); rightWrapper.style.display='flex'; rightWrapper.style.flexDirection='column'; rightWrapper.style.alignItems='flex-end';
      rightWrapper.appendChild(right); rightWrapper.appendChild(actions);
      item.appendChild(left); item.appendChild(rightWrapper);
      list.appendChild(item);
    }
  }

  function renderTotals() {
    const txs = state.transactions || [];
    const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
    const balance = income - expense;
    setText('preview-count', txs.length);
    setText('preview-income', income);
    setText('preview-expense', expense);
    setText('preview-balance', balance);
  }

  function applyFilter() {
    return (state.transactions || []).filter(t=>{
      if (filter.type !== 'all' && t.type !== filter.type) return false;
      if (filter.from && t.date < filter.from) return false;
      if (filter.to && t.date > filter.to) return false;
      if (filter.primary !== 'all' && t.primaryCategory !== filter.primary) return false;
      if (filter.secondary !== 'all' && t.secondaryCategory !== filter.secondary) return false;
      return true;
    });
  }
  function applyAndRender() {
    const txs = applyFilter();
    renderPreview(txs);
    renderList(txs);
  }

  async function reloadState() {
    console.log && console.log('reloadState: start');
    try {
      if (api && typeof api.getState === 'function') {
        const s = await api.getState();
        state = s || { transactions: [], categories: {} };
        console.log && console.log('reloadState: got state counts:', (state.transactions || []).length, 'categories:', Object.keys(state.categories||{}).length);
      } else {
        console.warn('reloadState: api.getState not available');
      }
    } catch (e) {
      console.warn('reloadState: getState failed', e);
    }

    state.categories = normalizeCategories(state.categories, state.transactions);
    await renderCategories();
    await renderFilterCategories();

    try { renderTotals(); } catch (e) { console.warn('renderTotals failed', e); }
    try { applyAndRender(); } catch (e) {
      console.warn('applyAndRender failed, fallback', e);
      const txsFallback = applyFilter();
      renderPreview(txsFallback);
      renderList(txsFallback);
    }

    try { ensureAmountEditableAndFocus(); } catch (e) { /* ignore */ }
  }

  async function onFormSubmit(ev) {
    ev.preventDefault();
    const type = (document.querySelector('input[name="type"]:checked')||{}).value || 'expense';
    const amount = (document.getElementById('amount')||{}).value;
    const date = (document.getElementById('date')||{}).value;
    let primary = (document.getElementById('primary-category')||{}).value || '';
    const newPrimary = (document.getElementById('new-primary')||{}).value.trim();
    if (newPrimary) primary = newPrimary;
    let secondary = (document.getElementById('secondary-category')||{}).value || '';
    const newSecondary = (document.getElementById('new-secondary')||{}).value.trim();
    if (newSecondary) secondary = newSecondary;
    const notes = (document.getElementById('notes')||{}).value || '';
    if (!amount || !date) { alert('请填写金额和日期'); return; }

    try {
      if (!api) throw new Error('api not available');
      if (newPrimary) {
        if (typeof api.addCategory === 'function') await api.addCategory(newPrimary, newSecondary || '');
        await reloadState();
        primary = newPrimary;
      } else if (newSecondary) {
        if (typeof api.addCategory === 'function') await api.addCategory(primary, newSecondary);
        await reloadState();
      }

      if (editingId) {
        const fields = { type, amount: Number(amount), date, primaryCategory: primary || '无', secondaryCategory: secondary || '无', notes };
        if (typeof api.updateTransaction === 'function') await api.updateTransaction(editingId, fields);
      } else {
        if (typeof api.addTransaction === 'function') await api.addTransaction({ type, amount: Number(amount), date, primaryCategory: primary || '无', secondaryCategory: secondary || '无', notes });
      }

      await reloadState();
      try { renderTotals(); } catch(e){}
      resetForm();
    } catch (err) {
      console.error('Save error', err);
      alert('保存失败：' + (err && err.message ? err.message : err));
    }
  }

  function resetForm() {
    editingId = null;
    const incomeRadio = document.querySelector('input[name="type"][value="income"]'); if (incomeRadio) incomeRadio.checked=true;
    const amtEl = document.getElementById('amount');
    if (amtEl) amtEl.value = '';
    if (document.getElementById('notes')) document.getElementById('notes').value='';
    if (document.getElementById('new-primary')) document.getElementById('new-primary').value='';
    if (document.getElementById('new-secondary')) document.getElementById('new-secondary').value='';
    if (document.getElementById('date')) document.getElementById('date').value=new Date().toISOString().slice(0,10);
    const cancelBtn = document.getElementById('cancel-edit'); if (cancelBtn) { cancelBtn.type='button'; cancelBtn.style.display='none'; }
    updateFormTitle();

    if (amtEl) {
      try { amtEl.disabled = false; amtEl.readOnly = false; amtEl.removeAttribute && amtEl.removeAttribute('disabled'); amtEl.removeAttribute && amtEl.removeAttribute('readonly'); } catch(e){}
      ensureAmountEditableAndFocus();
      // also start polling as a fallback
      try { startFocusPolling(3000, 80); } catch(e){}
    }
  }

  function updateFormTitle() {
    const h = document.querySelector('.left h2'); if (h) h.innerText = editingId ? '编辑记录' : '新增 / 编辑 记录';
  }

  async function startEdit(id) {
    console.log('startEdit start -> activeElement:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    const t = (state.transactions||[]).find(x=>x.id===id);
    if (!t) return alert('记录不存在');
    editingId = id;
    try { const rr = document.querySelector(`input[name="type"][value="${t.type}"]`); if (rr) rr.checked = true; } catch(e){}
    if (document.getElementById('amount')) document.getElementById('amount').value = Number(t.amount||0).toFixed(2);
    if (document.getElementById('date')) document.getElementById('date').value = t.date || new Date().toISOString().slice(0,10);

    if (!state.categories[t.primaryCategory]) {
      try {
        if (api && typeof api.addCategory === 'function') {
          await api.addCategory(t.primaryCategory||'其它','');
          await reloadState();
        }
      } catch(e){ console.warn('ensure primary category failed', e); }
    }

    await renderCategories();
    if (document.getElementById('primary-category')) document.getElementById('primary-category').value = t.primaryCategory || '';
    populateSecondary();
    if (document.getElementById('secondary-category')) document.getElementById('secondary-category').value = t.secondaryCategory || '';
    if (document.getElementById('notes')) document.getElementById('notes').value = t.notes || '';
    if (document.getElementById('new-primary')) document.getElementById('new-primary').value = '';
    if (document.getElementById('new-secondary')) document.getElementById('new-secondary').value = '';
    const cancelBtn = document.getElementById('cancel-edit'); if (cancelBtn) { cancelBtn.type='button'; cancelBtn.style.display='inline-block'; }
    updateFormTitle();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    ensureAmountEditableAndFocus();
    try { startFocusPolling(3000, 80); } catch(e){}
    console.log('startEdit end -> activeElement:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  }

  async function onDelete(id) {
    console.log('onDelete start -> activeElement:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    if (!confirm('确定要删除这条记录吗？')) return;
    try {
      if (!api) throw new Error('api not available');
      if (typeof api.deleteTransaction === 'function') {
        const ok = await api.deleteTransaction(id);
        if (ok) {
          await reloadState();
          ensureAmountEditableAndFocus();
          // start polling as a fallback to repeatedly try focusing while overlays/race resolve
          try { startFocusPolling(4000, 80); } catch(e){}
        } else alert('删除失败');
      } else throw new Error('deleteTransaction not implemented');
    } catch (e) {
      console.error('delete error', e);
      alert('删除失败：' + (e && e.message ? e.message : e));
    }
    console.log('onDelete end -> activeElement:', document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  }

  async function showHistory(id) {
    try {
      if (!api || typeof api.getTransactionHistory !== 'function') return alert('历史功能不可用');
      const list = await api.getTransactionHistory(id) || [];
      const body = document.getElementById('history-body'); if (!body) return;
      body.innerHTML = '';
      if (!list.length) body.innerHTML = '<div class="history-entry"><div class="meta">无历史记录</div></div>';
      else {
        for (const entry of list) {
          const div = document.createElement('div'); div.className='history-entry';
          const meta = document.createElement('div'); meta.className='meta'; meta.innerText = `${entry.action} · ${new Date(entry.timestamp).toLocaleString()}`;
          div.appendChild(meta);
          if (entry.snapshot) { const pre = document.createElement('pre'); pre.innerText = JSON.stringify(entry.snapshot, null, 2); div.appendChild(pre); }
          body.appendChild(div);
        }
      }
      const modal = document.getElementById('history-modal'); if (modal) modal.style.display='flex';
    } catch (e) {
      console.error('showHistory error', e);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      window.addEventListener('keydown', (e) => {
        console.debug('GLOBAL keydown (capture):', e.key, 'target=', (e.target && (e.target.id || e.target.tagName)), 'defaultPrevented=', e.defaultPrevented);
      }, true);
    } catch (e) { /* ignore */ }

    const form = document.getElementById('tx-form');
    if (form) form.addEventListener('submit', onFormSubmit);

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'filter-apply') { e.preventDefault(); applyAndRender(); }
      if (e.target && e.target.id === 'filter-reset') {
        e.preventDefault();
        filter = { type:'all', from:'', to:'', primary:'all', secondary:'all'};
        const ft = document.getElementById('filter-type'); if (ft) ft.value='all';
        renderFilterCategories();
        applyAndRender();
      }
    });

    const prim = document.getElementById('primary-category');
    if (prim) prim.addEventListener('change', populateSecondary);
    const fprim = document.getElementById('filter-primary');
    if (fprim) fprim.addEventListener('change', populateFilterSecondary);

    const cancelBtn = document.getElementById('cancel-edit');
    if (cancelBtn) { cancelBtn.type='button'; cancelBtn.addEventListener('click', (e) => { e.preventDefault(); resetForm(); }); }

    window.addEventListener('focus', () => { try { ensureAmountEditableAndFocus(); startFocusPolling(3000, 80); } catch(e){} });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') try { ensureAmountEditableAndFocus(); startFocusPolling(3000, 80); } catch(e){} });

    reloadState().catch(e => console.error('init reloadState failed', e));
    updateFormTitle();
  });

  if (typeof window !== 'undefined') {
    window.__app_debug = window.__app_debug || {};
    window.__app_debug.reloadState = reloadState;
    window.__app_debug.getState = () => state;
    window.__app_debug.ensureAmount = ensureAmountEditableAndFocus;
    window.__app_debug.dumpOverlaps = function(){ const el = document.getElementById('amount'); return dumpOverlapsOver(el); };
    window.__app_debug.focusWhenStable = focusWhenStable;
    window.__app_debug.startFocusPolling = startFocusPolling;
  }

})(); // end IIFE
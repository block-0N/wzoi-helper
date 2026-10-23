import * as vscode from 'vscode';

export class ProblemListPanel {
  public static currentPanel: ProblemListPanel | undefined;
  public static readonly viewType = 'wzoiProblemList';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openProblem' && msg.ps && msg.pid) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblem',
            String(msg.ps),
            String(msg.pid)
          );
        } else if (msg?.type === 'debug') {
          console.log('[ProblemListPanel-webview]', msg.message);
          if (msg.stack) console.log('[ProblemListPanel-webview-stack]', msg.stack);
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    ProblemListPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    globalStorageUri: vscode.Uri,
    dataUri: vscode.Uri,
    scoreUri: vscode.Uri
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (ProblemListPanel.currentPanel) {
      ProblemListPanel.currentPanel.panel.reveal(column);
      ProblemListPanel.currentPanel.panel.webview.html = render(
        ProblemListPanel.currentPanel.panel.webview,
        dataUri,
        scoreUri
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ProblemListPanel.viewType,
      'WZOI 题库',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri, globalStorageUri],
      }
    );

    panel.webview.html = render(panel.webview, dataUri, scoreUri);
    ProblemListPanel.currentPanel = new ProblemListPanel(panel, extensionUri);
  }
}

function render(
  webview: vscode.Webview,
  dataUri: vscode.Uri,
  scoreUri: vscode.Uri
): string {
  const bust = '?t=' + Date.now();
  const dataWebUri = webview.asWebviewUri(dataUri).toString() + bust;
  const scoreWebUri = webview.asWebviewUri(scoreUri).toString() + bust;
  const nonce = makeNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
    style-src 'unsafe-inline';
    script-src 'nonce-${nonce}';
    connect-src ${webview.cspSource};">
<style>
  :root {
    --fg: var(--vscode-foreground);
    --bg: var(--vscode-editor-background);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border);
    --card: var(--vscode-editorWidget-background);
    --accent: var(--vscode-textLink-foreground);
    --hover: rgba(127,127,127,0.08);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 13px;
    color: var(--fg);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #loading { padding: 40px; text-align: center; color: var(--muted); }
  .toolbar {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; border-bottom: 1px solid var(--border);
    background: var(--card); flex-shrink: 0;
  }
  .toolbar input[type="text"] {
    flex: 1; max-width: 360px; padding: 6px 12px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg); color: var(--fg); font-size: 13px; outline: none;
  }
  .toolbar input[type="text"]:focus { border-color: var(--accent); }
  .toolbar select {
    padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg); color: var(--fg); font-size: 13px; outline: none; cursor: pointer;
  }
  .toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  .toolbar .stat { margin-left: auto; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .layout { display: flex; flex: 1; min-height: 0; }
  .sidebar {
    width: 200px; border-right: 1px solid var(--border);
    background: var(--card); overflow-y: auto; flex-shrink: 0; padding: 12px 0;
  }
  .filter-group { padding: 0 14px 14px; }
  .filter-group h3 {
    font-size: 12px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.5px; margin: 4px 0 8px;
  }
  .filter-item {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 0; cursor: pointer; user-select: none; font-size: 13px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .filter-item:hover { color: var(--accent); }
  .filter-item input { margin: 0; cursor: pointer; flex-shrink: 0; }
  .filter-item .count { color: var(--muted); margin-left: auto; font-size: 11px; flex-shrink: 0; }
  .filter-empty { color: var(--muted); font-size: 12px; }
  .content { flex: 1; overflow: auto; min-width: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th {
    position: sticky; top: 0; background: var(--card); font-weight: 600;
    padding: 8px 12px; border-bottom: 1px solid var(--border);
    text-align: left; white-space: nowrap; z-index: 2;
  }
  tbody td { padding: 7px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tbody tr:hover { background: var(--hover); }
  .col-pid { width: 80px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .col-title { min-width: 260px; }
  .col-title a { color: var(--accent); text-decoration: none; cursor: pointer; }
  .col-title a:hover { text-decoration: underline; }
  .ac-mark { display: inline-block; width: 18px; color: #4caf50; font-weight: bold; margin-right: 2px; }
  .score-mark { display: inline-block; width: 18px; color: #ff9800; font-size: 10px; margin-right: 2px; }
  .col-rate { width: 110px; }
  .rate-bar {
    display: inline-block; width: 60px; height: 6px;
    background: rgba(127,127,127,0.2); border-radius: 3px;
    overflow: hidden; vertical-align: middle; margin-right: 6px;
  }
  .rate-bar > div { height: 100%; border-radius: 3px; }
  .rate-high > div { background: #4caf50; }
  .rate-mid > div { background: #ff9800; }
  .rate-low > div { background: #f44336; }
  .rate-text { font-size: 12px; color: var(--muted); }
  .col-submit { width: 90px; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
  .col-tags { min-width: 120px; }
  .col-source {
    min-width: 80px;
    max-width: 160px;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag-badge {
    display: inline-block; padding: 1px 8px; margin: 1px 3px 1px 0;
    background: rgba(127,127,127,0.15); border-radius: 10px;
    font-size: 11px; color: var(--fg); cursor: pointer; white-space: nowrap;
  }
  .tag-badge:hover { background: rgba(127,127,127,0.3); }
  .tag-badge.active { background: var(--accent); color: var(--bg); }
  .col-ps {
    min-width: 120px; font-size: 11px; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
  }
  .empty-state { padding: 60px 20px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
  <div id="loading">正在加载题库数据...</div>
  <div class="toolbar" style="display:none;" id="toolbar">
    <input type="text" id="search" placeholder="搜索题目名或 ID" />
    <select id="sort">
      <option value="id-asc">ID 升序</option>
      <option value="id-desc">ID 降序</option>
      <option value="rate-desc">通过率 从高到低</option>
      <option value="rate-asc">通过率 从低到高</option>
      <option value="submit-desc">提交数 从多到少</option>
    </select>
    <label><input type="checkbox" id="unsolved" /> 只看未通过</label>
    <button id="reset" style="padding:5px 10px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:6px;cursor:pointer;font-size:12px;">重置筛选</button>
    <span class="stat" id="stat"></span>
  </div>
  <div class="layout" style="display:none;" id="layout">
    <aside class="sidebar">
      <div class="filter-group">
        <h3>题库</h3>
        <div id="ps-list"></div>
      </div>
      <div class="filter-group">
        <h3>标签</h3>
        <div id="tag-list"></div>
      </div>
    </aside>
    <main class="content">
      <table>
        <thead>
          <tr>
            <th class="col-pid">ID</th>
            <th class="col-title">题目</th>
            <th class="col-rate">通过率</th>
            <th class="col-submit">提交数</th>
            <th class="col-tags">标签</th>
            <th class="col-source">来源</th>
            <th class="col-ps">题库</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div class="empty-state" id="empty" style="display:none;">没有匹配的题目</div>
    </main>
  </div>

  <script nonce="${nonce}">
    window.__DATA_URI__ = "${dataWebUri}";
    window.__SCORE_URI__ = "${scoreWebUri}";
  </script>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const log = (m) => { try { vscode.postMessage({ type: 'debug', message: m }); } catch (_) {} };
      log('Webview 启动');

      function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      function normalizeTitle(s) {
        return String(s).replace(/\u00a0/g, ' ').replace(/\u3000/g, ' ').replace(/[\u200b-\u200f]/g, '').replace(/\s+/g, ' ').trim();
      }
      function parseRate(r) { const v = parseFloat(r); return isNaN(v) ? 0 : v; }

      // === 诊断面板 ===
      const diag = document.getElementById('loading');
      diag.innerHTML =
        '<div style="text-align:left;font-family:monospace;font-size:12px;padding:20px;">' +
        '<div style="color:#ff9800;font-weight:bold;margin-bottom:12px;">诊断信息</div>' +
        '<div>DATA_URI = ' + esc(window.__DATA_URI__ || '(空)') + '</div>' +
        '<div>SCORE_URI = ' + esc(window.__SCORE_URI__ || '(空)') + '</div>' +
        '<div id="diag-status" style="margin-top:12px;color:#888;">正在 fetch...</div>' +
        '</div>';

      const statusEl = document.getElementById('diag-status');

      fetch(window.__DATA_URI__)
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
          return r.text();
        })
        .then(text => {
          statusEl.textContent = 'DATA fetch OK, 长度: ' + text.length + ' 字节，正在解析 JSON...';
          try {
            const index = JSON.parse(text);
            statusEl.textContent += ' | problems=' + (index.problems ? index.problems.length : 0);
            return Promise.all([
              Promise.resolve(index),
              fetch(window.__SCORE_URI__)
                .then(r => r.ok ? r.json() : [])
                .catch(() => []),
            ]);
          } catch (e) {
            statusEl.textContent += ' | JSON 解析失败: ' + String(e);
            throw e;
          }
        })
        .then(([index, scores]) => {
          statusEl.textContent += ' | 初始化中...';
          log('数据加载完成: problems=' + (index.problems ? index.problems.length : 0) + ', scores=' + scores.length);
          init(index.problems || [], new Map(scores));
        })
        .catch(e => {
          log('数据加载失败: ' + String(e));
          statusEl.innerHTML =
            '<span style="color:#f44336;">fetch 失败: ' + esc(String(e && e.message ? e.message : e)) + '</span>';
        });

      function init(problems, scores) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('toolbar').style.display = '';
        document.getElementById('layout').style.display = '';

        const psMap = new Map();
        const tagMap = new Map();
        for (const p of problems) {
          for (const ps of (p.problemsets || [])) {
            if (!psMap.has(ps.id)) psMap.set(ps.id, { title: ps.title, count: 0 });
            psMap.get(ps.id).count++;
          }
          for (const t of (p.tags || [])) {
            if (!tagMap.has(t.id)) tagMap.set(t.id, { name: t.name, count: 0 });
            tagMap.get(t.id).count++;
          }
        }

        const state = { search: '', sortBy: 'id-asc', selectedPs: new Set(), selectedTags: new Set(), onlyUnsolved: false };

        function filterAndSort() {
          const q = state.search.trim().toLowerCase();
          let list = problems.filter((p) => {
            if (q) {
              if (!p.title.toLowerCase().includes(q) && p.pid !== q) return false;
            }
            if (state.selectedPs.size > 0) {
              if (!(p.problemsets || []).some((ps) => state.selectedPs.has(ps.id))) return false;
            }
            if (state.selectedTags.size > 0) {
              if (!(p.tags || []).some((t) => state.selectedTags.has(t.id))) return false;
            }
            if (state.onlyUnsolved) {
              const score = scores.get(normalizeTitle(p.title));
              if (score !== undefined && score >= 100) return false;
            }
            return true;
          });
          list.sort((a, b) => {
            switch (state.sortBy) {
              case 'id-asc': return parseInt(a.pid, 10) - parseInt(b.pid, 10);
              case 'id-desc': return parseInt(b.pid, 10) - parseInt(a.pid, 10);
              case 'rate-desc': return parseRate(b.passRate) - parseRate(a.passRate);
              case 'rate-asc': return parseRate(a.passRate) - parseRate(b.passRate);
              case 'submit-desc': return (b.submitCount || 0) - (a.submitCount || 0);
              default: return 0;
            }
          });
          return list;
        }

        function rateClass(r) {
          const v = parseRate(r);
          if (v >= 70) return 'rate-high';
          if (v >= 30) return 'rate-mid';
          return 'rate-low';
        }

        function renderSidebar() {
          const psList = document.getElementById('ps-list');
          const tagList = document.getElementById('tag-list');
          const psArr = Array.from(psMap.entries()).map(([id, info]) => ({ id, ...info })).sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
          psList.innerHTML = psArr.map((ps) =>
            '<label class="filter-item"><input type="checkbox" data-ps="' + esc(ps.id) + '"' + (state.selectedPs.has(ps.id) ? ' checked' : '') + ' /><span title="' + esc(ps.title) + '">' + esc(ps.title) + '</span><span class="count">' + ps.count + '</span></label>'
          ).join('') || '<div class="filter-empty">无</div>';
          const tagArr = Array.from(tagMap.entries()).map(([id, info]) => ({ id, ...info })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
          tagList.innerHTML = tagArr.map((t) =>
            '<label class="filter-item"><input type="checkbox" data-tag="' + esc(t.id) + '"' + (state.selectedTags.has(t.id) ? ' checked' : '') + ' /><span title="' + esc(t.name) + '">' + esc(t.name) + '</span><span class="count">' + t.count + '</span></label>'
          ).join('') || '<div class="filter-empty">无</div>';

          psList.querySelectorAll('input[data-ps]').forEach((el) => {
            el.addEventListener('change', () => {
              const id = el.getAttribute('data-ps');
              if (el.checked) state.selectedPs.add(id); else state.selectedPs.delete(id);
              update();
            });
          });
          tagList.querySelectorAll('input[data-tag]').forEach((el) => {
            el.addEventListener('change', () => {
              const id = el.getAttribute('data-tag');
              if (el.checked) state.selectedTags.add(id); else state.selectedTags.delete(id);
              update();
            });
          });
        }

        function renderTable() {
          const list = filterAndSort();
          const tbody = document.getElementById('tbody');
          const empty = document.getElementById('empty');
          document.getElementById('stat').textContent = '共 ' + problems.length + ' 题 / 显示 ' + list.length + ' 题';
          if (list.length === 0) { tbody.innerHTML = ''; empty.style.display = ''; return; }
          empty.style.display = 'none';
          const frag = document.createDocumentFragment();
          for (const p of list) {
            const tr = document.createElement('tr');
            const score = scores.get(normalizeTitle(p.title));
            let markHtml = '';
            if (score !== undefined) {
              if (score >= 100) markHtml = '<span class="ac-mark">✓</span>';
              else if (score > 0) markHtml = '<span class="score-mark">' + score + '</span>';
            }
            const tdPid = document.createElement('td');
            tdPid.className = 'col-pid';
            tdPid.textContent = p.pid;
            tr.appendChild(tdPid);
            const tdTitle = document.createElement('td');
            tdTitle.className = 'col-title';
            const firstPs = (p.problemsets && p.problemsets[0]) ? p.problemsets[0].id : '';
            const a = document.createElement('a');
            a.href = '#';
            a.dataset.action = 'open';
            a.dataset.ps = firstPs;
            a.dataset.pid = p.pid;
            a.innerHTML = markHtml + esc(p.title);
            tdTitle.appendChild(a);
            tr.appendChild(tdTitle);
            const tdRate = document.createElement('td');
            tdRate.className = 'col-rate';
            const rateVal = parseRate(p.passRate);
            tdRate.innerHTML = '<span class="rate-bar ' + rateClass(p.passRate) + '"><div style="width:' + Math.min(rateVal, 100) + '%"></div></span><span class="rate-text">' + esc(p.passRate || '-') + '</span>';
            tr.appendChild(tdRate);
            const tdSubmit = document.createElement('td');
            tdSubmit.className = 'col-submit';
            tdSubmit.textContent = p.submitCount !== undefined ? p.submitCount : '-';
            tr.appendChild(tdSubmit);
            const tdTags = document.createElement('td');
            tdTags.className = 'col-tags';
            if (p.tags && p.tags.length) {
              tdTags.innerHTML = p.tags.map((t) => {
                const active = state.selectedTags.has(t.id) ? ' active' : '';
                return '<span class="tag-badge' + active + '" data-tag-id="' + esc(t.id) + '">' + esc(t.name) + '</span>';
              }).join('');
            }
            tr.appendChild(tdTags);
            const tdSource = document.createElement('td');
            tdSource.className = 'col-source';
            tdSource.textContent = p.source || '';
            tdSource.title = p.source || '';
            tr.appendChild(tdSource);
            const tdPs = document.createElement('td');
            tdPs.className = 'col-ps';
            const psTitles = (p.problemsets || []).map((x) => x.title).join(' / ');
            tdPs.title = psTitles;
            tdPs.textContent = psTitles;
            tr.appendChild(tdPs);
            frag.appendChild(tr);
          }
          tbody.innerHTML = '';
          tbody.appendChild(frag);
        }

        function update() {
          renderTable();
          document.querySelectorAll('.tag-badge').forEach((el) => {
            const id = el.getAttribute('data-tag-id');
            if (state.selectedTags.has(id)) el.classList.add('active');
            else el.classList.remove('active');
          });
        }

        let searchTimer = null;
        document.getElementById('search').addEventListener('input', (e) => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => { state.search = e.target.value; update(); }, 200);
        });
        document.getElementById('sort').addEventListener('change', (e) => { state.sortBy = e.target.value; update(); });
        document.getElementById('unsolved').addEventListener('change', (e) => { state.onlyUnsolved = e.target.checked; update(); });
        document.getElementById('reset').addEventListener('click', () => {
          state.search = ''; state.sortBy = 'id-asc'; state.selectedPs.clear(); state.selectedTags.clear(); state.onlyUnsolved = false;
          document.getElementById('search').value = '';
          document.getElementById('sort').value = 'id-asc';
          document.getElementById('unsolved').checked = false;
          renderSidebar();
          update();
        });
        document.getElementById('tbody').addEventListener('click', (e) => {
          const t = e.target;
          if (t.tagName === 'A' && t.dataset.action === 'open') {
            e.preventDefault();
            vscode.postMessage({ type: 'openProblem', ps: t.dataset.ps, pid: t.dataset.pid });
          } else if (t.classList.contains('tag-badge')) {
            e.preventDefault();
            const id = t.getAttribute('data-tag-id');
            if (!id) return;
            if (state.selectedTags.has(id)) state.selectedTags.delete(id); else state.selectedTags.add(id);
            renderSidebar();
            update();
          }
        });

        renderSidebar();
        update();
      }
    })();
  </script>
</body>
</html>`;
}

function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
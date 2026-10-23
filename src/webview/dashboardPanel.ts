import * as vscode from 'vscode';
import { DashboardData, DashboardStats } from '../api/wzoi';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  public static readonly viewType = 'wzoiDashboard';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openProblem' && msg.problemsetId && msg.problemId) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblem',
            msg.problemsetId,
            msg.problemId
          );
        } else if (msg?.type === 'openProblemset' && msg.problemsetId) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblemset',
            msg.problemsetId
          );
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(data: DashboardData, stats: DashboardStats): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      DashboardPanel.currentPanel.panel.webview.html = render(data, stats);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'WZOI 首页',
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = render(data, stats);
    DashboardPanel.currentPanel = new DashboardPanel(panel);
  }
}

function render(d: DashboardData, s: DashboardStats): string {
  const esc = (x: string) =>
    String(x)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  // ---- 统计：总览卡片 ----
  const statCards = `
    <div class="stat-grid">
      <div class="stat-card primary">
        <div class="stat-label">已通过</div>
        <div class="stat-value">${s.acProblems}</div>
        <div class="stat-sub">/ ${s.totalProblems} 题</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">通过率</div>
        <div class="stat-value">${s.passRate.toFixed(1)}<span class="stat-unit">%</span></div>
        <div class="stat-bar"><div style="width:${Math.min(s.passRate, 100)}%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">尝试过</div>
        <div class="stat-value">${s.attemptedProblems}</div>
        <div class="stat-sub">未通过 ${s.attemptedProblems - s.acProblems}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未尝试</div>
        <div class="stat-value muted">${s.unattemptedProblems}</div>
        <div class="stat-sub">去刷题吧</div>
      </div>
    </div>`;

  // ---- 按标签分布 ----
  const tagRows = s.byTag
    .map((t) => {
      const pct = t.total > 0 ? (t.ac / t.total) * 100 : 0;
      return `
      <div class="row-item">
        <div class="row-head">
          <span class="row-name">${esc(t.name)}</span>
          <span class="row-count">${t.ac} / ${t.total}</span>
        </div>
        <div class="row-bar">
          <div class="row-bar-inner" style="width:${pct}%"></div>
        </div>
      </div>`;
    })
    .join('');

  // ---- 按题库分布 ----
  const psRows = s.byProblemset
    .slice(0, 15)
    .map((p) => {
      const pct = p.total > 0 ? (p.ac / p.total) * 100 : 0;
      return `
      <div class="row-item">
        <div class="row-head">
          <a href="#" class="problemset-link" data-ps="${esc(p.id)}">${esc(p.title)}</a>
          <span class="row-count">${p.ac} / ${p.total}</span>
        </div>
        <div class="row-bar">
          <div class="row-bar-inner" style="width:${pct}%"></div>
        </div>
      </div>`;
    })
    .join('');

  // ---- 近 7 天 ----
  const maxDay = Math.max(1, ...s.recentDays.map((x) => x.count));
  const recentHtml = s.recentDays
    .map((d) => {
      const h = Math.round((d.count / maxDay) * 100);
      const label = d.date.slice(5); // MM-DD
      return `
      <div class="day-col" title="${d.date} · ${d.count} 次提交">
        <div class="day-bar-wrap">
          <div class="day-bar" style="height:${h}%"></div>
        </div>
        <div class="day-count">${d.count || ''}</div>
        <div class="day-label">${label}</div>
      </div>`;
    })
    .join('');

  // ---- 原有：作业 ----
  const homeworksHtml = d.homeworks.length
    ? d.homeworks
        .map((h) => {
          const pct = h.total ? Math.round((h.current / h.total) * 100) : 0;
          const done = h.current >= h.total && h.total > 0;
          return `<div class="homework">
            <div class="hw-head">
              <span class="hw-title">${esc(h.title)}</span>
              <span class="hw-count ${done ? 'done' : ''}">${h.current} / ${h.total}</span>
            </div>
            <div class="progress"><div class="bar ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
          </div>`;
        })
        .join('')
    : '<div class="empty">暂无作业</div>';

  // ---- 原有：浏览历史 ----
  const historyHtml = d.history.length
    ? d.history
        .map((h) => {
          const m = h.url.match(/^\/s\/(\d+)\/(\d+)/);
          const link = m
            ? `<a href="#" class="problem-link" data-ps="${m[1]}" data-pid="${m[2]}">${esc(h.title)}</a>`
            : esc(h.title);
          const ps = h.problemsetUrl.match(/^\/s\/(\d+)/);
          const psLink = ps
            ? `<a href="#" class="problemset-link" data-ps="${ps[1]}">${esc(h.problemsetTitle)}</a>`
            : esc(h.problemsetTitle);
          return `<div class="history-item">
            <span class="check">${h.ac ? '✅' : '⬜'}</span>
            <div class="history-main">
              <div>${link}</div>
              <div class="history-sub">来自 ${psLink}</div>
            </div>
          </div>`;
        })
        .join('')
    : '<div class="empty">暂无记录</div>';

  // ---- 原有：比赛 ----
  const contestsHtml = d.contests.length
    ? d.contests
        .map((c) => {
          const m = c.url.match(/^\/s\/(\d+)/);
          const link = m
            ? `<a href="#" class="problemset-link" data-ps="${m[1]}">${esc(c.title)}</a>`
            : esc(c.title);
          return `<div class="contest">
            <div class="contest-title">${link}</div>
            <div class="contest-time">
              <span class="time-start">${esc(c.startTime)}</span>
              <span class="time-sep">→</span>
              <span class="time-end">${esc(c.endTime)}</span>
            </div>
          </div>`;
        })
        .join('')
    : '<div class="empty">暂无比赛</div>';

  const nonce = makeNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
    style-src 'unsafe-inline';
    script-src 'nonce-${nonce}';">
<style>
  :root {
    --fg: var(--vscode-foreground);
    --bg: var(--vscode-editor-background);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border);
    --card: var(--vscode-editorWidget-background);
    --accent: var(--vscode-textLink-foreground);
    --green: #4caf50;
    --orange: #ff9800;
    --red: #f44336;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.7;
    padding: 24px 40px;
    max-width: 1200px;
    margin: 0 auto;
    color: var(--fg);
    background: var(--bg);
  }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .subtitle { color: var(--muted); margin-bottom: 28px; font-size: 13px; }

  section { margin-bottom: 32px; }
  section > h2 {
    font-size: 17px;
    margin: 0 0 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 7px;
    background: rgba(127,127,127,0.12);
    font-size: 14px;
  }

  /* === 统计总览 === */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
  }
  .stat-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 20px;
  }
  .stat-card.primary {
    background: linear-gradient(135deg, rgba(76,175,80,0.15), rgba(76,175,80,0.05));
    border-color: rgba(76,175,80,0.3);
  }
  .stat-label {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .stat-value {
    font-size: 30px;
    font-weight: 700;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .stat-value.muted { color: var(--muted); }
  .stat-unit { font-size: 16px; font-weight: 500; color: var(--muted); margin-left: 2px; }
  .stat-sub {
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
  }
  .stat-bar {
    height: 6px;
    background: rgba(127,127,127,0.2);
    border-radius: 3px;
    margin-top: 10px;
    overflow: hidden;
  }
  .stat-bar > div {
    height: 100%;
    background: linear-gradient(90deg, var(--green), #66bb6a);
    border-radius: 3px;
  }

  /* === 条形行 === */
  .row-list {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 22px;
  }
  .row-item { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .row-item:first-child { padding-top: 0; }
  .row-item:last-child { border-bottom: none; padding-bottom: 0; }
  .row-head {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 5px;
  }
  .row-name, .row-head a {
    color: var(--fg);
    text-decoration: none;
    font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 70%;
  }
  .row-head a { color: var(--accent); cursor: pointer; }
  .row-head a:hover { text-decoration: underline; }
  .row-count {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .row-bar {
    height: 8px;
    background: rgba(127,127,127,0.15);
    border-radius: 4px;
    overflow: hidden;
  }
  .row-bar-inner {
    height: 100%;
    background: linear-gradient(90deg, var(--green), #66bb6a);
    border-radius: 4px;
    transition: width 0.3s;
  }

  /* === 近 7 天 === */
  .recent-chart {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 24px;
    display: flex;
    gap: 12px;
    height: 160px;
  }
  .day-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
  }
  .day-bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
  }
  .day-bar {
    width: 100%;
    background: linear-gradient(180deg, var(--accent), rgba(127,127,127,0.5));
    border-radius: 4px 4px 0 0;
    min-height: 2px;
    transition: height 0.3s;
  }
  .day-count {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
    height: 16px;
  }
  .day-label {
    font-size: 11px;
    color: var(--muted);
  }

  /* === 原有样式 === */
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 22px;
  }
  .homework { padding: 12px 0; border-bottom: 1px solid var(--border); }
  .homework:first-child { padding-top: 0; }
  .homework:last-child { border-bottom: none; padding-bottom: 0; }
  .hw-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .hw-title { font-weight: 500; }
  .hw-count { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .hw-count.done { color: var(--green); font-weight: 600; }
  .progress { height: 12px; background: rgba(127,127,127,0.15); border-radius: 6px; overflow: hidden; }
  .progress .bar { height: 100%; background: linear-gradient(90deg, var(--accent), var(--green)); border-radius: 6px; transition: width .3s; }
  .progress .bar.done { background: linear-gradient(90deg, var(--green), #66bb6a); }

  .history-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .history-item:first-child { padding-top: 0; }
  .history-item:last-child { border-bottom: none; padding-bottom: 0; }
  .check { font-size: 18px; line-height: 1; margin-top: 3px; }
  .history-main { flex: 1; min-width: 0; }
  .history-sub { color: var(--muted); font-size: 13px; margin-top: 2px; }

  .contest { padding: 12px 0; border-bottom: 1px solid var(--border); }
  .contest:first-child { padding-top: 0; }
  .contest:last-child { border-bottom: none; padding-bottom: 0; }
  .contest-title { font-weight: 500; margin-bottom: 4px; }
  .contest-time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .time-sep { margin: 0 8px; }
  .time-start { color: var(--green); }
  .time-end { color: var(--red); }

  .empty { color: var(--muted); font-style: italic; padding: 8px 0; }
  a { color: var(--accent); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>WZOI 首页</h1>
  <div class="subtitle">温中 OI 在线评测系统</div>

  <section>
    <h2><span class="icon">📊</span>练习情况</h2>
    ${statCards}
  </section>

  <section>
    <h2><span class="icon">📈</span>近 7 天提交</h2>
    <div class="recent-chart">${recentHtml || '<div class="empty">暂无提交记录</div>'}</div>
  </section>

  <section>
    <h2><span class="icon">🏷️</span>按标签</h2>
    <div class="row-list">${tagRows || '<div class="empty">暂无标签数据</div>'}</div>
  </section>

  <section>
    <h2><span class="icon">📚</span>按题库</h2>
    <div class="row-list">${psRows || '<div class="empty">暂无题库数据</div>'}</div>
  </section>

  <section>
    <h2><span class="icon">📝</span>作业进度</h2>
    <div class="card">${homeworksHtml}</div>
  </section>

  <section>
    <h2><span class="icon">🕒</span>浏览历史</h2>
    <div class="card">${historyHtml}</div>
  </section>

  <section>
    <h2><span class="icon">🏆</span>近期比赛</h2>
    <div class="card">${contestsHtml}</div>
  </section>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('.problem-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openProblem',
            problemsetId: el.getAttribute('data-ps'),
            problemId: el.getAttribute('data-pid'),
          });
        });
      });
      document.querySelectorAll('.problemset-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openProblemset',
            problemsetId: el.getAttribute('data-ps'),
          });
        });
      });
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
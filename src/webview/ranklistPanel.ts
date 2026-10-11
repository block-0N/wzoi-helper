import * as vscode from 'vscode';
import { Ranklist, RanklistRow } from '../api/wzoi';

export class RanklistPanel {
  public static currentPanel: RanklistPanel | undefined;
  public static readonly viewType = 'wzoiRanklist';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openUser' && msg.uid) {
          vscode.commands.executeCommand('wzoi-helper.openUser', String(msg.uid));
        } else if (msg?.type === 'openProblem' && msg.ps && msg.pid) {
          vscode.commands.executeCommand(
            'wzoi-helper.openProblem',
            String(msg.ps),
            String(msg.pid)
          );
        } else if (msg?.type === 'openUserSubmissions' && msg.userName) {
          vscode.commands.executeCommand(
            'wzoi-helper.openUserSubmissions',
            String(msg.userName),
            msg.filter === 'ac' ? 'ac' : 'all',
            msg.problemId ? String(msg.problemId) : undefined
          );
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    RanklistPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(data: Ranklist): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (RanklistPanel.currentPanel) {
      RanklistPanel.currentPanel.panel.reveal(column);
      RanklistPanel.currentPanel.panel.title = `${data.title} · 排名`;
      RanklistPanel.currentPanel.panel.webview.html = render(data);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      RanklistPanel.viewType,
      `${data.title} · 排名`,
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = render(data);
    RanklistPanel.currentPanel = new RanklistPanel(panel);
  }
}

function render(data: Ranklist): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const headerProblemCells = data.problems
    .map(
      (p) =>
        `<th class="problem-col"><a href="#" class="problem-link" data-pid="${p.id}" title="${esc(
          p.title
        )}">${p.index}</a></th>`
    )
    .join('');

  const scoreCell = (
    raw: string,
    userName: string,
    pid: string
  ): string => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || text === '-') return `<td class="score-cell">-</td>`;

    // 形如 "70 (100)" 表示本次 70 分，历史最高 100
    const m = text.match(/^(-?\d+)?\s*\((\d+)\)$/);
    if (m) {
      const cur = m[1] ?? '';
      const hist = m[2];
      const curCls =
        cur === '100' ? 'ac' : cur ? (parseInt(cur, 10) > 0 ? 'partial' : 'zero') : 'none';
      return `<td class="score-cell">
        <a href="#" class="score-link" data-user="${esc(userName)}" data-pid="${pid}">
          <span class="${curCls}">${esc(cur)}</span>
          <span class="hist">(${esc(hist)})</span>
        </a>
      </td>`;
    }

    const num = parseInt(text, 10);
    const cls = text === '100' ? 'ac' : text === '0' ? 'zero' : isNaN(num) ? '' : num > 0 ? 'partial' : '';
    return `<td class="score-cell">
      <a href="#" class="score-link" data-user="${esc(userName)}" data-pid="${pid}">
        <span class="${cls}">${esc(text)}</span>
      </a>
    </td>`;
  };

  const bodyRows = data.rows
    .map((r) => {
      const rank = r.rank || '-';
      const rankCls =
        rank === '1'
          ? 'gold'
          : rank === '2'
            ? 'silver'
            : rank === '3'
              ? 'bronze'
              : '';
      const userName = r.username || r.display;

      const scoreCells = data.problems
        .map((p, i) => scoreCell(r.scores[i] || '', userName, p.id))
        .join('');

      return `<tr>
        <td class="rank ${rankCls}">${esc(rank)}</td>
        <td class="user-cell">
          <a href="#" class="user-link" data-uid="${esc(r.uid)}">
            ${esc(r.display)}
          </a>
        </td>
        ${scoreCells}
        <td class="total-cell">
          <a href="#" class="total-link" data-user="${esc(userName)}">
            <b>${esc(r.total)}</b>
          </a>
        </td>
      </tr>`;
    })
    .join('');

  const nonEmptyRows = data.rows.filter((r) => r.rank && r.rank !== '-');
  const subtitle = `共 ${nonEmptyRows.length} 位参赛者 · ${data.problems.length} 道题`;

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
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.6;
    padding: 24px 32px;
    color: var(--fg);
    background: var(--bg);
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 20px; }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    border-right: 1px solid var(--border);
    text-align: center;
    white-space: nowrap;
  }
  th:last-child, td:last-child { border-right: none; }
  tr:last-child td { border-bottom: none; }
  th {
    background: rgba(127,127,127,0.12);
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 2;
  }
  td.rank, th:first-child {
    position: sticky;
    left: 0;
    background: var(--card);
    z-index: 1;
    font-weight: 600;
  }
  th:first-child { z-index: 3; background: rgba(127,127,127,0.15); }
  td.user-cell, th:nth-child(2) {
    position: sticky;
    left: 48px;
    background: var(--card);
    z-index: 1;
    text-align: left;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  th:nth-child(2) { z-index: 3; background: rgba(127,127,127,0.15); }

  .rank.gold { color: #ffd700; }
  .rank.silver { color: #c0c0c0; }
  .rank.bronze { color: #cd7f32; }

  a { color: var(--accent); text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }

  .score-cell .ac { color: #4caf50; font-weight: 600; }
  .score-cell .partial { color: #ff9800; }
  .score-cell .zero { color: #f44336; }
  .score-cell .none { color: var(--muted); }
  .score-cell .hist { color: var(--muted); font-size: 11px; margin-left: 4px; }
  .total-cell b { color: var(--fg); }
</style>
</head>
<body>
  <h1>${esc(data.title)}</h1>
  <div class="subtitle">${subtitle}</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>用户</th>
          ${headerProblemCells}
          <th>总分</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      document.querySelectorAll('.user-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({ type: 'openUser', uid: el.getAttribute('data-uid') });
        });
      });

      document.querySelectorAll('.problem-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const pid = el.getAttribute('data-pid');
          vscode.postMessage({ type: 'openProblem', ps: '${data.problemsetId}', pid });
        });
      });

      document.querySelectorAll('.score-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openUserSubmissions',
            userName: el.getAttribute('data-user'),
            problemId: el.getAttribute('data-pid'),
          });
        });
      });

      document.querySelectorAll('.total-link').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({
            type: 'openUserSubmissions',
            userName: el.getAttribute('data-user'),
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
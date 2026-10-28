import * as vscode from 'vscode';
import { SubmissionSummary } from '../api/wzoi';
import { SubmissionCache } from '../cache/submissionCache';

class SubmissionNode extends vscode.TreeItem {
  constructor(public readonly summary: SubmissionSummary) {
    super(
      `#${summary.id} ${summary.problemTitle}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = `${summary.score}分 ${summary.language} ${summary.submitTime}`;
    this.tooltip = `提交 #${summary.id}\n题目: ${summary.problemTitle}\n分数: ${summary.score}\n语言: ${summary.language}\n时间: ${summary.submitTime}`;
    this.iconPath = new vscode.ThemeIcon(pickIcon(summary.score));
    this.command = {
      command: 'wzoi-helper.openSolution',
      title: '查看提交',
      arguments: [summary.id],
    };
    this.contextValue = 'submission';
  }
}

function pickIcon(score: string): string {
  const n = parseFloat(score);
  if (!isNaN(n) && n >= 100) return 'pass-filled';
  if (!isNaN(n) && n > 0) return 'warning';
  if (score.includes('编译错误')) return 'error';
  return 'circle-outline';
}

const MAX_DISPLAY = 100;

export class SubmissionTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private getUsername: () => Promise<string | undefined>,
    private cache: SubmissionCache
  ) { }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(el: vscode.TreeItem) {
    return el;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const username = await this.getUsername();
    if (!username) {
      return [new vscode.TreeItem('（请先登录）')];
    }

    await this.cache.load();
    const list = this.cache.getList();

    if (list.length === 0) {
      const item = new vscode.TreeItem(
        '（点击上方 🔄 同步按钮加载提交记录）'
      );
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    }

    const display = list.slice(0, MAX_DISPLAY);
    const nodes: vscode.TreeItem[] = display.map(
      (s) => new SubmissionNode(s)
    );

    if (list.length > MAX_DISPLAY) {
      const more = new vscode.TreeItem(
        `（仅显示最近 ${MAX_DISPLAY} 条，共 ${list.length} 条）`
      );
      more.iconPath = new vscode.ThemeIcon('ellipsis');
      nodes.push(more);
    }

    return nodes;
  }
}
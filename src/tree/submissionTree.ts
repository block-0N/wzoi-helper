import * as vscode from 'vscode';
import {
    fetchMySubmissions,
    SubmissionSummary,
} from '../api/wzoi';

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

export class SubmissionTreeProvider
    implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private cache: SubmissionSummary[] = [];

    constructor(
        private getCookie: () => Promise<string | undefined>,
        private getUsername: () => Promise<string | undefined>
    ) { }

    refresh(): void {
        this.cache = [];
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
        if (this.cache.length) {
            return this.cache.map((s) => new SubmissionNode(s));
        }
        try {
            const cookie = await this.getCookie();
            const list = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: '加载提交记录...',
                },
                () => fetchMySubmissions(username, cookie)
            );
            this.cache = list.slice(0, 30);
            if (!this.cache.length) {
                return [new vscode.TreeItem('（没有提交记录）')];
            }
            return this.cache.map((s) => new SubmissionNode(s));
        } catch (err) {
            vscode.window.showErrorMessage(`加载提交记录失败：${err}`);
            return [];
        }
    }
}
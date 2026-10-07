import * as vscode from 'vscode';
import { fetchContests, ContestSummary } from '../api/wzoi';

class ContestNode extends vscode.TreeItem {
    constructor(public readonly contest: ContestSummary) {
        super(contest.title, vscode.TreeItemCollapsibleState.None);
        this.description = contest.isRunning ? '进行中' : contest.startTime;
        this.tooltip = [
            contest.title,
            `类型: ${contest.type}`,
            `开始: ${contest.startTime}`,
            `结束: ${contest.endTime}`,
            contest.tag ? `标签: ${contest.tag}` : '',
        ]
            .filter(Boolean)
            .join('\n');
        this.iconPath = new vscode.ThemeIcon(
            contest.isRunning ? 'debug-start' : 'calendar',
            contest.isRunning
                ? new vscode.ThemeColor('charts.green')
                : undefined
        );
        this.command = {
            command: 'wzoi-helper.openProblemset',
            title: '打开比赛',
            arguments: [contest.id],
        };
        this.contextValue = 'contest';
    }
}

export class ContestTreeProvider
    implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private cache: ContestSummary[] = [];

    constructor(private getCookie: () => Promise<string | undefined>) { }

    refresh(): void {
        this.cache = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(el: vscode.TreeItem) {
        return el;
    }

    async getChildren(): Promise<vscode.TreeItem[]> {
        if (this.cache.length) {
            return this.cache.map((c) => new ContestNode(c));
        }
        try {
            const cookie = await this.getCookie();
            this.cache = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: '加载比赛列表...',
                },
                () => fetchContests(cookie)
            );
            return this.cache.map((c) => new ContestNode(c));
        } catch (err) {
            vscode.window.showErrorMessage(`加载比赛失败：${err}`);
            return [];
        }
    }
}
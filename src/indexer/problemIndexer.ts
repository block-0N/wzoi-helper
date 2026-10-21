import * as vscode from 'vscode';
import {
  fetchAllProblemsets,
  fetchProblemsetAll,
  fetchContests,
  fetchProblemStats,
  searchTagsByPid,
} from '../api/wzoi';

export interface ProblemRecord {
  pid: string;
  title: string;
  problemsets: { id: string; title: string }[];
  tags: { id: string; name: string }[];
  submitCount?: number;
  passRate?: string;
  source?: string;
}

export interface ProblemIndex {
  version: number;
  updatedAt: number;
  problems: ProblemRecord[];
}

const STORAGE_KEY = 'wzoi.problemIndex';
const INDEX_FILE = 'problem-index.json';

async function getIndexFilePath(ctx: vscode.ExtensionContext): Promise<vscode.Uri> {
  const dir = ctx.globalStorageUri;
  await vscode.workspace.fs.createDirectory(dir);
  return vscode.Uri.joinPath(dir, INDEX_FILE);
}
const INDEX_VERSION = 5;

export async function getCachedIndex(
  ctx: vscode.ExtensionContext
): Promise<ProblemIndex | undefined> {
  // 先读文件（大文件友好）
  try {
    const uri = await getIndexFilePath(ctx);
    const buf = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(buf).toString('utf8')) as ProblemIndex;
    if (data && data.version === INDEX_VERSION) {
      return data;
    }
  } catch {
    // 文件不存在或解析失败，回退到 globalState
  }
  // 回退：老版本的 globalState 缓存
  const cached = ctx.globalState.get<ProblemIndex>(STORAGE_KEY);
  if (cached && cached.version === INDEX_VERSION) return cached;
  return undefined;
}

export async function buildIndex(
  ctx: vscode.ExtensionContext,
  cookie: string | undefined,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<ProblemIndex> {
  const map = new Map<string, ProblemRecord>();

  progress.report({ message: '抓取题库列表...' });

  // 重试 3 次拉题库列表（网络抖动 / Cookie 未就绪时偶发为空）
  let problemsets = await fetchAllProblemsets(cookie);
  for (let retry = 1; retry <= 3 && problemsets.length < 10; retry++) {
    console.log(
      `[Index] 题库列表只有 ${problemsets.length} 个，第 ${retry}/3 次重试...`
    );
    await new Promise((r) => setTimeout(r, 1500));
    const retryList = await fetchAllProblemsets(cookie);
    if (retryList.length > problemsets.length) {
      problemsets = retryList;
    }
  }

  if (problemsets.length < 10) {
    throw new Error(
      `题库列表只拿到 ${problemsets.length} 个（< 10），疑似网络或登录问题。请检查是否已登录，或稍后重试。`
    );
  }
  console.log(`[Index] 题库列表：${problemsets.length} 个`);

  let contests = await fetchContests(cookie);
  if (contests.length === 0) {
    // 比赛列表可能为空，重试 1 次
    await new Promise((r) => setTimeout(r, 1000));
    contests = await fetchContests(cookie);
  }
  console.log(`[Index] 比赛列表：${contests.length} 个`);
  const allPs = [...problemsets];
  for (const c of contests) {
    if (!allPs.find((p) => p.id === c.id)) {
      allPs.push({ id: c.id, title: c.title });
    }
  }
  progress.report({ message: `发现 ${allPs.length} 个题库/比赛，开始遍历...` });
  progress.report({ message: `发现 ${allPs.length} 个题库，开始遍历...` });

  for (let i = 0; i < allPs.length; i++) {
    if (token.isCancellationRequested) throw new Error('已取消');
    const ps = allPs[i];
    progress.report({
      message: `(${i + 1}/${allPs.length}) ${ps.title}`,
      increment: 100 / allPs.length,
    });

    try {
      const meta = await fetchProblemsetAll(ps.id, cookie);
      for (const p of meta.problems) {
        let rec = map.get(p.problemId);
        if (!rec) {
          rec = { pid: p.problemId, title: p.title, problemsets: [], tags: [] };
          map.set(p.problemId, rec);
        }
        if (!rec.problemsets.find((x) => x.id === ps.id)) {
          rec.problemsets.push({ id: ps.id, title: meta.title || ps.title });
        }
        if (p.tags) {
          for (const t of p.tags) {
            if (!rec.tags.find((x) => x.id === t.id)) rec.tags.push(t);
          }
        }
        if (!rec.submitCount && p.submitCount) {
          const n = parseInt(p.submitCount, 10);
          if (!isNaN(n)) rec.submitCount = n;
        }
        if (!rec.passRate && p.passRate) rec.passRate = p.passRate;
        if (!rec.source && p.source) rec.source = p.source;
      }
    } catch (e) {
      console.error(`抓取题库 ${ps.id} 失败:`, e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // 临时诊断日志
  const withContest = Array.from(map.values()).filter((r) =>
    r.problemsets.some((ps) => /比赛|测试|体验营/.test(ps.title))
  ).length;
  console.log('[Index] 索引构建完成: 题目总数=' + map.size + ', 比赛类题目=' + withContest);

  // ---- 阶段 3：补全缺失的 stats / tags（并发）----
  interface SupplementTask {
    record: ProblemRecord;
    needStats: boolean;
    needTags: boolean;
  }

  const tasks: SupplementTask[] = [];
  for (const r of map.values()) {
    const needStats = r.submitCount === undefined || r.passRate === undefined;
    const needTags = r.tags.length === 0;
    if (needStats || needTags) tasks.push({ record: r, needStats, needTags });
  }

  if (tasks.length > 0) {
    progress.report({ message: `[补全] 共 ${tasks.length} 道题需要补全...` });
  }

  const CONCURRENCY = 3;
  let done = 0;
  let cursor = 0;
  let statsFixed = 0;
  let tagsFixed = 0;

  const worker = async () => {
    while (true) {
      if (token.isCancellationRequested) throw new Error('已取消');
      const i = cursor++;
      if (i >= tasks.length) break;
      const task = tasks[i];
      const r = task.record;
      done++;
      progress.report({
        message: `[补全 ${done}/${tasks.length}] ${r.pid} ${r.title.slice(0, 18)}`,
      });

      if (task.needStats) {
        try {
          const ps = r.problemsets[0];
          if (ps) {
            const stats = await fetchProblemStats(ps.id, r.pid, cookie);
            if (stats.submitCount !== undefined) {
              r.submitCount = stats.submitCount;
              statsFixed++;
            }
            if (stats.passRate) r.passRate = stats.passRate;
          }
        } catch (e) {
          console.error(`补全 stats 失败 ${r.pid}:`, e);
        }
      }

      if (task.needTags) {
        try {
          const tags = await searchTagsByPid(r.title, r.pid, cookie);
          if (tags.length > 0) {
            r.tags = tags;
            tagsFixed++;
          }
        } catch (e) {
          console.error(`反查标签失败 ${r.pid}:`, e);
        }
      }

      await new Promise((res) => setTimeout(res, 100));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker())
  );

  console.log(
    `[Index] 补全完成：statsFixed=${statsFixed}, tagsFixed=${tagsFixed}, 总数=${tasks.length}`
  );

  // 补全后打印统计
  const afterStats = Array.from(map.values()).filter((r) => r.passRate).length;
  const afterTags = Array.from(map.values()).filter((r) => r.tags.length > 0).length;
  console.log(
    `[Index] 补全后：有标签=${afterTags}, 有通过率=${afterStats}, 总数=${map.size}`
  );

  if (map.size === 0) {
    throw new Error(
      '索引构建后题目数为 0，可能是权限或网络问题。为保护旧缓存，本次不覆盖。'
    );
  }

  const index: ProblemIndex = {
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    problems: Array.from(map.values()),
  };

  // 写到文件系统（globalState 对大对象可能静默失败）
  try {
    const uri = await getIndexFilePath(ctx);
    const json = JSON.stringify(index);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
    console.log('[Index] 已写入文件：' + uri.fsPath + '（' + json.length + ' 字节）');
  } catch (e) {
    console.error('[Index] 写文件失败：', e);
    // 兜底写到 globalState
    await ctx.globalState.update(STORAGE_KEY, index);
  }

  return index;
}

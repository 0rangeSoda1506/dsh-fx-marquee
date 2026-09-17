# tools/ · 维护者工具

这些脚本面向**维护者**，用户不需要。放在这里而不是主 README，是因为仓库首页应该讲"这是什么、怎么装"。

## release.mjs

把发版流程固化下来（需要普通终端——agent 沙箱禁止 Node 捕获子进程输出）：

```bash
node tools/release.mjs check 0.1.2      # 自检：工作区是否干净、版本号、npm 是否已占用、远端是否已有该标签
node tools/release.mjs draft 0.1.2      # 从上个标签以来的提交生成更新日志草稿（分组是机器猜的，需人工改写）
# —— 人工整理 CHANGELOG.md、升两个 package.json 的版本号、commit —— #
# —— 打完**最后一个**提交再打标签，然后推送：git push --follow-tags —— #
node tools/release.mjs release 0.1.2 <github-token> [--update]   # 用标签建/更新 GitHub Release，正文自动取自 CHANGELOG
```

### 四个已经踩过的坑

1. **标签必须打在最后一个提交之后**——`v0.1.1` 当初打完标签又补了一个措辞提交，导致 checkout 出来的更新日志和 npm 包里的不是同一份
2. **有 Release 的标签只能 `--force` 更新引用，绝不能删了重建**——删标签时 GitHub 不会删除 Release，而是把它**转成草稿**，于是 Releases 页面上会和重建的那个并排出现两个同名版本
3. **核验要用令牌，不能匿名**——草稿 Release 对匿名接口不可见（匿名检查会理直气壮地报错误的状态），而且 Release 列表有 60 秒缓存，重读要加 `?t=` 时间戳
4. **`npm publish` 的输出必须读完整**——`+ pkg@ver` 那一行才算成功。账号开启 2FA 且令牌未勾 Bypass 时，npm 走 staged publish，**exit=0 只代表"暂存成功"**，版本要等 2FA 证明到位才真正上线（0.1.1 就因此被误判过一次）

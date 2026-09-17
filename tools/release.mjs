#!/usr/bin/env node
/**
 * Release helper for dsh-fx-marquee.
 *
 *   node tools/release.mjs check              # 发布前自检
 *   node tools/release.mjs draft 0.1.2        # 生成更新日志草稿
 *   node tools/release.mjs release 0.1.1 <token> [--not-latest]
 *
 * Run this from an ordinary shell. The agent's sandboxed shell cannot spawn
 * git with piped stdio (EPERM on named pipes), so `check` and `draft` only work
 * in a normal terminal.
 *
 * Three lessons from v0.1.1 are baked in, because each cost real time:
 *
 *  1. **Tag after the LAST commit.** v0.1.1 was tagged, then a wording commit
 *     followed, so the tag pointed at a changelog one revision older than what
 *     npm shipped. `check` warns when the working tree is dirty for this reason.
 *  2. **Never delete and re-create a tag that has a Release.** GitHub does not
 *     delete the Release — it turns it into a **draft**, which keeps showing on
 *     your Releases page as a duplicate beside the one you re-create. To move a
 *     tag, update the ref instead:  git push --force <url> refs/tags/vX.Y.Z
 *  3. **Verify with the token, never anonymously.** Draft releases are invisible
 *     to anonymous API calls, so an anonymous check will confidently report the
 *     wrong state — that is exactly how a duplicate draft went unnoticed while
 *     the API insisted there was only one release. The Releases list is also
 *     cached for 60 seconds, so re-reads need a cache-buster (`?t=<ms>`).
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { request } from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = '0rangeSoda1506/dsh-fx-marquee'
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const FOOTER = `\n\n---\n\n完整版本历史见 [CHANGELOG.md](https://github.com/${REPO}/blob/main/CHANGELOG.md)。`

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim()
const system = () => {
  try { return { ok: true, out: git('--version') } } catch (e) { return { ok: false, out: String(e.message) } }
}

function get(host, path, accept, token) {
  return new Promise((resolve) => {
    const req = request({
      host, path, method: 'GET', timeout: 20000,
      headers: { 'user-agent': 'dsh-release', accept, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      const c = []
      res.on('data', (d) => c.push(d))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }))
    req.end()
  })
}
function send(method, path, payload, token) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload)
    const req = request({
      host: 'api.github.com', path, method, timeout: 25000,
      headers: {
        'user-agent': 'dsh-release', accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
      },
    }, (res) => {
      const c = []
      res.on('data', (d) => c.push(d))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }))
    req.write(data)
    req.end()
  })
}

/** One version's section from CHANGELOG.md, heading stripped. */
export function sectionFor(version, file = CHANGELOG) {
  const text = readFileSync(file, 'utf8')
  const start = text.indexOf(`## [${version}]`)
  if (start < 0) throw new Error(`CHANGELOG.md 里找不到 ## [${version}]`)
  const rest = text.slice(start)
  const body = rest.slice(rest.indexOf('\n') + 1)
  const end = body.indexOf('\n---')
  return (end < 0 ? body : body.slice(0, end)).trim()
}

/**
 * A short human title for a release.
 *
 * Not the version: GitHub already renders the tag as a badge right above the
 * title, so a title of `v0.1.1` makes the version appear twice. Not the raw
 * first line either — truncating that mid-sentence produced
 * `v0.1.1 — 走势图新增X轴单位…（灰色不可选）：外汇没`. So: the changelog's first
 * sentence, markdown stripped, capped at a sentence boundary.
 */
export function titleFor(version, file = CHANGELOG) {
  const first = sectionFor(version, file).split('\n').find((l) => l.trim() !== '') || ''
  const plain = first.replace(/\*\*/g, '').replace(/`/g, '').trim()
  const stop = plain.indexOf('。')
  const sentence = stop < 0 ? plain : plain.slice(0, stop + 1)
  if (sentence.length <= 50) return sentence
  const head = sentence.slice(0, 50)
  const comma = Math.max(head.lastIndexOf('，'), head.lastIndexOf('；'))
  return comma > 20 ? head.slice(0, comma) + '…' : head + '…'
}

// ---------------------------------------------------------------- check
async function check(version) {
  let bad = 0
  const line = (ok, label, detail = '') => {
    console.log(`  ${ok ? '✅' : '❌'}  ${label}${detail ? '  — ' + detail : ''}`)
    if (!ok) bad++
  }
  const s = system()
  if (!s.ok) {
    console.log('  ⚠️  无法执行 git（沙箱？）—— 请在普通终端里跑这个命令')
    bad++
  }

  if (s.ok) {
    const dirty = git('status', '--porcelain')
    line(dirty === '', '工作区干净（有改动就别打 tag，v0.1.1 就是这么错的）', dirty.split('\n').slice(0, 3).join(' | '))
    const head = git('rev-parse', '--short', 'HEAD')
    console.log(`      当前 HEAD: ${head}`)
    if (version) {
      let tagExists = true
      try { git('rev-parse', '-q', '--verify', `refs/tags/v${version}`) } catch { tagExists = false }
      line(!tagExists, `本地不存在标签 v${version}`)
      let ahead = '?'
      try { ahead = git('rev-list', '--count', `v${version}..HEAD`) } catch { /* no tag yet */ }
      console.log(`      未推送提交: ${ahead}`)
    }
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  console.log(`      仓库 package.json 版本: ${pkg.version}`)
  if (version) line(pkg.version === version, `package.json 版本已是 ${version}`, pkg.version)

  const live = 'E:\\DeepSeek Harness\\plugins\\dsh-fx-marquee\\package.json'
  if (existsSync(live)) {
    const livePkg = JSON.parse(readFileSync(live, 'utf8'))
    line(livePkg.version === pkg.version, '运行副本与仓库副本版本一致', livePkg.version)
  }

  if (version) {
    line(/^## \[/.test(readFileSync(CHANGELOG, 'utf8')) && readFileSync(CHANGELOG, 'utf8').includes(`## [${version}]`),
      `CHANGELOG.md 已有 ## [${version}] 段`)
    const npm = await get('registry.npmjs.org', `/${pkg.name}`, 'application/json')
    if (npm.status === 200) {
      const published = Object.keys(JSON.parse(npm.body).versions)
      line(!published.includes(version), `npm 上还没有 ${version}`, `已发布: ${published.join(', ')}`)
    } else {
      console.log(`      npm 查询失败 HTTP ${npm.status}`)
    }
    const remote = await get('api.github.com', `/repos/${REPO}/git/ref/tags/v${version}?t=${Date.now()}`, 'application/vnd.github+json')
    line(remote.status === 404, `远端不存在标签 v${version}`)
  }

  console.log(`\n${bad === 0 ? '自检通过 ✅' : bad + ' 项需要处理 ❌'}`)
  process.exitCode = bad === 0 ? 0 : 1
}

// ---------------------------------------------------------------- draft
function draft(version) {
  let log = ''
  let lastTag = ''
  try {
    try { lastTag = git('describe', '--tags', '--abbrev=0') } catch { /* no tags yet */ }
    log = lastTag === '' ? git('log', '--pretty=%s', 'HEAD') : git('log', '--pretty=%s', `${lastTag}..HEAD`)
  } catch {
    // Almost always the agent sandbox: it denies piped stdio to children.
    console.log('⚠️  无法执行 git —— 请在普通终端（非 agent 沙箱）里运行本命令。')
    console.log('    （沙箱禁止 Node 用管道捕获子进程输出，git 会在 EPERM 上失败。）')
    process.exitCode = 1
    return
  }
  const commits = log.split('\n').filter((l) => l.trim() !== '')

  const groups = { '新增': [], '修复': [], '其它': [] }
  for (const c of commits) {
    if (/^feat[(:]/.test(c)) groups['新增'].push(c.replace(/^feat:\s*/, ''))
    else if (/^fix[(:]/.test(c)) groups['修复'].push(c.replace(/^fix:\s*/, ''))
    else groups['其它'].push(c)
  }
  console.log(`## [${version}] — ${new Date().toISOString().slice(0, 10)}\n`)
  console.log(`（自 ${lastTag || '首个提交'} 以来的 ${commits.length} 个提交；分组是机器猜的，请人工归类、改写成人话）\n`)
  for (const [name, items] of Object.entries(groups)) {
    if (items.length === 0) continue
    console.log(`### ${name}\n`)
    for (const item of items) console.log(`- ${item}`)
    console.log('')
  }
  console.log('提示：写完后确认「修复」只写**上一个已发布版本**里存在的问题——')
  console.log('      开发这一版途中自己踩自己填的坑，用户从来没遇到过，不属于修复。')
}

// ---------------------------------------------------------------- release
async function release(version, token, notLatest, update) {
  if (!token) { console.log('缺少令牌'); process.exit(1) }
  const body = sectionFor(version) + FOOTER
  const name = titleFor(version)
  console.log(`正文取自 CHANGELOG 的 ${version} 段（${body.length} 字符）`)
  console.log(`标题: ${name}`)

  if (update) {
    const existing = await get('api.github.com', `/repos/${REPO}/releases/tags/v${version}?t=${Date.now()}`, 'application/vnd.github+json')
    if (existing.status !== 200) { console.log(`❌ 没有 v${version} 的 Release 可更新`); process.exitCode = 1; return }
    const id = JSON.parse(existing.body).id
    const patched = await send('PATCH', `/repos/${REPO}/releases/${id}`, { body, name }, token)
    console.log(`HTTP ${patched.status} ${patched.status === 200 ? '✅ 已更新' : '❌ ' + String(patched.body).slice(0, 200)}`)
    if (patched.status !== 200) process.exitCode = 1
    return
  }

  const res = await send('POST', `/repos/${REPO}/releases`, {
    tag_name: `v${version}`,
    name,
    body,
    draft: false,
    prerelease: false,
    make_latest: notLatest ? 'false' : 'true',
  }, token)
  console.log(`HTTP ${res.status}`)
  if (res.status === 201) {
    const r = JSON.parse(res.body)
    console.log('  ✅', r.html_url)
    console.log('  注意：GitHub 的 Release 接口缓存 60 秒，刚建完可能查不到——核验时加 ?t= 时间戳。')
    console.log('  另：有 Release 的标签只能 git push --force 更新引用，删标签会把 Release 一起带走。')
  } else {
    console.log('  ❌', String(res.body).split(token).join('<TOKEN>').slice(0, 300))
    process.exitCode = 1
  }
}

const [command, version, token, ...flags] = process.argv.slice(2)
if (command === 'check') await check(version)
else if (command === 'draft') draft(version)
else if (command === 'release') await release(version, token, flags.includes('--not-latest'), flags.includes('--update'))
else {
  console.log('用法:')
  console.log('  node tools/release.mjs check [version]')
  console.log('  node tools/release.mjs draft <version>')
  console.log('  node tools/release.mjs release <version> <token> [--not-latest] [--update]')
}

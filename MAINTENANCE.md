# GitNexus Fork 维护指南

> Fork 仓库: https://github.com/iamyu72/GitNexus
> 上游仓库: https://github.com/abhigyanpatwari/GitNexus
> 自定义分支: `feat/android-large-repo-optimizations`
> 本地路径: `/tmp/gitnexus-fork`

---

## 一、同步上游最新代码并重新安装

```bash
# 1. 进入 fork 目录
cd /tmp/gitnexus-fork

# 2. 添加上游 remote（只需执行一次）
git remote add upstream https://github.com/abhigyanpatwari/GitNexus.git 2>/dev/null

# 3. 拉取上游最新代码
git fetch upstream

# 4. 切换到自定义分支
git checkout feat/android-large-repo-optimizations

# 5. 合并上游 main（如有冲突需手动解决）
git merge upstream/main

# 6. 安装依赖 + 编译 + 全局安装
cd gitnexus && npm install && npm run build && npm install -g .

# 7. 恢复 tree-sitter-kotlin（见下方说明）
TSK="/opt/homebrew/lib/node_modules/gitnexus/node_modules/tree-sitter-kotlin"
mkdir -p "$TSK/bindings/node" "$TSK/build/Release"
cp /tmp/ts-kotlin-build/package/build/Release/tree_sitter_kotlin_binding.node "$TSK/build/Release/"
cp /tmp/ts-kotlin-build/package/bindings/node/index.js "$TSK/bindings/node/"
cp /tmp/ts-kotlin-build/package/bindings/node/index.d.ts "$TSK/bindings/node/"
cp /tmp/ts-kotlin-build/package/package.json "$TSK/"

# 8. 验证
node -e "const k = require('$TSK'); console.log('Kotlin parser:', !!k)"
gitnexus --version

# 9. 推送合并结果到 fork
cd /tmp/gitnexus-fork && git push origin feat/android-large-repo-optimizations
```

---

## 二、重新索引工程

```bash
cd /Users/lamyu/Documents/android/dev/kmo
gitnexus analyze . --force
```

索引约需 6-7 分钟，结果保存在 `.gitnexus/` 目录下。

---

## 三、tree-sitter-kotlin 编译产物说明

Kotlin 解析器的 native binding 存放在 `/tmp/ts-kotlin-build/package/`，是手动用 clang 编译的（绕过了 macOS node-gyp 检测问题）。

**重要**: `/tmp` 目录在系统重启后可能被清理。建议将编译产物备份到持久化位置：

```bash
# 备份到 fork 仓库中（一次性操作）
mkdir -p /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/build/Release
mkdir -p /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/bindings/node
cp /tmp/ts-kotlin-build/package/build/Release/tree_sitter_kotlin_binding.node \
   /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/build/Release/
cp /tmp/ts-kotlin-build/package/bindings/node/index.js \
   /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/bindings/node/
cp /tmp/ts-kotlin-build/package/bindings/node/index.d.ts \
   /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/bindings/node/
cp /tmp/ts-kotlin-build/package/package.json \
   /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/

cd /tmp/gitnexus-fork
git add tree-sitter-kotlin-prebuilt/
git commit -m "chore: add prebuilt tree-sitter-kotlin native binding for macOS arm64"
git push origin feat/android-large-repo-optimizations
```

备份后，第一节中第 7 步改为：

```bash
TSK="/opt/homebrew/lib/node_modules/gitnexus/node_modules/tree-sitter-kotlin"
cp -r /tmp/gitnexus-fork/tree-sitter-kotlin-prebuilt/* "$TSK/"
```

---

## 四、如果 /tmp/gitnexus-fork 被清理

```bash
cd /tmp
git clone https://github.com/iamyu72/GitNexus.git gitnexus-fork
cd gitnexus-fork
git checkout feat/android-large-repo-optimizations
git remote add upstream https://github.com/abhigyanpatwari/GitNexus.git
```

然后按第一节从第 3 步开始执行。

---

## 五、如果需要重新编译 tree-sitter-kotlin

当 Node.js 大版本升级（如 v25 → v26）后，native binding 需要重新编译：

```bash
# 下载源码
cd /tmp && mkdir -p ts-kotlin-build && cd ts-kotlin-build
npm pack tree-sitter-kotlin && tar xzf tree-sitter-kotlin-*.tgz && cd package
npm install node-addon-api

# 获取编译路径
NODE_INCLUDE="$(node -e "console.log(require('path').resolve(process.execPath, '..', '..', 'include', 'node'))")"
NAPI_INCLUDE="$(node -e "console.log(require('node-addon-api').include)")"
SDK_PATH="$(xcrun --show-sdk-path)"
CXX_INCLUDE="$SDK_PATH/usr/include/c++/v1"

# 编译
mkdir -p build/Release
cc -std=c11 -c -fPIC -I src -I "$NODE_INCLUDE" -I "$NAPI_INCLUDE" \
   -DNAPI_VERSION=8 -DNODE_ADDON_API_DISABLE_DEPRECATED src/parser.c -o build/parser.o
cc -std=c11 -c -fPIC -I src -I "$NODE_INCLUDE" -I "$NAPI_INCLUDE" \
   -DNAPI_VERSION=8 -DNODE_ADDON_API_DISABLE_DEPRECATED src/scanner.c -o build/scanner.o
c++ -std=c++17 -stdlib=libc++ -c -fPIC -isysroot "$SDK_PATH" -isystem "$CXX_INCLUDE" \
    -I src -I "$NODE_INCLUDE" -I "$NAPI_INCLUDE" \
    -DNAPI_VERSION=8 -DNODE_ADDON_API_DISABLE_DEPRECATED bindings/node/binding.cc -o build/binding.o
c++ -shared -stdlib=libc++ -isysroot "$SDK_PATH" \
    -o build/Release/tree_sitter_kotlin_binding.node \
    build/parser.o build/scanner.o build/binding.o -undefined dynamic_lookup

# 验证
node -e "const k = require('./'); console.log('OK:', !!k)"
```

---

## 六、自定义改动文件清单

| 文件 | 改动内容 |
|------|---------|
| `gitnexus/src/core/ingestion/pipeline.ts` | 执行流上限 300 → 3000 |
| `gitnexus/src/core/ingestion/call-processor.ts` | 置信度惩罚 + 命名惯例类型推断 |
| `gitnexus/src/core/search/bm25-index.ts` | BM25 驼峰/snake_case 拆分 |
| `gitnexus/src/core/ingestion/community-processor.ts` | 聚类标签优化 |
| `gitnexus/src/core/ingestion/process-processor.ts` | 执行流标签优化 |
| `gitnexus/src/mcp/local/local-backend.ts` | impact 消歧义 + Class 展开 |

合并上游代码时，如果这些文件有冲突，参考 `docs/GITNEXUS_OPTIMIZATION_REPORT.md` 中的详细说明重新应用改动。

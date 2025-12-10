#!/bin/bash

# 版本号更新脚本
# 用法:
#   ./scripts/bump-version.sh <version>   - 指定版本号，如 0.2.0
#   ./scripts/bump-version.sh major       - 主版本号 +1 (1.0.0 -> 2.0.0)
#   ./scripts/bump-version.sh minor       - 次版本号 +1 (1.0.0 -> 1.1.0)
#   ./scripts/bump-version.sh patch       - 修订号 +1 (1.0.0 -> 1.0.1)

set -e

if [ -z "$1" ]; then
  echo "用法: $0 <version|major|minor|patch>"
  echo "示例:"
  echo "  $0 0.2.0   - 指定版本号"
  echo "  $0 major   - 主版本号 +1"
  echo "  $0 minor   - 次版本号 +1"
  echo "  $0 patch   - 修订号 +1"
  exit 1
fi

# 获取当前版本号 (从 package.json)
CURRENT_VERSION=$(grep -o '"version": "[^"]*"' package.json | head -1 | cut -d'"' -f4)

# 解析当前版本号
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# 根据参数计算新版本号
case "$1" in
  major)
    VERSION="$((MAJOR + 1)).0.0"
    ;;
  minor)
    VERSION="$MAJOR.$((MINOR + 1)).0"
    ;;
  patch)
    VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    ;;
  *)
    VERSION=$1
    # 移除可能的 v 前缀
    VERSION=${VERSION#v}
    ;;
esac

echo "当前版本: $CURRENT_VERSION"
echo "更新版本号到 $VERSION ..."

# 1. 更新 package.json
echo "  → package.json"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json

# 2. 更新 src-tauri/tauri.conf.json
echo "  → src-tauri/tauri.conf.json"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

# 3. 更新 src-tauri/Cargo.toml
echo "  → src-tauri/Cargo.toml"
sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

echo ""
echo "版本号已更新为 $VERSION"
echo ""
echo "下一步:"
echo "  git add -A"
echo "  git commit -m \"chore: bump version to $VERSION\""
echo "  git tag v$VERSION"
echo "  git push origin main --tags"

#!/usr/bin/env bash
# 冒烟测试：服务是否健康可用（无需任何账号）
# 运行: npm run smoke
# 检查项: 服务进程响应、静态首页可访问、API 健康接口(含DB连通性)
set -uo pipefail

PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"
FAIL=0

echo "==> 1/3 检查首页 (GET $BASE/)"
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/")
echo "    状态码: $HTTP_CODE"
[ "$HTTP_CODE" = "200" ] || { echo "    ✗ 首页不可访问"; FAIL=1; }

echo "==> 2/3 检查健康接口 (GET $BASE/api/health)"
HEALTH=$(curl -s --max-time 10 "$BASE/api/health")
echo "    响应: $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || { echo "    ✗ 健康检查未通过"; FAIL=1; }

echo "==> 3/3 检查上传目录鉴权 (GET $BASE/uploads/ 应返回 404)"
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/uploads/")
echo "    状态码: $HTTP_CODE"
[ "$HTTP_CODE" = "404" ] || { echo "    → 上传目录疑似被静态暴露"; FAIL=1; }

if [ "$FAIL" = "0" ]; then
  echo ""
  echo "✅ 冒烟测试全部通过，服务可正常对外提供服务。"
  exit 0
else
  echo ""
  echo "❌ 冒烟测试有失败项，请检查服务日志与配置。"
  exit 1
fi
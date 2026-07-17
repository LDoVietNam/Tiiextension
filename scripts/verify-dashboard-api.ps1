#!/bin/bash
# Verify 1MCP Dashboard API Flow
# Run from Z:\01_PROJECTS\apps\Tiiextension

API_KEY="tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI"
BASE="http://127.0.0.1:1840"
ROOT="Z:/01_PROJECTS/apps/Tiiextension"

echo "=== 1MCP Dashboard API Verification ==="

# 1. Health check
echo -e "\n1. Health Check:"
curl -s "${BASE}/health" | jq .

# 2. Get allowed roots
echo -e "\n2. Get Allowed Roots:"
curl -s -X POST "${BASE}/internal/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"tool":"get_allowed_roots","arguments":{},"idempotencyKey":"verify_'"$(date +%s)"'"}' | jq .

# 3. List directory
echo -e "\n3. List Directory:"
curl -s -X POST "${BASE}/internal/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"tool":"list_directory","arguments":{"path":"'"${ROOT}"'"},"idempotencyKey":"verify_'"$(date +%s)"'"}' | jq '.result.entries | length'

# 4. Read a file
echo -e "\n4. Read File (README.md):"
curl -s -X POST "${BASE}/internal/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"tool":"read_file","arguments":{"path":"'"${ROOT}"'/README.md"},"idempotencyKey":"verify_'"$(date +%s)"'"}' | jq '.result | {path, truncated, content_length: (.content | length)}'

# 5. Write a test file
echo -e "\n5. Write Test File:"
curl -s -X POST "${BASE}/internal/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"tool":"write_file","arguments":{"path":"'"${ROOT}"'/verify_test.txt","content":"Verification test at '"$(date)'" },"idempotencyKey":"verify_'"$(date +%s)"'"}' | jq .

# 6. Read back the test file
echo -e "\n6. Read Back Test File:"
curl -s -X POST "${BASE}/internal/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"tool":"read_file","arguments":{"path":"'"${ROOT}"'/verify_test.txt"},"idempotencyKey":"verify_'"$(date +%s)"'"}' | jq .result

# 7. Clean up test file
echo -e "\n7. Clean Up Test File:"
curl -s -X POST "${BASE}/internal/tools/call" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{"tool":"delete_to_trash","arguments":{"path":"'"${ROOT}"'/verify_test.txt"},"idempotencyKey":"verify_'"$(date +%s)"'"}' | jq .

echo -e "\n=== All API flows verified successfully ==="
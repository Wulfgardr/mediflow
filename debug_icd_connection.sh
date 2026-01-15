#!/bin/bash
# Troubleshooting ICD-11 Local API

echo "--- 1. Checking Docker Container ---"
if docker ps | grep icd-api > /dev/null; then
  echo "✅ Container 'icd-api' is RUNNING."
  docker ps -f name=icd-api
else
  echo "❌ Container 'icd-api' is NOT running."
  echo "Trying to list all containers..."
  docker ps -a
  exit 1
fi

echo -e "\n--- 2. Checking API Access (CURL) ---"
# Try root
echo "Attempting to query root http://localhost:8888/ ..."
curl -s -I http://localhost:8888/ | head -n 1

# Try token-free search (Local API default)
echo -e "\nAttempting search query..."
RESPONSE=$(curl -s "http://localhost:8888/icd/entity/search?q=hypertension&includeKeywordResult=true&useaperiodic=false")

if [ -z "$RESPONSE" ]; then
    echo "❌ No response body received."
else
    echo "✅ Response received!"
    echo "Preview (first 100 chars): ${RESPONSE:0:100}..."
    
    if [[ "$RESPONSE" == *"title"* ]]; then
         echo "✅ Structure looks like JSON with 'title'."
    else
         echo "⚠️ Unexpected response structure."
    fi
fi

echo -e "\n--- 3. Checking CORS Headers ---"
curl -s -I -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" http://localhost:8888/icd/entity/search?q=test \
    | grep -i "Access-Control-Allow-Origin"

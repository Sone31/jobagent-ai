#!/bin/bash
# ============================================================
# JobAgent AI — Backend Setup Script
# Run this once to install everything
# ============================================================

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   JobAgent AI — Backend Setup          ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from: https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -v)
echo "✅ Node.js: $NODE_VER"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
  echo "❌ npm install failed. Try: npm install --ignore-scripts"
  exit 1
fi

# Install Playwright browsers
echo ""
echo "🎭 Installing Playwright Chromium browser..."
npx playwright install chromium

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the backend server:"
echo "  node server.js"
echo ""
echo "The server will run on http://localhost:51473"
echo "Keep this terminal open while using the extension."
echo ""

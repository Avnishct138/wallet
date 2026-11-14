#!/usr/bin/env bash
# ============================================================
# वॉलेट — GitHub Setup Script
# ============================================================
# यह script आपके local wallet-repo को GitHub पर push करेगी।
# Usage:
#   1. GitHub पर नया repository बनाएँ (https://github.com/new)
#      - Name: wallet (या कोई भी नाम)
#      - Private/Public: आपकी choice
#      - ⚠️ "Initialize with README" UNCHECKED रखें
#   2. नीचे REPO_URL अपने GitHub repo URL से replace करें
#   3. Run: bash setup-github.sh
# ============================================================

set -e

REPO_URL="${1:-}"

if [ -z "$REPO_URL" ]; then
  echo "❌ GitHub repo URL नहीं मिला।"
  echo ""
  echo "Usage:"
  echo "  bash setup-github.sh https://github.com/YOUR_USERNAME/wallet.git"
  echo ""
  echo "Steps:"
  echo "  1. जाएँ: https://github.com/new"
  echo "  2. Repository name: wallet"
  echo "  3. ⚠️ 'Initialize with README' UNCHECKED रखें"
  echo "  4. Create repository"
  echo "  5. URL copy करें और ऊपर command में paste करें"
  exit 1
fi

echo "🚀 वॉलेट — GitHub Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Target: $REPO_URL"
echo ""

# Check we're in the right directory
if [ ! -f "index.html" ] || [ ! -f "wallet-core.js" ]; then
  echo "❌ यह script wallet-repo folder में run होनी चाहिए।"
  echo "   cd wallet-repo && bash setup-github.sh <URL>"
  exit 1
fi

# Init git if needed
if [ ! -d ".git" ]; then
  echo "📦 Initializing git repository..."
  git init -b main
  git config user.email "wallet-demo@local"
  git config user.name "Wallet Demo"
fi

# Stage all files
echo "📝 Staging files..."
git add .

# Show what will be committed
echo ""
echo "📋 Files to commit:"
git status --short
echo ""

# Commit
echo "💾 Creating initial commit..."
git commit -m "Initial commit: secure wallet demo with ledger architecture

- index.html (landing) + wallet.html (dashboard), Hindi UI
- Color-coded zones: send/receive/reward/history/security
- Custom unDraw-style SVG illustrations + inline icons
- css/styles.css: glassmorphism, zone gradients, motion-primitives-inspired animations
- js/wallet-core.js: ledger with idempotency, validation, audit log
- js/wallet.js + js/app.js: UI bindings (no business logic)
- assets/: favicon + illustration sprite
- README.md: architecture, run instructions, limitations, migration path
- .gitignore: secrets, .env, node_modules, local DB patterns
- .nojekyll: serve as static on GitHub Pages" --quiet

echo ""
echo "🔗 Adding remote..."
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"

echo ""
echo "⬆️  Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Done!"
echo ""
echo "📍 अगले steps:"
echo "  • Repo Settings → Pages → Source: main branch, / (root)"
echo "  • आपका site URL: \${REPO_URL%.git} पर कुछ ही मिनटों में live होगा"
echo "  • Live site: https://YOUR_USERNAME.github.io/wallet/"

#!/bin/bash

# DACN Backend Test Runner
set -e

echo "🧪 DACN Test Suite"
echo "=================="
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run database migrations
echo "🗄️  Running database migrations..."
npm run db:migrate

# Run unit tests
echo ""
echo "🔬 Running Unit Tests..."
npm run test -- --testPathPattern=unit --coverage=false

# Run integration tests
echo ""
echo "🔗 Running Integration Tests..."
npm run test -- --testPathPattern=integration --coverage=false

# Run E2E tests
echo ""
echo "🎭 Running E2E Tests..."
npm run test -- --testPathPattern=e2e --coverage=false

# Full coverage report
echo ""
echo "📊 Generating Coverage Report..."
npm run test -- --coverage --coverageReporters=text-summary

echo ""
echo "✅ All tests complete!"

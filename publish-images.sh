#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ${#@} -lt 1 ]]; then
  echo "Usage: $0 <version> [dockerhub-username]"
  echo "Example: $0 v1 tlabsdoc"
  exit 1
fi

VERSION="$1"
DOCKERHUB_USERNAME="${2:-tlabsdoc}"
REPO="$DOCKERHUB_USERNAME/usagetracker"

BACKEND_VERSION_TAG="$REPO:backend-$VERSION"
FRONTEND_VERSION_TAG="$REPO:frontend-$VERSION"
BACKEND_LATEST_TAG="$REPO:backend-latest"
FRONTEND_LATEST_TAG="$REPO:frontend-latest"

echo "Publishing version '$VERSION' to Docker Hub repo '$REPO'"

echo

echo "Building backend image..."
docker build -t "$BACKEND_VERSION_TAG" .

echo

echo "Pushing backend version tag..."
docker push "$BACKEND_VERSION_TAG"

echo

echo "Tagging backend as latest..."
docker tag "$BACKEND_VERSION_TAG" "$BACKEND_LATEST_TAG"
docker push "$BACKEND_LATEST_TAG"

echo

echo "Building frontend image..."
docker build -t "$FRONTEND_VERSION_TAG" ./frontend

echo

echo "Pushing frontend version tag..."
docker push "$FRONTEND_VERSION_TAG"

echo

echo "Tagging frontend as latest..."
docker tag "$FRONTEND_VERSION_TAG" "$FRONTEND_LATEST_TAG"
docker push "$FRONTEND_LATEST_TAG"

echo
echo "Done."
echo "Use docker-compose with:"
echo "  image: $BACKEND_LATEST_TAG"
echo "  image: $FRONTEND_LATEST_TAG"

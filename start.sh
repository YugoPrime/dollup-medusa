#!/bin/sh
set -e

echo "Running database migrations..."
yarn medusa db:migrate

echo "Starting Medusa server..."
yarn start

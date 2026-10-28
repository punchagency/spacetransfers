#!/bin/sh
# Print exports are written to /app/uploads, a persistent disk in production. A
# freshly attached disk belongs to root, so the container starts as root, hands
# that directory to the `node` user, and runs the API as `node`. The API itself
# never runs as root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/uploads
  chown node:node /app/uploads
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"

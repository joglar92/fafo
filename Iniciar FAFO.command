#!/bin/bash
# Doble click para iniciar FAFO
cd "$(dirname "$0")"
if ! curl -s -o /dev/null http://localhost:3001/ ; then
  node server.js &
  sleep 1
fi
open http://localhost:3001
wait

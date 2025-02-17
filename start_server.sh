#!/bin/bash

PLAYER_COUNT=$1
PUBLIC_IP=$2
DIFFICULTY=$3
PORT=$4

echo "Starting Edushooter server with:"
echo "Players: $PLAYER_COUNT"
echo "IP: $PUBLIC_IP"
echo "Difficulty: $DIFFICULTY"
echo "Port: $PORT"

./edushooter_server/edushooter_multiplayer.x86_64 -servermode -batchmode -nographics -players "$PLAYER_COUNT" -external_address "$PUBLIC_IP" -difficulty "$DIFFICULTY" -port "$PORT" -listen_address 0.0.0.0 &
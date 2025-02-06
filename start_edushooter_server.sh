#!/bin/bash

# Read parameters
PLAYER_COUNT=$1
PUBLIC_IP=$2
DIFFICULTY=$3
PORT=$4


# Start dedicated server
./edurobots -servermode -players "$PLAYER_COUNT" -external_address "$PUBLIC_IP" -difficulty "$DIFFICULTY" -port "$PORT" -listen_address 0.0.0.0

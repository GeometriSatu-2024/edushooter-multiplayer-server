// Libraries & dependencies
const WebSocket = require("ws");
const { exec } = require("child_process");
const { net } = require("net");

// Constants
const MAX_LOBBIES = 5;
const MAX_PLAYERS_PER_LOBBY = 4;
const COUNTDOWN_SECONDS = 5;

const LOBBY_PORT = 30000;
const VALID_COMMANDS = [
  "CREATE_LOBBY(playerId)",
  "JOIN_LOBBY(playerId, lobbyCode)",
  "SET_READY(playerId, lobbyCode, ready)",
  "LEAVE_LOBBY(playerId, lobbyCode)",
  "START_GAME(playerId, lobbyCode)",
  "CHANGE_LEADER(playerId, lobbyCode)",
];

// Network config
const PUBLIC_IP = "127.0.0.1";
const AVAILABLE_PORTS = [50000, 50001, 50002, 50003, 50004, 50005]; // TODO, make it dynamic according to lobby sizes

// Initialize
const lobbies = new Map();

const server = new WebSocket.Server({ port: LOBBY_PORT });

//#region CLASSES
class Lobby {
  constructor(leaderId, ws) {
    this.leader = leaderId;
    this.running = false;
    this.players = [new Player(leaderId, ws)];
    this.port = getAvailablePort();
  }

  setState(newState) {
    this.state = newState;
  }

  getState(i, key, value) {
    return (
      `\nLOBBY #${i} ------------------------------------------\n` +
      `Code   : ${key}\n` +
      `Leader : ${value.leader}\n` +
      `Port   : ${value.port}\n` +
      `Players: ${value.players.map((item) => item.id).join(" ")}\n`
    );
  }
}

class Player {
  constructor(playerId, ws) {
    this.id = playerId;
    this.ready = false;
    this.socket = ws;
  }

  setReady(status) {
    this.ready = status;
  }
}
//#endregion

//#region FUNCTIONS
function generateLobbyCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (lobbies.has(code)); // Regenerate the code if it already exists

  return code;
}

function logLobbyStates() {
  if (lobbies.size < 1) {
    console.log("No lobbies left to log!");
  }

  let i = 1;
  lobbies.forEach((value, key, map) => {
    console.log(value.getState(i++, key, value));
  });
}

function getAvailablePort() {
  const usedPorts = new Set(
    Array.from(lobbies.values()).map((lobby) => lobby.port)
  );
  return AVAILABLE_PORTS.find((port) => !usedPorts.has(port)) || null;
}

// This function checks if the player exists in any of the lobbies
function playerExists(playerId) {
  // Deconstructs the lobbies map into an array
  // Uses some() to check if the players array
  // Contains an id that is playerId
  // Returns as a boolean
  return [...lobbies.values()].some((lobbyData) =>
    lobbyData.players.some((player) => player.id === playerId)
  );
}

function updateLobbyState(lobbyCode, exceptionId = null) {
  // If the lobby code doesn't exist
  if (!lobbies.has(lobbyCode)) {
    console.error(
      `The lobby code (${lobbyCode}) does not exist, please examine the code and use a valid one!`
    );
    return;
  }

  // Send to all connected players the new lobby state
  let lobby = lobbies.get(lobbyCode);
  const notificationMessage = JSON.stringify({
    success: true,
    action: "LOBBY_STATE_UPDATED",
    lobbyState: {
      leader: lobby.leader,
      players: lobby.players.map((player) => ({
        id: player.id,
        ready: player.ready,
      })),
    },
  });

  if (exceptionId != null) {
    lobby.players.forEach((player) => {
      if (player.id !== exceptionId) {
        player.socket.send(notificationMessage);
      }
    });
  } else {
    lobby.players.forEach((player) => {
      player.socket.send(notificationMessage);
    });
  }
}

// Attempts to get the ID of a websocket connection, returns null if none
function getPlayerIdFromSocket(ws) {
  for (const [lobbyCode, lobby] of lobbies) {
    for (const player of lobby.players) {
      if (player.socket === ws) {
        console.log(
          `Server has found player id ${player.id} from the connection`
        );
        return player.id;
      }
    }
  }
  return null;
}

function getLobbyCodeFromPlayerId(playerId) {
  if (playerId == null) return null;

  for (const [lobbyCode, lobby] of lobbies) {
    if (lobby.players.some((player) => player.id === playerId)) {
      console.log(
        `Server found lobby code from player id ${playerId} which is ${lobbyCode}`
      );
      return lobbyCode;
    }
  }
  return null;
}

function startGameServer(lobbyId, playerCount, difficulty, port) {}

//#endregion

//#region CONNECTION HANDLER
// Handler for players attempting to create lobby
function handleCreateLobby(ws, playerId) {
  // If the player already exists
  if (playerExists(playerId)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_ALREADY_IN_LOBBY",
        message: `The player with id ${playerId} is already in a lobby.`,
      })
    );
    return;
  }

  console.log(`Attempting to create a new lobby for player '${playerId}'`);

  // Check if we have reached the maximum number of lobbies this server can handle
  if (lobbies.size >= MAX_LOBBIES) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "LOBBY_AT_CAPACITY",
        message:
          "The number of lobbies the server can handle has exceeded its capacity. Cannot create a new lobby, please try again later!",
      })
    );
    return;
  }

  // We have enough capacity for the lobby, create a new one
  const lobbyCode = generateLobbyCode();

  lobbies.set(lobbyCode, new Lobby(playerId, ws));

  logLobbyStates();
  ws.send(
    JSON.stringify({
      success: true,
      action: "LOBBY_CREATED",
      lobby_code: lobbyCode,
      message:
        "A new lobby has been created, use the lobby code to let other players join in the lobby!",
    })
  );
}

// Handler for players attempting to join a lobby
function handleJoinLobby(ws, playerId, lobbyCode) {
  // If the player already exists
  if (playerExists(playerId)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_ALREADY_IN_LOBBY",
        message: `The player with id ${playerId} is already in a lobby.`,
      })
    );
    return;
  }

  console.log(`Player ${playerId} is attempting to join lobby ${lobbyCode}`);

  // If the lobby code doesn't exist
  if (!lobbies.has(lobbyCode)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_LOBBY_CODE",
        message: `The lobby code (${lobbyCode}) requested does not exist, please examine the code and request a valid one!`,
      })
    );
    return;
  }

  // If it exists, then check if the number of connected players has exceeded the cap
  let lobby = lobbies.get(lobbyCode);
  if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "LOBBY_FULL",
        message: `The lobby you are attempting to join is already full, please try again later!`,
      })
    );
    return;
  }

  // If the player already exists
  if (lobby.players.find((player) => player.id == playerId)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_ALREADY_EXISTS",
        message:
          "You are attempting to join a lobby where you already are a part of! This is not supposed to happen.",
      })
    );
    return;
  }

  // Passed all checks, add the player
  lobby.players.push(new Player(playerId, ws));

  logLobbyStates();
  updateLobbyState(lobbyCode);

  ws.send(
    JSON.stringify({
      success: true,
      action: "JOINED_LOBBY",
      message: "You have successfully joined the lobby!",
      otherPlayers: lobby.players
        .map((player) => ({
          id: player.id,
          ready: player.ready,
        }))
        .filter((player) => player.id !== playerId),
    })
  );
  return;
}

// Handler for players attempting to set ready
function handleSetReady(ws, playerId, lobbyCode, isReady) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
      })
    );
    return;
  }

  // Check if the lobby exists
  if (!lobbies.has(lobbyCode)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_LOBBY_CODE",
        message: `The lobby code (${lobbyCode}) requested does not exist, please examine the code and request a valid one!`,
      })
    );
    return;
  }

  let lobby = lobbies.get(lobbyCode);
  const playerIndex = lobby.players.findIndex(
    (player) => player.id === playerId
  );

  // If the player doesnt exist in the lobby
  if (playerIndex === -1) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_DOES_NOT_EXIST",
        message:
          "There is no player with that ID in the lobby, this is not supposed to happen!",
      })
    );
    return;
  }

  // Sets the lobby's player ready status
  lobby.players[playerIndex].setReady(isReady);

  // Notify all other players that this player has set their ready status
  logLobbyStates();
  updateLobbyState(lobbyCode);

  ws.send(
    JSON.stringify({
      success: true,
      action: "SET_READY_STATUS",
      message: `You have successfully set your ready status to ${isReady}!`,
    })
  );
  return;
}

// Handler for a player attempting to leave
function handleLeaveLobby(ws, playerId, lobbyCode) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
      })
    );
    return;
  }

  // Check if the lobby exists
  if (!lobbies.has(lobbyCode)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_LOBBY_CODE",
        message: `The lobby code (${lobbyCode}) requested does not exist, please examine the code and request a valid one!`,
      })
    );
    return;
  }

  let lobby = lobbies.get(lobbyCode);
  const playerIndex = lobby.players.findIndex(
    (player) => player.id === playerId
  );

  // If the player doesnt exist in the lobby
  if (playerIndex === -1) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_DOES_NOT_EXIST",
        message:
          "There is no player with that ID in the lobby, this is not supposed to happen!",
      })
    );
    return;
  }

  // Removes the player from the lobby data
  lobby.players.splice(playerIndex, 1);

  // If there are still players left
  if (lobby.players.length > 0) {
    // If the player that left is the leader
    if (lobby.leader == playerId) {
      // Change the leader to another random player
      lobby.leader = lobby.players[0].id;
    }

    console.log(
      `Player ${playerId} has left, telling all connected players the player has left!`
    );
    // Send the new lobby state
    logLobbyStates();
    updateLobbyState(lobbyCode);
  }
  // If all players have left
  else {
    // Remove the lobby
    console.log(
      "No remaining players left in the lobby, deleting the lobby..."
    );
    lobbies.delete(lobbyCode);
  }

  ws.send(
    JSON.stringify({
      success: true,
      action: "PLAYER_LEFT",
      message: `You have successfully left the lobby!`,
    })
  );
  return;
}

// Handler that attempts to run a bash script that starts the game
function handleStartGame(
  ws,
  playerId,
  lobbyCode,
  difficultyLevel
) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
      })
    );
    return;
  }
  // Check if the lobby exists
  if (!lobbies.has(lobbyCode)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_LOBBY_CODE",
        message: `The lobby code (${lobbyCode}) requested does not exist, please examine the code and request a valid one!`,
      })
    );
    return;
  }

  // Check if the caller is the leader
  let lobby = lobbies.get(lobbyCode);
  if (lobby.leader != playerId) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PERMISSION",
        message: `The caller is not a leader of the lobby ${lobbyCode}, only the leader can start the game!`,
      })
    );
    return;
  }

  // Check all players, if any are not ready then cannot start game
  for (const player of lobby.players) {
    if (!player.ready) {
      ws.send(
        JSON.stringify({
          success: false,
          error: "LOBBY_NOT_READY",
          message: `Some players are not ready, cannot start the game!`,
        })
      );
      return;
    }
  }

  // Passed all checks, run the game!
  // Run the bash script
  const playerCount = lobby.players.length;
  const portAddress = lobby.port;

  // Default to 0
  if (!difficultyLevel){
    difficultyLevel = 0;
  }

  const start_command = `./start_edushooter_server.sh ${playerCount} ${PUBLIC_IP} ${difficultyLevel} ${portAddress}`;
  console.log(`Attempting to start game server with bash: ${start_command}`);

  // TODO: TEST ON LINUX SERVER
  // const process = exec(start_command, (error, stdout, stderr) => {
  //   if (error) {
  //     console.error(`Error executing script: ${error.message}`);
  //     return;
  //   }
  //   if (stderr) {
  //     console.warn(`Script stderr: ${stderr}`);
  //   }
  //   console.log(`Script started successfully:\n${stdout}`);
  // });

  // Return network config so players can connect to the server
  ws.send(
    JSON.stringify({
      success: true,
      action: "GAME_SERVER_READY",
      message: `Server has successfully started, here are the network configurations.`,
      config: {
        externalIP: PUBLIC_IP,
        portAddress: portAddress,
      }
    })
  );
  return;
}

// Handler that attempts to change the leader role to another player
function handleChangeLeader(ws, playerId, targetId, lobbyCode) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
      })
    );
    return;
  }

  if (!targetId) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your target's ID, try again!`,
      })
    );
    return;
  }

  // Check if the lobby exists
  if (!lobbies.has(lobbyCode)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_LOBBY_CODE",
        message: `The lobby code (${lobbyCode}) requested does not exist, please examine the code and request a valid one!`,
      })
    );
    return;
  }

  let lobby = lobbies.get(lobbyCode);
  if (lobby.leader != playerId) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PERMISSION",
        message: `The caller is not a leader of the lobby ${lobbyCode}, only the leader can bestow leadership!`,
      })
    );
    return;
  }

  const playerIndex = lobby.players.findIndex(
    (player) => player.id === playerId
  );
  const targetIndex = lobby.players.findIndex(
    (player) => player.id === targetId
  );

  // If the player doesnt exist in the lobby
  if (playerIndex === -1 || targetIndex === -1) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_DOES_NOT_EXIST",
        message:
          "There are no player(s) with that ID in the lobby, check both playerId and targetId in the request!",
      })
    );
    return;
  }

  // Change leadership
  lobby.leader = targetId;
  logLobbyStates();
  updateLobbyState(lobbyCode);

  ws.send(
    JSON.stringify({
      success: true,
      action: "LEADER_CHANGED",
      message: `You have successfully transferred leadership to player ${targetId}!`,
    })
  );
  return;
}

// Handler that returns an error if the action isn't a valid one
function handleUnknownAction(ws, action) {
  ws.send(
    JSON.stringify({
      success: false,
      error: "UNKNOWN_ACTION",
      message: `The action you have attempted to do (${action}) is not valid. You can choose from the following valid actions instead. The brackets are properties that MUST be included with the command.`,
      valid_actions: VALID_COMMANDS,
    })
  );
}

//#endregion

server.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    const connectedPlayer = getPlayerIdFromSocket(ws);
    const connectedLobby = getLobbyCodeFromPlayerId(connectedPlayer);

    switch (data.action) {
      // Requires player id to initialize
      case "CREATE_LOBBY":
        handleCreateLobby(ws, data.playerId);
        break;

      case "JOIN_LOBBY":
        handleJoinLobby(ws, data.playerId, data.lobbyCode);
        break;

      // Does not require player id
      case "SET_READY":
        handleSetReady(ws, connectedPlayer, connectedLobby, data.isReady);
        break;

      case "LEAVE_LOBBY":
        handleLeaveLobby(ws, connectedPlayer, connectedLobby);
        break;

      case "START_GAME":
        handleStartGame(ws, connectedPlayer, connectedLobby, data.difficultyLevel);
        break;

      case "CHANGE_LEADER":
        handleChangeLeader(ws, connectedPlayer, data.targetId, connectedLobby);
        break;

      default:
        handleUnknownAction(ws, data.action);
        break;
    }
  });
});

console.log(`Lobby server running on port ${LOBBY_PORT}`);

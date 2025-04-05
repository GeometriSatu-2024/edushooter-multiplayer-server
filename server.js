// Libraries & dependencies
const WebSocket = require("ws");
const { spawn, exec } = require("child_process");
const { net } = require("net");

// Constants
const MAX_LOBBIES = 5;
const MAX_PLAYERS_PER_LOBBY = 4;
const COUNTDOWN_SECONDS = 5;

const LOBBY_PORT = 31000;
const VALID_COMMANDS = [
  "CREATE_LOBBY(playerId)",
  "JOIN_LOBBY(playerId, lobbyCode)",
  "SET_READY(playerId, lobbyCode, ready)",
  "LEAVE_LOBBY(playerId, lobbyCode)",
  "START_GAME(playerId, lobbyCode)",
  "CHANGE_LEADER(playerId, lobbyCode)",
];
const GAME_START_DELAY = 8000;

// Network config
const LOCALHOST = "127.0.0.1";
const SERVER_IP = "103.13.206.139";

const AVAILABLE_PORTS = [50000, 50001, 50002, 50003, 50004, 50005]; // TODO, make it dynamic according to lobby sizes

const windowsFilename = "start_server.bat";
const linuxFilename = "start_server.sh"

// is it local or not
const isServerMode = process.argv.includes("servermode");
if (!isServerMode) {
  console.log(
    "Starting node server without servermode. This means that starting games will always return true and not execute any bash scripts."
  );
} else {
  console.log(
    "Starting node server as servermode. The server WILL execute bash script when asked to."
  );
}

const isWindows = process.platform === "win32";
if (!isWindows) {
  console.log(
    `Node server is running not on Windows, most likely on a linux server. Currently on ${process.platform}`
  );
} else {
  console.log(
    "Running on windows, defaulting to localhost."
  );
}


// Initialize
const lobbies = new Map();

// Bind server on port LOBBY_PORT and to all hosts
const server = new WebSocket.Server({ port: LOBBY_PORT, host: "0.0.0.0" });

//#region CLASSES
class Lobby {
  constructor(leaderId, playerName, ws) {
    this.leader = leaderId;
    this.running = false;
    this.players = [new Player(leaderId, playerName, ws)];
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
  constructor(playerId, playerName, ws) {
    this.id = playerId;
    this.name = playerName;
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
        name: player.name,
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

async function runServerScript(scriptPath, args = [], forceError = false) {
  
  return new Promise((resolve) => {
    if (forceError) {
      console.log("Resolving running bash script as false");
      resolve(false);
      return;
    }

    let script;
    if (isWindows){
      console.log("Executing windows bash file..");
      script = spawn("cmd.exe", ["/c", "start", "", scriptPath, ...args], { detached: true })
    }
    else {
      console.log("Executing linux batch file..");
      script = spawn("bash", [scriptPath, ...args], { detached: true, stdio: 'inherit' });
    }

    script.unref();
    
    script.on("error", (err) => {
      console.error(`Failed to start process: ${err.message}`);
      resolve(false);
      return;
    });
    
    // If process successfully launches, we return a true
    resolve(true);
  });
}


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

//#endregion

//#region CONNECTION HANDLER
// Handler for players attempting to create lobby
function handleCreateLobby(ws, playerId, playerName, messageId) {
  // Check if playerId is missing
  if (!playerId) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "NO_ID_GIVEN",
        message: `You are attempting to request the server without providing an authenticated id, please try again!`,
      })
    );
    return;
  }

  let name = playerName;
  if (!name) {
    name = playerId;
  }

  // If the player already exists
  if (playerExists(playerId)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_ALREADY_IN_LOBBY",
        message: `The player with id ${playerId} is already in a lobby.`,
        msgId: messageId,
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
        msgId: messageId,
      })
    );
    return;
  }

  // We have enough capacity for the lobby, create a new one
  const lobbyCode = generateLobbyCode();

  lobbies.set(lobbyCode, new Lobby(playerId, name, ws));

  logLobbyStates();
  ws.send(
    JSON.stringify({
      success: true,
      action: "LOBBY_CREATED",
      lobby_code: lobbyCode,
      message:
        "A new lobby has been created, use the lobby code to let other players join in the lobby!",
      msgId: messageId,
    })
  );
}

// Handler for players attempting to join a lobby
function handleJoinLobby(ws, playerId, playerName, lobbyCode, messageId) {
  // Check if playerId is missing
  if (!playerId) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "NO_ID_GIVEN",
        message: `You are attempting to request the server without providing an authenticated id, please try again!`,
      })
    );
    return;
  }

  let name = playerName;
  if (!name) {
    name = playerId;
  }

  // If the player already exists
  if (playerExists(playerId)) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "PLAYER_ALREADY_IN_LOBBY",
        message: `The player with id ${playerId} is already in a lobby.`,
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
      })
    );
    return;
  }

  // Passed all checks, add the player
  lobby.players.push(new Player(playerId, name, ws));

  logLobbyStates();

  ws.send(
    JSON.stringify({
      success: true,
      action: "JOINED_LOBBY",
      message: "You have successfully joined the lobby!",
      lobby_code: lobbyCode,
      otherPlayers: lobby.players
        .map((player) => ({
          id: player.id,
          ready: player.ready,
        }))
        .filter((player) => player.id !== playerId),
      msgId: messageId,
    })
  );

  updateLobbyState(lobbyCode);
  return;
}

// Handler for players attempting to set ready
function handleSetReady(ws, playerId, lobbyCode, isReady, messageId) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
      msgId: messageId,
    })
  );
  return;
}

// Handler for a player attempting to leave
function handleLeaveLobby(ws, playerId, lobbyCode, messageId) {
  console.log(
    `Attempting to handle player ${playerId} leaving the lobby ${lobbyCode}`
  );
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
      msgId: messageId,
    })
  );
  return;
}

// Handler that attempts to run a bash script that starts the game
async function handleStartGame(
  ws,
  playerId,
  lobbyCode,
  difficultyLevel,
  messageId
) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
          msgId: messageId,
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
  if (!difficultyLevel) {
    difficultyLevel = 0;
  }

  const externalIP = isWindows ? LOCALHOST : SERVER_IP;
  const args = [playerCount, externalIP, difficultyLevel, portAddress];
  const scriptPath = isWindows ? windowsFilename : linuxFilename;

  let scriptResult = false;
  if (isServerMode) {
    console.log(
      `Attempting to start game server with batch file: ${scriptPath} ${args.join(
        " "
      )}`
    );

    // get the current lobby and notify everyone EXCEPT the initiator to pause
    let lobby = lobbies.get(lobbyCode);
    const notificationMessage = JSON.stringify({
      success: true,
      action: "STARTING_GAME_SESSION",
      message: "The leader is attempting to start a game session."
    });

    lobby.players.forEach((player) => {
      if (player.id !== playerId) {
        player.socket.send(notificationMessage);
      }
    });

    scriptResult = await runServerScript(scriptPath, args);

  } else {
    console.log("Just returning a true");
    scriptResult = true;
  }

  // Artificial delay
  delay(2000);
  if (!scriptResult) {
    // get the current lobby and notify everyone EXCEPT the initiator about the error
    let lobby = lobbies.get(lobbyCode);
    const errorMessage = JSON.stringify({
      success: false,
      action: "ABORT_GAME_START",
      error: "UNKNOWN_ERROR",
      message: "Failed to enter the game session. The leader should try again!"
    });

    lobby.players.forEach((player) => {
      if (player.id !== playerId) {
        player.socket.send(errorMessage);
      }
    });

    ws.send(
      JSON.stringify({
        success: false,
        error: "CANNOT_START_GAME",
        message: "An error has occurred, cannot start game!",
        msgId: messageId,
      })
    );
  } else {
    // Send success response immediately after starting the process
    console.log(
      "Script started successfully, game server should be running in the background."
    );

    // Wait for a few seconds to let the process start
    await delay(GAME_START_DELAY);

    // Send the message to all connected players in the lobby

    const serverReadyMsg = JSON.stringify({
      success: true,
      action: "GAME_SERVER_READY",
      message:
        "Server has successfully started, here are the network configurations.",
      config: {
        externalIP: externalIP,
        portAddress: portAddress,
      },
      msgId: messageId,
    });

    // Send the game server configs to all players
    lobby.players.forEach((player) => {
      player.socket.send(serverReadyMsg);
    });

    // Set all player states to unready
    lobby.players.forEach((player) => {
      player.setReady(false);
    });

  }
}

// Handler that attempts to change the leader role to another player
function handleChangeLeader(ws, playerId, targetId, lobbyCode, messageId) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
        msgId: messageId,
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
      msgId: messageId,
    })
  );
  return;
}

// Handler for clients that want lobby data
function handleGetLobbyData(ws, playerId, lobbyCode, messageId) {
  if (playerId == null) {
    ws.send(
      JSON.stringify({
        success: false,
        error: "INVALID_PLAYERID",
        message: `The lobby cannot recognize your connection's ID, this should not happen!`,
        msgId: messageId,
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
        msgId: messageId,
      })
    );
    return;
  }

  // Return the lobby data
  let lobby = lobbies.get(lobbyCode);
  ws.send(
    JSON.stringify({
      success: true,
      action: "RETURNED_LOBBY_DATA",
      message: `The lobby data requested has been appended below`,
      msgId: messageId,
      lobbyData: {
        leader: lobby.leader,
        players: lobby.players.map((player) => ({
          id: player.id,
          name: player.name,
          ready: player.ready,
        })),
      },
    })
  );
  return;
}

// Handler that returns an error if the action isn't a valid one
function handleUnknownAction(ws, action, messageId) {
  ws.send(
    JSON.stringify({
      success: false,
      error: "UNKNOWN_ACTION",
      message: `The action you have attempted to do (${action}) is not valid. You can choose from the following valid actions instead. The brackets are properties that MUST be included with the command.`,
      valid_actions: VALID_COMMANDS,
      msgId: messageId,
    })
  );
}

//#endregion

server.on("connection", (ws) => {
  console.log("New connection established");

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    const connectedPlayer = getPlayerIdFromSocket(ws);
    const connectedLobby = getLobbyCodeFromPlayerId(connectedPlayer);

    const messageId = data.msgId;

    if (!messageId) {
      ws.send(
        JSON.stringify({
          success: false,
          error: "NO_MESSAGE_ID",
          message:
            "All messages from the client should contain a unique message Id, this will be used to notify a reply.",
          msgId: messageId,
        })
      );
      return;
    }

    switch (data.action) {
      // Requires player id to initialize
      case "CREATE_LOBBY":
        handleCreateLobby(ws, data.playerId, data.playerName, messageId);
        break;

      case "JOIN_LOBBY":
        handleJoinLobby(
          ws,
          data.playerId,
          data.playerName,
          data.lobbyCode,
          messageId
        );
        break;

      // Does not require player id
      case "SET_READY":
        handleSetReady(
          ws,
          connectedPlayer,
          connectedLobby,
          data.isReady,
          messageId
        );
        break;

      case "LEAVE_LOBBY":
        handleLeaveLobby(ws, connectedPlayer, connectedLobby, messageId);
        break;

      case "START_GAME":
        handleStartGame(
          ws,
          connectedPlayer,
          connectedLobby,
          data.difficultyLevel,
          messageId
        );
        break;

      case "CHANGE_LEADER":
        handleChangeLeader(
          ws,
          connectedPlayer,
          data.targetId,
          connectedLobby,
          messageId
        );
        break;

      case "GET_LOBBY_DATA":
        handleGetLobbyData(ws, connectedPlayer, connectedLobby, messageId);
        break;

      default:
        handleUnknownAction(ws, data.action, messageId);
        break;
    }
  });

  ws.on("close", () => {
    // Handle player leaving
    const leavingPlayer = getPlayerIdFromSocket(ws);
    const leftLobby = getLobbyCodeFromPlayerId(leavingPlayer);

    console.log(
      `Connection from ${leavingPlayer} with lobby ${leftLobby} has ended`
    );
    if (leavingPlayer && leftLobby) {
      // Remove the player from the lobby
      handleLeaveLobby(ws, leavingPlayer, leftLobby);
    }
  });
});

server.on("listening", () => {
  console.log(`Lobby server is listening on port ${LOBBY_PORT}`);
});

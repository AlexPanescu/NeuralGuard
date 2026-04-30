import { io } from "socket.io-client";
import { API_URL } from "../api/client";

let sharedSocket = null;

export function getRealtimeSocket() {
  if (!sharedSocket) {
    sharedSocket = io(API_URL, {
      transports: ["polling", "websocket"],
      upgrade: true,
      rememberUpgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
  }

  if (!sharedSocket.connected && !sharedSocket.active) {
    sharedSocket.connect();
  }

  return sharedSocket;
}
